from __future__ import annotations

import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
import hmac
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Optional
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, StreamingResponse

from .a2a_protocol import (
    PROVIDER_MODEL_CATALOG,
    build_coordinator_agent_card,
    dispatch_task_via_a2a,
    evict_a2a_stream_events,
    probe_remote_a2a_agent_card,
    record_a2a_stream_event,
)
from .agent_manager import (
    build_agent_launch_command,
    discover_agent_profiles,
    ensure_ticket_worktree,
    inject_mcp_and_skill_into_profile,
    inspect_review_branch_and_static_scan,
    inspect_worktree_git_status,
    is_safe_http_url,
    launch_agent_subprocess,
    merge_ticket_branch_or_pr,
    resolve_or_virtual_profile,
    resolve_workspace_and_worktrees_dir,
    sanitize_git_branch,
    trigger_lane_auto_dispatch,
    validate_agent_config_path,
    validate_cli_command,
    validate_worktree_path_confinement,
)
from .db import Database, now_iso
from .events import event_hub
from .importer import (
    export_project_config,
    import_current_state_into_db,
    import_project_config,
    list_project_presets,
    load_project_preset,
)
from .models import (
    A2AScanRequest,
    AgentProfileCreate,
    AgentUpsertRequest,
    AgentUsageExhaustedRequest,
    ClaimWithAgentRequest,
    GlobalSettingsUpdate,
    InjectMcpConfigRequest,
    LockAcquireRequest,
    LockCreate,
    LockHeartbeatRequest,
    LockReleaseRequest,
    MessageCreate,
    NoteCreate,
    ProjectCreate,
    ProjectUpdate,
    ProposeTicketsRequest,
    ReviewTicketRequest,
    SectionCreate,
    TicketCreate,
    TicketUpdate,
    TriageResearchFindingsRequest,
)
from .routing_config import (
    agents_match_identity,
    discover_unified_skills,
    resolve_agent_lane_plan,
    test_systemone_connection,
)
from .skill_generator import render_code_review_skill_md, render_skill_md


def _decode_ws_subprotocol_token(raw_header: str) -> tuple[str, Optional[str]]:
    """Extract base64url bearer token from Sec-WebSocket-Protocol if provided."""
    protocols = [p.strip() for p in (raw_header or "").split(",") if p.strip()]
    accepted_proto: Optional[str] = "kanbanana.v1" if "kanbanana.v1" in protocols else None
    for p in protocols:
        if p.startswith("kanbanana-token."):
            b64_part = p[len("kanbanana-token.") :]
            pad = "=" * ((4 - len(b64_part) % 4) % 4)
            try:
                decoded = base64.urlsafe_b64decode((b64_part + pad).encode("ascii")).decode("utf-8")
                return decoded, accepted_proto
            except Exception:
                return "", accepted_proto
    return "", accepted_proto


