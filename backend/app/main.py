from __future__ import annotations

import hmac
import logging
import os
import secrets
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .a2a_protocol import build_coordinator_agent_card
from .api_routes import create_api_router
from .db import Database
from .importer import import_current_state_into_db, import_project_config, load_project_preset
from .mcp_server import create_mcp_server

logger = logging.getLogger("kanbanana")

_AUTH_RATE_LOCK = threading.Lock()
_AUTH_FAILURES_BY_IP: dict[str, list[float]] = {}
_AUTH_WINDOW_SEC = 60.0
_AUTH_MAX_FAILURES = 20

_SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self' ws: wss: http: https:; "
        "frame-ancestors 'none'"
    ),
}


def check_auth_rate_limit(client_ip: str) -> bool:
    """Returns True if client_ip is allowed to attempt authentication, False if rate-limited."""
    now = time.monotonic()
    with _AUTH_RATE_LOCK:
        attempts = _AUTH_FAILURES_BY_IP.get(client_ip)
        if not attempts:
            return True
        fresh = [t for t in attempts if now - t < _AUTH_WINDOW_SEC]
        if fresh:
            _AUTH_FAILURES_BY_IP[client_ip] = fresh
        else:
            _AUTH_FAILURES_BY_IP.pop(client_ip, None)
        return len(fresh) < _AUTH_MAX_FAILURES


def record_auth_failure(client_ip: str) -> None:
    now = time.monotonic()
    with _AUTH_RATE_LOCK:
        if len(_AUTH_FAILURES_BY_IP) > 1024 and client_ip not in _AUTH_FAILURES_BY_IP:
            oldest_key = next(iter(_AUTH_FAILURES_BY_IP))
            _AUTH_FAILURES_BY_IP.pop(oldest_key, None)
        fresh = [t for t in _AUTH_FAILURES_BY_IP.get(client_ip, []) if now - t < _AUTH_WINDOW_SEC]
        fresh.append(now)
        _AUTH_FAILURES_BY_IP[client_ip] = fresh


def ensure_safe_bind_auth(host: str) -> str:
    """
    Ensures non-loopback binds never expose unauthenticated MCP/API endpoints by default.
    Generates and sets a random KANBANANA_API_TOKEN unless explicitly overridden.
    """
    existing = os.environ.get("KANBANANA_API_TOKEN", "").strip()
    if existing:
        return existing
    is_loopback = host.strip().lower() in ("127.0.0.1", "localhost", "::1")
    if is_loopback or os.environ.get("KANBANANA_ALLOW_INSECURE_BIND") == "1":
        return ""
    generated = secrets.token_urlsafe(24)
    os.environ["KANBANANA_API_TOKEN"] = generated
    print(
        f"[kanbanana-security] Non-loopback bind ({host}) detected without KANBANANA_API_TOKEN. "
        f"Generated ephemeral API token: {generated}",
        file=sys.stderr,
    )
    return generated


def _is_protected_http_path(path: str) -> bool:
    if path.startswith("/api/webhooks/"):
        return False
    return (
        path.startswith("/api/")
        or path == "/mcp"
        or path.startswith("/mcp/")
        or path.startswith("/.well-known/")
    )


def create_app(db_path: str | Path | None = None, auto_seed: bool = True) -> FastAPI:
    db = Database(db_path=db_path)

    skip_seed = os.environ.get("KANBANANA_SKIP_SEED", "0").strip() in ("1", "true", "True")
    if auto_seed and not skip_seed and not db.list_projects():
        default_preset = os.environ.get("KANBANANA_DEFAULT_PROJECT", "default")
        preset_data = load_project_preset(default_preset)
        if preset_data:
            import_project_config(db, preset_data)
        else:
            docs_dir = Path(__file__).resolve().parent.parent.parent / "docs" / "CURRENT_STATE"
            if docs_dir.exists():
                import_current_state_into_db(db, docs_dir, project_slug=default_preset)

    mcp = create_mcp_server(db)
    mcp_http_app = mcp.http_app(path="/mcp")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        import asyncio
        from .agent_manager import run_watchdog_cycle

        stop_event = asyncio.Event()

        async def _background_watchdog_loop():
            while not stop_event.is_set():
                try:
                    await asyncio.sleep(30)
                    gs = db.get_global_settings()
                    if gs.get("watchdog", {}).get("enabled", True):
                        run_watchdog_cycle(db)
                except asyncio.CancelledError:
                    break
                except Exception:
                    pass

        bg_task = asyncio.create_task(_background_watchdog_loop())
        try:
            async with mcp_http_app.lifespan(app):
                yield
        finally:
            stop_event.set()
            bg_task.cancel()
            try:
                await bg_task
            except asyncio.CancelledError:
                pass

    app = FastAPI(
        title="Kanbanana — Agent-First Kanban & MCP Server",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.db = db
    app.state.mcp = mcp

    raw_origins = os.environ.get(
        "KANBANANA_CORS_ORIGINS",
        "http://localhost:8765,http://127.0.0.1:8765,http://localhost:5173,http://127.0.0.1:5173",
    )
    cors_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled server error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
            headers=_SECURITY_HEADERS,
        )

    @app.middleware("http")
    async def security_and_auth_middleware(request: Request, call_next):
        if request.method != "OPTIONS":
            expected_token = os.environ.get("KANBANANA_API_TOKEN", "").strip()
            if expected_token and _is_protected_http_path(request.url.path):
                client_ip = (request.client.host if request.client else "unknown") or "unknown"
                if not check_auth_rate_limit(client_ip):
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Too many failed authentication attempts. Try again later."},
                        headers={**_SECURITY_HEADERS, "Retry-After": "60"},
                    )
                auth_header = request.headers.get("Authorization", "")
                bearer = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
                candidate = bearer or request.headers.get("X-API-Key", "").strip()
                if not candidate or not hmac.compare_digest(candidate, expected_token):
                    record_auth_failure(client_ip)
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "Unauthorized: invalid or missing API token"},
                        headers=_SECURITY_HEADERS,
                    )

        response = await call_next(request)
        for hk, hv in _SECURITY_HEADERS.items():
            response.headers.setdefault(hk, hv)
        return response

    app.include_router(create_api_router(db))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "mcp_endpoint": "/mcp", "a2a_well_known": "/.well-known/agent.json"}

    @app.get("/.well-known/agent.json")
    @app.get("/.well-known/agent-card.json")
    def well_known_agent_card() -> dict:
        return build_coordinator_agent_card()

    # Serve built React frontend at / if frontend/dist exists
    frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
    if frontend_dist.exists():
        mcp_http_app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

    # Mount the FastMCP Streamable-HTTP app (exposes /mcp and static UI if built)
    app.mount("/", mcp_http_app)

    return app


app = create_app(auto_seed=os.environ.get("KANBANANA_SKIP_SEED") != "1")


if __name__ == "__main__":
    import uvicorn

    bind_host = os.environ.get("KANBANANA_HOST", "127.0.0.1").strip() or "127.0.0.1"
    bind_port = int(os.environ.get("KANBANANA_PORT", "8765"))
    dev_reload = os.environ.get("KANBANANA_RELOAD", "0").strip().lower() in ("1", "true")
    ensure_safe_bind_auth(bind_host)
    uvicorn.run("app.main:app", host=bind_host, port=bind_port, reload=dev_reload)