def create_api_router(db: Database) -> APIRouter:
    router = APIRouter(prefix="/api")
    ws_ticket_lock = threading.Lock()
    ws_tickets: dict[str, float] = {}

    @router.post("/auth/ws-ticket")
    def issue_ws_ticket() -> dict[str, Any]:
        """Issues a short-lived (30s) single-use WebSocket handshake ticket so bearer tokens stay out of URLs."""
        now_mono = time.monotonic()
        ticket = secrets.token_urlsafe(24)
        with ws_ticket_lock:
            expired = [k for k, exp in ws_tickets.items() if exp <= now_mono]
            for k in expired:
                ws_tickets.pop(k, None)
            while len(ws_tickets) >= 256:
                ws_tickets.pop(next(iter(ws_tickets)), None)
            ws_tickets[ticket] = now_mono + 30.0
        return {"ticket": ticket, "expires_in": 30}

    @router.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        raw_proto = ws.headers.get("sec-websocket-protocol", "")
        subproto_token, accepted_subproto = _decode_ws_subprotocol_token(raw_proto)
        expected_token = os.environ.get("KANBANANA_API_TOKEN", "").strip()
        if expected_token:
            ws_nonce = ws.query_params.get("ticket", "").strip()
            nonce_valid = False
            if ws_nonce:
                now_mono = time.monotonic()
                with ws_ticket_lock:
                    exp = ws_tickets.pop(ws_nonce, None)
                    if exp is not None and exp > now_mono:
                        nonce_valid = True

            if not nonce_valid:
                auth_header = ws.headers.get("authorization", "")
                bearer = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
                query_tok = (
                    ""
                    if os.environ.get("KANBANANA_DISABLE_WS_QUERY_TOKEN") == "1"
                    else ws.query_params.get("token", "").strip()
                )
                candidate = (
                    bearer
                    or ws.headers.get("x-api-key", "").strip()
                    or subproto_token
                    or query_tok
                )
                if not candidate or not hmac.compare_digest(candidate, expected_token):
                    await ws.close(code=1008, reason="Unauthorized: invalid or missing API token")
                    return

        await event_hub.connect(ws, subprotocol=accepted_subproto)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            event_hub.disconnect(ws)

    # ------------------------------------------------------------------
    # Global Settings & Unified Skill Catalog
    # ------------------------------------------------------------------
    @router.get("/settings/global")
    def get_global_settings_endpoint() -> dict[str, Any]:
        gs = db.get_global_settings()
        return {
            **gs,
            "provider_model_catalog": PROVIDER_MODEL_CATALOG,
        }

    @router.patch("/settings/global")
    async def update_global_settings_endpoint(req: GlobalSettingsUpdate) -> dict[str, Any]:
        gs = db.update_global_settings(req)
        await event_hub.broadcast("global_settings_updated", {"updated_at": gs.get("updated_at")})
        return {
            **gs,
            "provider_model_catalog": PROVIDER_MODEL_CATALOG,
        }

    @router.post("/settings/global/reset")
    async def reset_global_settings_endpoint() -> dict[str, Any]:
        gs = db.reset_global_settings()
        await event_hub.broadcast("global_settings_updated", {"updated_at": gs.get("updated_at"), "reset": True})
        return {
            **gs,
            "provider_model_catalog": PROVIDER_MODEL_CATALOG,
        }

    @router.get("/skills/catalog")
    def get_unified_skills_catalog(project_slug: Optional[str] = None) -> list[dict[str, Any]]:
        gs = db.get_global_settings()
        proj = db.get_project(project_slug) if project_slug else None
        profiles = discover_agent_profiles(db)
        return discover_unified_skills(gs, project=proj, profiles=profiles)

    @router.get("/skills/{skill_id}/SKILL.md", response_class=PlainTextResponse)
    def get_global_managed_skill_md(skill_id: str) -> str:
        gs = db.get_global_settings()
        profiles = discover_agent_profiles(db)
        catalog = discover_unified_skills(gs, project=None, profiles=profiles)
        hit = next((s for s in catalog if s["id"] == skill_id), None)
        if not hit or not hit.get("content_md"):
            raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
        return str(hit["content_md"])

    @router.get("/projects/{slug}/skills/{skill_id}/SKILL.md", response_class=PlainTextResponse)
    def get_project_custom_skill_md(slug: str, skill_id: str) -> str:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        gs = db.get_global_settings()
        profiles = discover_agent_profiles(db)
        catalog = discover_unified_skills(gs, project=proj, profiles=profiles)
        hit = next((s for s in catalog if s["id"] == skill_id), None)
        if not hit or not hit.get("content_md"):
            raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found in project '{slug}'")
        return str(hit["content_md"])

    @router.get("/projects/{slug}/routing-resolve")
    def resolve_project_lane_routing_endpoint(
        slug: str,
        lane: str = Query(default="todo"),
        agent_id: str = Query(default=""),
        profile_id: Optional[str] = None,
        ticket_owner: Optional[str] = None,
        ticket_code: Optional[str] = None,
    ) -> dict[str, Any]:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        gs = db.get_global_settings()
        profiles = discover_agent_profiles(db)
        prof = resolve_or_virtual_profile(profiles, agent_id, profile_id)
        tick = db.get_ticket(slug, ticket_code) if ticket_code else None
        return resolve_agent_lane_plan(
            gs,
            proj,
            lane=lane,
            agent_id=agent_id or (prof["id"] if prof else ""),
            profile=prof,
            profiles=profiles,
            ticket_owner=ticket_owner,
            ticket=tick,
        )

    @router.post("/systemone/test-connection")
    def test_systemone_connection_endpoint(req: dict[str, Any]) -> dict[str, Any]:
        url = str(req.get("url") or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="SystemOne endpoint URL is required")
        api_key = req.get("api_key")
        model = str(req.get("model") or "jev-latest").strip()
        timeout = float(req.get("timeout_seconds") or 5.0)
        return test_systemone_connection(
            url=url, api_key=api_key, model=model, timeout_seconds=timeout
        )

    # ------------------------------------------------------------------
    # Projects & Skill Generation
    # ------------------------------------------------------------------
    @router.get("/projects")
    def list_projects() -> list[dict[str, Any]]:
        return db.list_projects()

    @router.post("/projects")
    async def create_project(req: ProjectCreate) -> dict[str, Any]:
        try:
            proj = db.create_project(req)
            await event_hub.broadcast("project_created", {"slug": req.slug})
            return proj
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/projects/{slug}")
    def get_project(slug: str) -> dict[str, Any]:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        return proj

    @router.patch("/projects/{slug}")
    async def update_project(slug: str, req: ProjectUpdate) -> dict[str, Any]:
        try:
            proj = db.update_project(slug, req)
            await event_hub.broadcast("project_updated", {"slug": slug})
            return proj
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.delete("/projects/{slug}")
    async def delete_project(slug: str) -> dict[str, Any]:
        try:
            res = db.delete_project(slug)
            await event_hub.broadcast("project_deleted", res)
            return res
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=409, detail=str(e))

    @router.get("/projects/{slug}/sections")
    def list_sections(slug: str) -> list[dict[str, Any]]:
        return db.list_sections(slug)

    @router.post("/projects/{slug}/sections")
    async def upsert_section(slug: str, req: SectionCreate) -> dict[str, Any]:
        try:
            sec = db.upsert_section(slug, req)
            await event_hub.broadcast("section_updated", {"slug": slug, "section": sec})
            return sec
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.delete("/projects/{slug}/sections/{section_code}")
    async def delete_section(slug: str, section_code: str) -> dict[str, Any]:
        try:
            res = db.delete_section(slug, section_code)
            await event_hub.broadcast("section_deleted", {"slug": slug, **res})
            return res
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.get("/projects/{slug}/skill.md", response_class=PlainTextResponse)
    def get_project_skill_md(
        slug: str, mcp_url: str = Query(default="http://localhost:8765/mcp")
    ) -> str:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        return render_skill_md(proj, mcp_url=mcp_url)

    @router.get("/projects/{slug}/code-review-skill.md", response_class=PlainTextResponse)
    def get_project_code_review_skill_md(
        slug: str, mcp_url: str = Query(default="http://localhost:8765/mcp")
    ) -> str:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        return render_code_review_skill_md(proj, mcp_url=mcp_url)

    @router.post("/projects/{slug}/export-skill")
    def export_project_skill_md(
        slug: str,
        target_path: Optional[str] = None,
        mcp_url: str = "http://localhost:8765/mcp",
    ) -> dict[str, Any]:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        content = render_skill_md(proj, mcp_url=mcp_url)
        raw_out = target_path or (proj.get("skill_config") or {}).get("skill_output_path") or ""
        if not raw_out:
            raise HTTPException(status_code=400, detail="No skill_output_path specified")
        raw_path = Path(raw_out)
        if ".." in raw_path.parts:
            raise HTTPException(status_code=400, detail="Path traversal ('..') is not allowed in skill_output_path")
        expanded = raw_path.expanduser().resolve()
        if expanded.suffix.lower() != ".md":
            raise HTTPException(status_code=400, detail="Export target must be a Markdown (.md) file")
        export_root = os.environ.get("KANBANANA_EXPORT_ROOT")
        if export_root and not expanded.is_relative_to(Path(export_root).resolve()):
            raise HTTPException(status_code=400, detail="Export path is outside KANBANANA_EXPORT_ROOT")
        expanded.parent.mkdir(parents=True, exist_ok=True)
        expanded.write_text(content, encoding="utf-8")
        return {"written_to": str(expanded), "bytes": len(content)}

    @router.get("/project-presets")
    def get_project_presets() -> list[dict[str, Any]]:
        return list_project_presets()

    @router.get("/projects/{slug}/config.json")
    def export_project_config_endpoint(slug: str) -> dict[str, Any]:
        try:
            return export_project_config(db, slug)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/import-config")
    async def import_project_config_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
        preset_name = payload.get("preset_name")
        config = payload.get("config")
        if not config and preset_name:
            config = load_project_preset(preset_name)
        if not config:
            raise HTTPException(status_code=400, detail="Missing valid 'config' object or recognized 'preset_name'")
        try:
            res = import_project_config(db, config)
            await event_hub.broadcast("project_created", {"slug": res["slug"]})
            return res
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.post("/import-current-state")
    async def import_current_state(project_slug: Optional[str] = None) -> dict[str, Any]:
        slug = project_slug or os.environ.get("KANBANANA_DEFAULT_PROJECT") or db.get_default_project_slug()
        docs_dir = Path(__file__).resolve().parent.parent.parent / "docs" / "CURRENT_STATE"
        if not docs_dir.exists():
            raise HTTPException(status_code=404, detail=f"Docs directory not found: {docs_dir}")
        res = import_current_state_into_db(db, docs_dir, project_slug=slug)
        await event_hub.broadcast("project_imported", res)
        return res

    # ------------------------------------------------------------------
    # Tickets, Triage & Proposals
    # ------------------------------------------------------------------
    @router.get("/projects/{slug}/tickets")
    def list_tickets(
        slug: str,
        status: Optional[str] = None,
        section_code: Optional[str] = None,
        owner: Optional[str] = None,
        include_notes: bool = True,
    ) -> list[dict[str, Any]]:
        try:
            return db.list_tickets(
                slug,
                status=status,
                section_code=section_code,
                owner=owner,
                include_notes=include_notes,
            )
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets")
    async def create_ticket(slug: str, req: TicketCreate) -> dict[str, Any]:
        try:
            t = db.create_ticket(slug, req)
            auto_disp = trigger_lane_auto_dispatch(db, slug, t, previous_status=None)
            if auto_disp:
                t = db.get_ticket(slug, t["code"]) or t
                t["auto_dispatch"] = auto_disp
                await event_hub.broadcast(
                    "lane_auto_dispatched",
                    {"project_slug": slug, "code": t["code"], "lane": t["status"], **auto_disp},
                )
            await event_hub.broadcast("ticket_created", {"project_slug": slug, "code": t["code"]})
            return t
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @router.get("/projects/{slug}/tickets/{code}")
    def get_ticket(slug: str, code: str) -> dict[str, Any]:
        t = db.get_ticket(slug, code)
        if not t:
            raise HTTPException(status_code=404, detail=f"Ticket '{code}' not found")
        return t

    @router.patch("/projects/{slug}/tickets/{code}")
    async def update_ticket(slug: str, code: str, req: TicketUpdate) -> dict[str, Any]:
        try:
            prev = db.get_ticket(slug, code)
            prev_status = prev["status"] if prev else None
            t = db.update_ticket(slug, code, req)
            if req.status is not None and req.status != prev_status:
                auto_disp = trigger_lane_auto_dispatch(db, slug, t, previous_status=prev_status)
                if auto_disp:
                    t = db.get_ticket(slug, t["code"]) or t
                    t["auto_dispatch"] = auto_disp
                    await event_hub.broadcast(
                        "lane_auto_dispatched",
                        {"project_slug": slug, "code": t["code"], "lane": t["status"], **auto_disp},
                    )
            await event_hub.broadcast("ticket_updated", {"project_slug": slug, "code": t["code"]})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/claim")
    async def claim_ticket(
        slug: str,
        code: str,
        agent_id: str,
        branch_name: str = "",
        worktree_path: str = "",
        allow_review_deps: bool = True,
    ) -> dict[str, Any]:
        try:
            t = db.claim_ticket(
                slug,
                code,
                agent_id=agent_id,
                branch_name=branch_name,
                worktree_path=worktree_path,
                allow_review_deps=allow_review_deps,
            )
            await event_hub.broadcast("ticket_claimed", {"project_slug": slug, "code": t["code"], "owner": agent_id})
            return t
        except (ValueError, RuntimeError) as e:
            raise HTTPException(status_code=409, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/hold")
    async def hold_ticket_endpoint(
        slug: str, code: str, req: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        try:
            body = req or {}
            reason = str(body.get("reason") or "").strip()
            author = str(body.get("author") or "user").strip()
            t = db.update_ticket(slug, code, TicketUpdate(is_held=True))
            if reason:
                db.add_ticket_note(
                    slug,
                    code,
                    NoteCreate(
                        author=author,
                        kind="system",
                        content_md=f"⏸️ **Ticket Placed on Hold** by `{author}`: {reason}",
                    ),
                )
                t = db.get_ticket(slug, code) or t
            await event_hub.broadcast("ticket_updated", {"project_slug": slug, "code": code})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/resume")
    async def resume_ticket_endpoint(
        slug: str, code: str, req: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        try:
            body = req or {}
            note_md = str(body.get("note_md") or "").strip()
            author = str(body.get("author") or "user").strip()
            t = db.update_ticket(slug, code, TicketUpdate(is_held=False))
            note_text = note_md or f"▶️ **Ticket Resumed from Hold** by `{author}`."
            db.add_ticket_note(
                slug,
                code,
                NoteCreate(
                    author=author,
                    kind="system",
                    content_md=note_text,
                ),
            )
            t = db.get_ticket(slug, code) or t
            await event_hub.broadcast("ticket_updated", {"project_slug": slug, "code": code})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/claim-with-agent")
    async def claim_ticket_with_agent(
        slug: str,
        code: str,
        req: ClaimWithAgentRequest,
    ) -> dict[str, Any]:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")

        existing_t = db.get_ticket(slug, code)
        if not existing_t:
            raise HTTPException(status_code=404, detail=f"Ticket '{code}' not found")

        if existing_t.get("is_held"):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot claim ticket '{code}': ticket is currently on hold (is_held=True). "
                    f"Resume or unhold the ticket before claiming."
                ),
            )

        g_settings = db.get_global_settings()
        profiles = discover_agent_profiles(db)
        prof = resolve_or_virtual_profile(profiles, req.agent_id, req.profile_id)

        # Enforce Review self-review guard when explicitly claiming/assigning a review ticket
        rev_lane_cfg = (proj.get("effective_lanes") or {}).get("review") or {}
        if (
            existing_t["status"] == "review"
            and bool(rev_lane_cfg.get("prevent_self_review", True))
            and existing_t.get("owner")
            and agents_match_identity(req.profile_id or req.agent_id, existing_t["owner"], profiles=profiles)
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Self-review prevented by Review lane policy: `{existing_t['owner']}` authored `{code}`. "
                    f"Select a different reviewer agent or disable 'Prevent self-review' in Project Settings."
                ),
            )

        routing_plan = resolve_agent_lane_plan(
            g_settings,
            proj,
            lane=existing_t["status"],
            agent_id=req.agent_id,
            profile=prof,
            profiles=profiles,
            ticket_owner=None,  # Already validated explicit claim above
            explicit_model=req.model,
            explicit_effort=req.effort,
            explicit_skills=req.skills,
            ticket=existing_t,
        )

        branch_prefix = str(routing_plan.get("branch_prefix") or "board/").strip()
        if branch_prefix and not branch_prefix.endswith("/"):
            branch_prefix = f"{branch_prefix}/"

        wt_info: dict[str, Any] = {}
        final_branch = req.branch_name.strip() or existing_t.get("branch_name") or f"{branch_prefix}{code.lower()}"
        final_wt_path = req.worktree_path.strip() or existing_t.get("worktree_path") or ""

        if final_wt_path and (req.auto_create_worktree or req.launch_agent):
            try:
                final_wt_path = str(validate_worktree_path_confinement(proj, final_wt_path))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

        if req.auto_create_worktree:
            try:
                wt_info = ensure_ticket_worktree(
                    proj,
                    ticket_code=code,
                    branch_name=final_branch,
                    requested_worktree_path=final_wt_path,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            final_wt_path = wt_info["worktree_path"]
            final_branch = wt_info["branch_name"]

        try:
            if existing_t["status"] == "triage":
                t = db.update_ticket(
                    slug,
                    code,
                    TicketUpdate(
                        triage_state="researching",
                        owner=req.agent_id,
                        branch_name=final_branch,
                        worktree_path=final_wt_path,
                    ),
                )
            elif existing_t["status"] == "review":
                db.add_ticket_note(
                    slug,
                    code,
                    NoteCreate(
                        author=req.agent_id,
                        kind="system",
                        content_md=(
                            f"Assigned review via A2A to `{req.agent_id}` (`{req.profile_id or req.agent_id}`) · "
                            f"model=`{routing_plan.get('model') or 'default'}` · "
                            f"skills={routing_plan.get('skill_ids') or []}."
                        ),
                    ),
                )
                t = db.get_ticket(slug, code) or existing_t
            else:
                t = db.claim_ticket(
                    slug,
                    code,
                    agent_id=req.agent_id,
                    branch_name=final_branch,
                    worktree_path=final_wt_path,
                    allow_review_deps=req.allow_review_deps,
                )
        except (ValueError, RuntimeError) as e:
            raise HTTPException(status_code=409, detail=str(e))

        launch_result: Optional[dict[str, Any]] = None
        a2a_dispatch: Optional[dict[str, Any]] = None
        default_repo_path, _ = resolve_workspace_and_worktrees_dir(proj)
        wt_for_cmd = final_wt_path or str(default_repo_path)
        effective_model = routing_plan.get("model") or req.model
        effective_effort = routing_plan.get("effort") or req.effort
        if prof:
            if req.dispatch_via_a2a:
                a2a_dispatch = dispatch_task_via_a2a(
                    prof,
                    slug,
                    t,
                    wt_for_cmd,
                    mcp_url=routing_plan.get("mcp_url") or "http://localhost:8765/mcp",
                    model=effective_model,
                    effort=effective_effort,
                    routing_plan=routing_plan,
                )
            if req.launch_agent:
                try:
                    launch_result = launch_agent_subprocess(
                        prof,
                        slug,
                        t,
                        wt_for_cmd,
                        model=effective_model,
                        effort=effective_effort,
                        routing_plan=routing_plan,
                        project=proj,
                    )
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
            else:
                launch_result = {
                    "spawned": False,
                    **build_agent_launch_command(
                        prof,
                        slug,
                        t,
                        wt_for_cmd,
                        model=effective_model,
                        effort=effective_effort,
                        routing_plan=routing_plan,
                    ),
                }

        s1 = routing_plan.get("systemone_decision")
        if s1 and not s1.get("fallback"):
            conf_val = s1.get("model_confidence")
            conf_str = f" · confidence: {conf_val:.0%}" if conf_val is not None else ""
            db.add_ticket_note(
                slug,
                code,
                NoteCreate(
                    author=req.agent_id,
                    kind="system",
                    content_md=(
                        f"🧠 **SystemOne Router ({s1.get('model_used', 'jev-latest')})** dynamically assigned model `{s1.get('model')}` "
                        f"with effort `{s1.get('effort')}` ({s1.get('latency_ms', 0)}ms{conf_str})."
                    ),
                ),
            )
            t = db.get_ticket(slug, code) or t

        await event_hub.broadcast(
            "ticket_claimed",
            {
                "project_slug": slug,
                "code": t["code"],
                "owner": req.agent_id,
                "a2a_task_id": a2a_dispatch.get("task_id") if a2a_dispatch else None,
            },
        )
        return {
            "ticket": t,
            "worktree": wt_info,
            "launch": launch_result,
            "a2a_dispatch": a2a_dispatch,
            "routing_plan": routing_plan,
            "systemone_decision": s1,
        }

    @router.post("/projects/{slug}/tickets/{code}/notes")
    async def add_note(slug: str, code: str, req: NoteCreate) -> dict[str, Any]:
        try:
            t = db.add_ticket_note(slug, code, req)
            await event_hub.broadcast("ticket_note_added", {"project_slug": slug, "code": code})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/proposals")
    async def propose_tickets(slug: str, code: str, req: ProposeTicketsRequest) -> dict[str, Any]:
        try:
            if req.auto_promote is None:
                proj_for_triage = db.get_project(slug) or {}
                triage_lane_cfg = (proj_for_triage.get("effective_lanes") or {}).get("triage") or {}
                req = req.model_copy(
                    update={
                        "auto_promote": triage_lane_cfg.get("triage_breakdown_policy")
                        == "auto-promote-todo"
                    }
                )
            t = db.propose_todo_tickets(slug, code, req)
            await event_hub.broadcast("triage_proposals_updated", {"project_slug": slug, "code": code})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/proposals/approve")
    async def approve_proposals(
        slug: str, code: str, proposal_ids: Optional[list[str]] = None
    ) -> dict[str, Any]:
        try:
            t = db.approve_triage_proposals(slug, code, proposal_ids=proposal_ids)
            await event_hub.broadcast("triage_proposals_approved", {"project_slug": slug, "code": code})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/proposals/{proposal_id}/reject")
    async def reject_proposal(slug: str, code: str, proposal_id: str) -> dict[str, Any]:
        try:
            t = db.reject_triage_proposal(slug, code, proposal_id)
            await event_hub.broadcast("triage_proposals_updated", {"project_slug": slug, "code": code})
            return t
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/tickets/{code}/research-findings")
    async def submit_research_findings(
        slug: str, code: str, req: TriageResearchFindingsRequest
    ) -> dict[str, Any]:
        try:
            report_lines = [f"### Research Findings (`{req.recommendation}`)"]
            if req.estimated_gain:
                report_lines.append(f"- **Estimated Gain / Roofline Impact:** {req.estimated_gain}")
            if req.exactness_impact:
                report_lines.append(f"- **Exactness Rule Impact:** `{req.exactness_impact}`")
            if req.attach_to_ticket_codes:
                report_lines.append(
                    f"- **Cross-Posted to Board Tickets:** {', '.join(f'`{c}`' for c in req.attach_to_ticket_codes)}"
                )
            report_lines.append("")
            report_lines.append(req.findings_md.strip())
            full_report = "\n".join(report_lines)

            db.add_ticket_note(
                slug,
                code,
                NoteCreate(
                    author=req.agent_id,
                    kind="question" if req.recommendation == "needs-decision" else "note",
                    content_md=full_report,
                ),
            )

            cross_posted: list[str] = []
            for target_code in req.attach_to_ticket_codes:
                try:
                    db.add_ticket_note(
                        slug,
                        target_code.strip(),
                        NoteCreate(
                            author=req.agent_id,
                            kind="note",
                            content_md=f"**External Scan / Triage `{code}` Findings:**\n{full_report}",
                        ),
                    )
                    cross_posted.append(target_code.strip())
                except ValueError:
                    pass

            if req.proposals:
                proj_for_triage = db.get_project(slug) or {}
                triage_lane_cfg = (proj_for_triage.get("effective_lanes") or {}).get("triage") or {}
                effective_auto_promote = (
                    req.auto_promote
                    if req.auto_promote is not None
                    else (triage_lane_cfg.get("triage_breakdown_policy") == "auto-promote-todo")
                )
                res = db.propose_todo_tickets(
                    slug,
                    code,
                    ProposeTicketsRequest(
                        proposed_by=req.agent_id,
                        proposals=req.proposals,
                        auto_promote=effective_auto_promote,
                    ),
                )
            elif req.recommendation in ("attach-to-existing", "not-worth-it"):
                res = db.update_ticket(
                    slug,
                    code,
                    TicketUpdate(status="done", triage_state="approved", owner=req.agent_id),
                )
                if req.recommendation == "not-worth-it":
                    db.post_message(
                        slug,
                        MessageCreate(
                            author=req.agent_id,
                            channel="general",
                            title=f"Investigated & Rejected ({code}): Do Not Redo",
                            body_md=full_report,
                            ticket_code=code,
                        ),
                    )
            elif req.recommendation == "needs-decision":
                res = db.update_ticket(
                    slug,
                    code,
                    TicketUpdate(triage_state="needs-info", owner=req.agent_id),
                )
            else:
                res = db.get_ticket(slug, code)  # type: ignore

            res["cross_posted_to"] = cross_posted
            await event_hub.broadcast("ticket_updated", {"project_slug": slug, "code": code})
            return res
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.get("/projects/{slug}/tickets/{code}/review-inspect")
    def inspect_review_ticket_endpoint(slug: str, code: str) -> dict[str, Any]:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        t = db.get_ticket(slug, code)
        if not t:
            raise HTTPException(status_code=404, detail=f"Ticket '{code}' not found")
        scan = inspect_review_branch_and_static_scan(proj, t)
        scan["notes"] = t.get("notes", [])
        return scan

    @router.post("/projects/{slug}/tickets/{code}/review")
    async def submit_ticket_review_endpoint(
        slug: str, code: str, req: ReviewTicketRequest
    ) -> dict[str, Any]:
        try:
            c_list = [i.strip() for i in req.code_issues if i and i.strip()]
            s_list = [i.strip() for i in req.security_issues if i and i.strip()]
            is_clean = len(c_list) == 0 and len(s_list) == 0

            proj = db.get_project(slug)
            rev_lane_cfg = ((proj or {}).get("effective_lanes") or {}).get("review") or {}
            human_gate = rev_lane_cfg.get("review_merge_policy") == "human-gate"
            should_merge = is_clean and req.verdict == "approve" and req.merge_if_clean and not human_gate

            merge_info: Optional[dict[str, Any]] = None
            if should_merge:
                t = db.get_ticket(slug, code)
                if proj and t:
                    merge_info = merge_ticket_branch_or_pr(proj, t)

            res = db.review_ticket(
                project_slug=slug,
                code=code,
                reviewer_agent_id=req.reviewer_agent_id,
                verdict=req.verdict,
                review_md=req.review_md,
                reviewer_model=req.reviewer_model,
                code_issues=c_list,
                security_issues=s_list,
                exactness_level=req.exactness_level,
                commit_sha=req.commit_sha,
                merge_info=merge_info,
                hold_in_review=(is_clean and req.verdict == "approve" and human_gate),
            )
            await event_hub.broadcast("ticket_updated", {"project_slug": slug, "code": code})
            return res
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    # ------------------------------------------------------------------
    # Feature Locks
    # ------------------------------------------------------------------
    @router.get("/locks")
    def list_locks(project_slug: Optional[str] = None) -> list[dict[str, Any]]:
        return db.list_locks(project_slug=project_slug)

    @router.post("/locks")
    async def create_or_update_lock(req: LockCreate) -> dict[str, Any]:
        lk = db.upsert_lock(req)
        await event_hub.broadcast("lock_updated", {"name": lk["name"]})
        return lk

    @router.post("/locks/{lock_name}/acquire")
    async def acquire_lock(lock_name: str, req: LockAcquireRequest) -> dict[str, Any]:
        res = db.acquire_lock(lock_name, req)
        await event_hub.broadcast("lock_updated", {"name": lock_name})
        return res

    @router.post("/locks/{lock_name}/release")
    async def release_lock(lock_name: str, req: LockReleaseRequest) -> dict[str, Any]:
        try:
            res = db.release_lock(lock_name, req.agent_id)
            await event_hub.broadcast("lock_updated", {"name": lock_name})
            return res
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/locks/{lock_name}/heartbeat")
    async def heartbeat_lock(lock_name: str, req: LockHeartbeatRequest) -> dict[str, Any]:
        try:
            res = db.heartbeat_lock(lock_name, req.agent_id, req.extend_minutes)
            await event_hub.broadcast("lock_updated", {"name": lock_name})
            return res
        except (ValueError, RuntimeError) as e:
            raise HTTPException(status_code=400, detail=str(e))

    # ------------------------------------------------------------------
    # Agents & Quota Handoff
    # ------------------------------------------------------------------
    @router.get("/projects/{slug}/agents")
    def list_agents(slug: str) -> list[dict[str, Any]]:
        try:
            return db.list_agents(slug)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/agents")
    async def upsert_agent(req: AgentUpsertRequest) -> dict[str, Any]:
        try:
            ag = db.upsert_agent(req)
            await event_hub.broadcast("agent_updated", {"agent_id": req.agent_id})
            return ag
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/agents/usage-exhausted")
    async def usage_exhausted(req: AgentUsageExhaustedRequest) -> dict[str, Any]:
        try:
            res = db.report_agent_usage_exhausted(req)
            await event_hub.broadcast("agent_usage_exhausted", res)
            return res
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    # ------------------------------------------------------------------
    # Auto-Detected & Custom Agent Profiles + Worktree Progress
    # ------------------------------------------------------------------
    @router.get("/agent-profiles")
    def get_agent_profiles() -> list[dict[str, Any]]:
        return discover_agent_profiles(db)

    @router.post("/agent-profiles")
    async def create_or_update_agent_profile(req: AgentProfileCreate) -> dict[str, Any]:
        try:
            if req.cli_command:
                validate_cli_command(req.cli_command)
            elif req.provider and req.provider.lower() != "a2a":
                validate_cli_command(req.provider.lower())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if req.config_path and not req.config_path.startswith(("http://", "https://")):
            try:
                validate_agent_config_path(req.config_path)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        prof = db.upsert_agent_profile(req)
        await event_hub.broadcast("agent_profile_updated", {"id": prof["id"]})
        all_profs = discover_agent_profiles(db)
        return next((p for p in all_profs if p["id"] == prof["id"]), prof)

    @router.delete("/agent-profiles/{profile_id}")
    async def remove_agent_profile(profile_id: str) -> dict[str, str]:
        db.delete_agent_profile(profile_id)
        evict_a2a_stream_events(profile_id)
        await event_hub.broadcast("agent_profile_deleted", {"id": profile_id})
        return {"deleted": profile_id}

    @router.post("/agent-profiles/{profile_id}/inject-mcp")
    async def inject_mcp_into_agent_profile(
        profile_id: str, req: InjectMcpConfigRequest
    ) -> dict[str, Any]:
        proj = db.get_project(req.project_slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{req.project_slug}' not found")
        profiles = discover_agent_profiles(db)
        prof = next((p for p in profiles if p["id"] == profile_id), None)
        if not prof:
            raise HTTPException(status_code=404, detail=f"Agent profile '{profile_id}' not found")
        if prof.get("config_path") and not str(prof["config_path"]).startswith(("http://", "https://")):
            try:
                validate_agent_config_path(str(prof["config_path"]))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
        g_settings = db.get_global_settings()
        effective_mcp_url = req.mcp_url or g_settings.get("mcp_url") or "http://localhost:8765/mcp"
        res = inject_mcp_and_skill_into_profile(
            prof,
            proj,
            mcp_url=effective_mcp_url,
            inject_skill=req.inject_skill,
            global_settings=g_settings,
        )
        await event_hub.broadcast("agent_profile_injected", res)
        return res

    # ------------------------------------------------------------------
    # A2A (Agent2Agent) Discovery, Agent Cards & JSON-RPC 2.0 Receiver
    # ------------------------------------------------------------------
    @router.get("/a2a/agent-card")
    def get_coordinator_agent_card() -> dict[str, Any]:
        return build_coordinator_agent_card()

    @router.get("/a2a/agents/{profile_id}/.well-known/agent.json")
    @router.get("/a2a/agents/{profile_id}/agent-card")
    def get_agent_profile_a2a_card(profile_id: str) -> dict[str, Any]:
        profiles = discover_agent_profiles(db)
        prof = next((p for p in profiles if p["id"] == profile_id), None)
        if not prof:
            raise HTTPException(status_code=404, detail=f"Agent '{profile_id}' not found")
        return prof.get("a2a_card") or {}

    @router.post("/a2a/scan")
    async def scan_a2a_agents_endpoint(req: A2AScanRequest) -> dict[str, Any]:
        newly_discovered: list[str] = []
        for ep in req.endpoints:
            cleaned = ep.strip()
            if not cleaned:
                continue
            card = await asyncio.to_thread(probe_remote_a2a_agent_card, cleaned)
            if card:
                agent_name = str(card.get("name") or "Remote A2A Agent")
                slug_id = "a2a-" + "".join(ch if ch.isalnum() else "-" for ch in agent_name.lower()).strip("-")[:24]
                db.upsert_agent_profile(
                    AgentProfileCreate(
                        id=slug_id,
                        name=agent_name,
                        provider="a2a",
                        config_path=str(card.get("url") or cleaned),
                        cli_command="a2a-jsonrpc",
                        default_args=str(card.get("url") or cleaned),
                    )
                )
                newly_discovered.append(slug_id)

        profiles = await asyncio.to_thread(discover_agent_profiles, db, extra_a2a_endpoints=req.endpoints)
        active_agents = [
            p
            for p in profiles
            if p.get("mounted") or p.get("activity_state") in ("active", "recent") or p.get("source") == "a2a-discovery"
        ]
        await event_hub.broadcast(
            "a2a_scan_completed",
            {"total": len(profiles), "active": len(active_agents), "newly_discovered": newly_discovered},
        )
        return {
            "scanned_at": now_iso(),
            "protocol_version": "0.2.1",
            "total_count": len(profiles),
            "active_count": len(active_agents),
            "newly_discovered": newly_discovered,
            "agents": profiles,
        }

    async def _build_a2a_sse_generator(prof: dict[str, Any], req_id: Any, task_id: str, session_id: str):
        """Yields standards-compliant A2A v0.2.1 JSON-RPC 2.0 SSE frames (TaskStatusUpdateEvent & TaskArtifactUpdateEvent)."""
        import asyncio
        import json

        profile_id = prof["id"]
        # 1. Initial TaskStatusUpdateEvent (working)
        init_res = {
            "id": task_id,
            "sessionId": session_id,
            "type": "status",
            "status": {
                "state": "working",
                "timestamp": now_iso(),
                "message": {
                    "role": "agent",
                    "parts": [
                        {
                            "type": "text",
                            "text": f"A2A SSE stream connected to '{prof['name']}' ({prof.get('a2a_transport', 'local-jsonrpc-sse')})",
                        }
                    ],
                },
            },
            "final": False,
        }
        record_a2a_stream_event(
            profile_id=profile_id,
            event_type="TaskStatusUpdateEvent",
            task_id=task_id,
            summary=f"SSE stream connected to {prof['name']} ({task_id})",
            state="working",
            final=False,
        )
        yield f"data: {json.dumps({'jsonrpc': '2.0', 'id': req_id, 'result': init_res})}\n\n"
        await asyncio.sleep(0.05)

        # 2. Emit recent transcript / artifact chunks as TaskArtifactUpdateEvent frames
        recent_events = (prof.get("recent_events") or [])[-4:]
        for idx, ev in enumerate(recent_events):
            summary_txt = ev.get("summary") or "Agent step completed"
            art_res = {
                "id": task_id,
                "sessionId": session_id,
                "type": "artifact",
                "artifact": {
                    "name": "agent-live-telemetry",
                    "index": idx,
                    "append": True,
                    "parts": [{"type": "text", "text": summary_txt}],
                },
                "final": False,
            }
            record_a2a_stream_event(
                profile_id=profile_id,
                event_type="TaskArtifactUpdateEvent",
                task_id=task_id,
                summary=summary_txt,
                state="working",
                final=False,
            )
            yield f"data: {json.dumps({'jsonrpc': '2.0', 'id': req_id, 'result': art_res})}\n\n"
            await asyncio.sleep(0.05)

        # 3. Emit final TaskStatusUpdateEvent
        final_state = "working" if prof.get("activity_state") == "active" else "completed"
        final_res = {
            "id": task_id,
            "sessionId": session_id,
            "type": "status",
            "status": {
                "state": final_state,
                "timestamp": now_iso(),
                "message": {
                    "role": "agent",
                    "parts": [
                        {
                            "type": "text",
                            "text": f"A2A SSE sync complete for '{prof['name']}' (state={final_state})",
                        }
                    ],
                },
            },
            "final": True,
        }
        record_a2a_stream_event(
            profile_id=profile_id,
            event_type="TaskStatusUpdateEvent",
            task_id=task_id,
            summary=f"A2A SSE sync complete for {prof['name']} (state={final_state})",
            state=final_state,
            final=True,
        )
        yield f"data: {json.dumps({'jsonrpc': '2.0', 'id': req_id, 'result': final_res})}\n\n"

    @router.get("/a2a/agents/{profile_id}/stream")
    async def stream_a2a_agent_sse(
        profile_id: str,
        task_id: Optional[str] = Query(default=None),
    ) -> StreamingResponse:
        profiles = discover_agent_profiles(db)
        prof = next((p for p in profiles if p["id"] == profile_id), None)
        if not prof:
            raise HTTPException(status_code=404, detail=f"A2A agent '{profile_id}' not found")
        tid = task_id or f"a2a-stream-{profile_id}"
        sid = f"a2a-session-{profile_id}"
        return StreamingResponse(
            _build_a2a_sse_generator(prof, "sse-1", tid, sid),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/a2a/agents/{profile_id}")
    async def a2a_jsonrpc_endpoint(profile_id: str, payload: dict[str, Any]) -> Any:
        req_id = payload.get("id", "req-1")
        method = payload.get("method", "")
        params = payload.get("params") or {}
        profiles = discover_agent_profiles(db)
        prof = next((p for p in profiles if p["id"] == profile_id), None)
        if not prof:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32001, "message": f"A2A agent '{profile_id}' not found"},
            }

        if method in ("tasks/sendSubscribe", "message/stream", "tasks/resubscribe"):
            task_id = str(params.get("id") or f"a2a-task-{profile_id}")
            session_id = str(params.get("sessionId") or f"a2a-session-{profile_id}")
            return StreamingResponse(
                _build_a2a_sse_generator(prof, req_id, task_id, session_id),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        elif method in ("tasks/send", "message/send"):
            task_id = params.get("id") or f"a2a-task-{profile_id}"
            session_id = params.get("sessionId") or f"a2a-session-{profile_id}"
            msg = params.get("message") or {}
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "id": task_id,
                    "sessionId": session_id,
                    "status": {
                        "state": "working",
                        "timestamp": now_iso(),
                        "message": {
                            "role": "agent",
                            "parts": [
                                {
                                    "type": "text",
                                    "text": f"Agent '{prof['name']}' accepted A2A task '{task_id}'.",
                                }
                            ],
                        },
                    },
                    "history": [msg] if msg else [],
                },
            }
        elif method == "tasks/get":
            task_id = params.get("id") or f"a2a-task-{profile_id}"
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "id": task_id,
                    "status": {
                        "state": "working" if prof.get("activity_state") == "active" else "completed",
                        "timestamp": now_iso(),
                    },
                },
            }
        elif method == "agent/authenticatedExtendedCard":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": prof.get("a2a_card") or {},
            }
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Unsupported A2A method '{method}'"},
        }

    @router.get("/projects/{slug}/worktrees")
    def get_project_worktrees(slug: str) -> dict[str, Any]:
        proj = db.get_project(slug)
        if not proj:
            raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
        repo_path, wt_dir = resolve_workspace_and_worktrees_dir(proj)
        allowed_roots = [wt_dir, repo_path]
        tickets = db.list_tickets(slug, include_notes=False)
        candidates = [
            t
            for t in tickets
            if t.get("worktree_path") or t["status"] in ("in-progress", "review", "blocked")
        ]

        def _inspect_one(t: dict[str, Any]) -> dict[str, Any]:
            wt_status = inspect_worktree_git_status(
                t.get("worktree_path") or "",
                allowed_roots=allowed_roots,
            )
            return {
                "ticket_code": t["code"],
                "ticket_title": t["title"],
                "status": t["status"],
                "owner": t.get("owner"),
                "branch_name": t.get("branch_name") or "",
                "worktree_path": t.get("worktree_path") or "",
                "git_status": wt_status,
            }

        if len(candidates) > 1:
            with ThreadPoolExecutor(max_workers=min(4, len(candidates))) as pool:
                worktree_items = list(pool.map(_inspect_one, candidates))
        else:
            worktree_items = [_inspect_one(t) for t in candidates]

        return {
            "workspace_path": str(repo_path),
            "workspace_exists": repo_path.exists(),
            "worktrees_dir": str(wt_dir),
            "worktrees_dir_exists": wt_dir.exists(),
            "worktrees": worktree_items,
        }

    # ------------------------------------------------------------------
    # Message Board
    # ------------------------------------------------------------------
    @router.get("/projects/{slug}/messages")
    def list_messages(
        slug: str, channel: Optional[str] = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        try:
            return db.list_messages(slug, channel=channel, limit=limit)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    @router.post("/projects/{slug}/messages")
    async def post_message(slug: str, req: MessageCreate) -> dict[str, Any]:
        try:
            msg = db.post_message(slug, req)
            await event_hub.broadcast("message_posted", {"project_slug": slug, "message": msg})
            return msg
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    return router
