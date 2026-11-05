#!/usr/bin/env python3
"""
Kanbanana — Standalone Remote A2A CLI Bridge (`a2a_cli_bridge.py`)

Wraps any local CLI coding agent (`kimi`, `claude`, `agy`, `minimax`, `grok`, `codex`, `opencode`)
on a remote machine or container into a standards-compliant A2A Protocol (v0.2.1) HTTP + JSON-RPC 2.0 server.

Features:
1. Serves `GET /.well-known/agent.json` & `GET /.well-known/agent-card.json` for Kanbanana auto-discovery.
2. Auto-wires the agent's MCP config (`mcp.json` / `.mcp.json` / `mcp_config.json`) and fetches
   `SKILL.md` + `CODE_REVIEW_SKILL.md` from the central Kanbanana server on startup.
3. Accepts `POST /` JSON-RPC 2.0 `tasks/send` (and `tasks/get`, `tasks/cancel`), provisions the git
   worktree on the remote machine, and spawns the CLI agent (`kimi --print ...`, `claude -p ...`, etc.).
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

ALLOWED_CLI_BINARIES: frozenset[str] = frozenset(
    {
        "kimi",
        "claude",
        "agy",
        "minimax",
        "minimax-code",
        "grok",
        "codex",
        "cursor",
        "opencode",
    }
)
_SAFE_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SAFE_BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")


def validate_cli_command(cli_cmd: str) -> str:
    cleaned = (cli_cmd or "").strip()
    if not cleaned:
        raise ValueError("Empty CLI command")
    base = Path(cleaned).name.lower()
    if base.endswith(".exe"):
        base = base[:-4]
    if base not in ALLOWED_CLI_BINARIES:
        raise ValueError(f"CLI command '{cleaned}' is not in ALLOWED_CLI_BINARIES ({sorted(ALLOWED_CLI_BINARIES)})")
    return base


def sanitize_slug(value: str, fallback: str = "task") -> str:
    cleaned = (value or "").strip()
    if not _SAFE_SLUG_RE.match(cleaned) or ".." in cleaned:
        return fallback
    return cleaned


def sanitize_git_branch(branch: str, fallback: str = "board/task") -> str:
    cleaned = (branch or "").strip()
    if not cleaned or cleaned.startswith("-") or ".." in cleaned or not _SAFE_BRANCH_RE.match(cleaned):
        return fallback
    return cleaned


PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "kimi": {
        "org": "Moonshot AI · Kimi Code",
        "cli": "kimi",
        "args": "",
        "mcp_file": "mcp.json",
        "default_config_dir": "~/.kimi",
    },
    "claude": {
        "org": "Anthropic · Claude Code",
        "cli": "claude",
        "args": "",
        "mcp_file": ".mcp.json",
        "default_config_dir": "~/.claude",
    },
    "antigravity": {
        "org": "Google DeepMind · Antigravity",
        "cli": "agy",
        "args": "",
        "mcp_file": "mcp_config.json",
        "default_config_dir": "~/.antigravity",
    },
    "minimax": {
        "org": "MiniMax · Coding Agent",
        "cli": "minimax",
        "args": "",
        "mcp_file": "mcp.json",
        "default_config_dir": "~/.minimax",
    },
    "grok": {
        "org": "xAI · Grok CLI",
        "cli": "grok",
        "args": "",
        "mcp_file": "mcp.json",
        "default_config_dir": "~/.grok",
    },
    "codex": {
        "org": "OpenAI · Codex CLI",
        "cli": "codex",
        "args": "--full-auto",
        "mcp_file": "mcp.json",
        "default_config_dir": "~/.codex",
    },
    "opencode": {
        "org": "OpenCode · CLI",
        "cli": "opencode",
        "args": "",
        "mcp_file": "opencode.json",
        "default_config_dir": "~/.config/opencode",
    },
}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class RemoteA2ABridgeState:
    def __init__(
        self,
        provider: str,
        agent_name: str,
        cli_command: str,
        default_args: str,
        config_dir: Path,
        workspace_dir: Path,
        worktrees_dir: Path,
        kanbanana_url: str,
        project_slug: str,
        public_url: str,
        auto_spawn_cli: bool = True,
        auth_token: str = "",
    ) -> None:
        self.provider = provider.lower()
        self.agent_name = agent_name
        self.cli_command = validate_cli_command(cli_command)
        self.default_args = default_args
        self.config_dir = config_dir
        self.workspace_dir = workspace_dir
        self.worktrees_dir = worktrees_dir
        self.kanbanana_url = kanbanana_url.rstrip("/")
        self.project_slug = sanitize_slug(project_slug, fallback="default")
        self.public_url = public_url.rstrip("/")
        self.auto_spawn_cli = auto_spawn_cli
        self.auth_token = auth_token.strip()
        self.tasks: dict[str, dict[str, Any]] = {}
        self.processes: dict[str, subprocess.Popen] = {}
        self.lock = threading.Lock()
        self.last_active_at: str = now_iso()

    @property
    def kanbananna_url(self) -> str:
        return self.kanbanana_url

    def wire_mcp_and_skills(self) -> dict[str, Any]:
        """Writes MCP config and downloads SKILL.md + CODE_REVIEW_SKILL.md from Kanbanana."""
        self.config_dir.mkdir(parents=True, exist_ok=True)
        pdef = PROVIDER_DEFAULTS.get(self.provider, PROVIDER_DEFAULTS["kimi"])
        mcp_file = self.config_dir / pdef["mcp_file"]
        mcp_url = f"{self.kanbanana_url}/mcp"

        existing: dict[str, Any] = {}
        if mcp_file.exists():
            try:
                existing = json.loads(mcp_file.read_text(encoding="utf-8"))
            except Exception:
                existing = {}
        if not isinstance(existing.get("mcpServers"), dict):
            existing["mcpServers"] = {}
        existing["mcpServers"]["kanbanana"] = {
            "url": mcp_url,
            "transport": "http",
        }
        mcp_file.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")

        skills_dir = self.config_dir / "skills"
        skills_written: list[str] = []
        for endpoint_suffix, folder_suffix in [
            ("skill.md", f"{self.project_slug}-board"),
            ("code-review-skill.md", f"{self.project_slug}-code-review"),
        ]:
            url = f"{self.kanbanana_url}/api/projects/{self.project_slug}/{endpoint_suffix}"
            try:
                req = urllib.request.Request(url, headers={"Accept": "text/markdown, text/plain"})
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    if resp.status == 200:
                        content = resp.read().decode("utf-8", errors="replace")
                        target = skills_dir / folder_suffix / "SKILL.md"
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(content, encoding="utf-8")
                        skills_written.append(str(target))
            except Exception:
                pass

        # Also persist .well-known/agent.json inside the agent's config folder
        wk_file = self.config_dir / ".well-known" / "agent.json"
        wk_file.parent.mkdir(parents=True, exist_ok=True)
        wk_file.write_text(json.dumps(self.build_agent_card(), indent=2) + "\n", encoding="utf-8")

        return {
            "mcp_config_file": str(mcp_file),
            "mcp_url": mcp_url,
            "skills_written": skills_written,
            "agent_card_file": str(wk_file),
        }

    def active_task_count(self) -> int:
        with self.lock:
            alive = 0
            for tid, proc in list(self.processes.items()):
                if proc.poll() is None:
                    alive += 1
                else:
                    if tid in self.tasks and self.tasks[tid]["status"]["state"] == "working":
                        rc = proc.returncode
                        self.tasks[tid]["status"] = {
                            "state": "completed" if rc == 0 else "failed",
                            "timestamp": now_iso(),
                            "return_code": rc,
                        }
            return alive

    def build_agent_card(self) -> dict[str, Any]:
        pdef = PROVIDER_DEFAULTS.get(self.provider, PROVIDER_DEFAULTS["kimi"])
        hostname = socket.gethostname()
        running = self.active_task_count()
        return {
            "name": self.agent_name,
            "description": (
                f"Remote A2A CLI Bridge for {self.agent_name} ({self.provider} via `{self.cli_command}`) "
                f"on host '{hostname}'. Connected to Kanbanana project '{self.project_slug}'."
            ),
            "url": self.public_url,
            "well_known_url": f"{self.public_url}/.well-known/agent.json",
            "provider": {
                "organization": pdef["org"],
                "url": self.public_url,
            },
            "version": "1.0.0",
            "protocolVersion": "0.2.1",
            "capabilities": {
                "streaming": True,
                "pushNotifications": False,
                "stateTransitionHistory": True,
            },
            "defaultInputModes": ["text/plain", "application/json"],
            "defaultOutputModes": ["text/plain", "application/json"],
            "skills": [
                {
                    "id": f"{self.project_slug}-task-execution",
                    "name": "Remote Git Worktree Task Execution",
                    "description": f"Executes assigned board tickets via `{self.cli_command}` in isolated git worktrees on {hostname}.",
                    "tags": ["kanban", "worktree", "mcp", "a2a", self.provider],
                },
                {
                    "id": f"{self.project_slug}-triage-research",
                    "name": "External Scan & Feature Triage ('X uses Y to do Z')",
                    "description": "Investigates external repos/PRs and posts structured findings via MCP.",
                    "tags": ["triage", "research", "a2a"],
                },
                {
                    "id": f"{self.project_slug}-code-review",
                    "name": "Mid-Tier Code & Security Review + Merge Gate",
                    "description": "Audits review tickets for code & security issues and merges clean branches.",
                    "tags": ["code-review", "security", "merge", "a2a"],
                },
            ],
            "status": {
                "reachable": True,
                "activity_state": "active" if running > 0 else "idle",
                "running_tasks": running,
                "last_active_at": self.last_active_at,
                "hostname": hostname,
            },
        }

    def prepare_worktree(self, project_slug: str, ticket_code: str, branch_name: str, requested_wt: str = "") -> Path:
        self.worktrees_dir.mkdir(parents=True, exist_ok=True)
        safe_proj = sanitize_slug(project_slug, fallback=self.project_slug)
        safe_ticket = sanitize_slug(ticket_code, fallback="task")
        slug_branch = sanitize_git_branch(branch_name, fallback=f"board/{safe_ticket.lower()}")
        safe_folder = f"{safe_proj}-{safe_ticket.lower()}"
        target_wt = (self.worktrees_dir / safe_folder).resolve()
        if not target_wt.is_relative_to(self.worktrees_dir.resolve()):
            raise ValueError("Worktree path escapes worktrees_dir")

        if (self.workspace_dir / ".git").exists() and not target_wt.exists():
            try:
                subprocess.run(
                    ["git", "-C", str(self.workspace_dir), "worktree", "add", "-B", slug_branch, "--", str(target_wt)],
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
            except Exception:
                pass

        target_wt.mkdir(parents=True, exist_ok=True)
        return target_wt

    def build_cli_argv(self, prompt: str, model: str = "", effort: str = "") -> list[str]:
        extra = [a for a in self.default_args.split(" ") if a.strip()]
        model_flags: list[str] = []
        if model and re.match(r"^[A-Za-z0-9._:/-]+$", model):
            model_flags.extend(["--model", model])
        if effort and effort in ("low", "medium", "high", "max"):
            model_flags.extend(["--effort", effort])
        if self.provider == "claude":
            return [self.cli_command, *model_flags, *extra, "-p", prompt]
        elif self.provider == "kimi":
            return [self.cli_command, *model_flags, *extra, "--print", prompt]
        elif self.provider == "codex":
            return [self.cli_command, *model_flags, *extra, "exec", prompt]
        else:
            return [self.cli_command, *model_flags, *extra, prompt]

    def handle_task_send(self, params: dict[str, Any]) -> dict[str, Any]:
        task_id = str(params.get("id") or f"a2a-task-{uuid.uuid4().hex[:8]}")
        session_id = str(params.get("sessionId") or f"a2a-session-{uuid.uuid4().hex[:8]}")
        message = params.get("message") or {}
        parts = message.get("parts") or []

        instruction_text = ""
        task_data: dict[str, Any] = {}
        for part in parts:
            if isinstance(part, dict):
                if part.get("type") == "text" and part.get("text"):
                    instruction_text = str(part["text"])
                elif part.get("type") == "data" and isinstance(part.get("data"), dict):
                    task_data = part["data"]

        project_slug = str(task_data.get("project_slug") or self.project_slug)
        ticket_code = str(task_data.get("ticket_code") or "TASK")
        branch_name = str(task_data.get("branch_name") or f"board/{ticket_code.lower()}")
        req_wt = str(task_data.get("worktree_path") or "")
        req_model = str(task_data.get("model") or "")
        req_effort = str(task_data.get("effort") or "")

        wt_path = self.prepare_worktree(project_slug, ticket_code, branch_name, req_wt)
        if not instruction_text:
            instruction_text = (
                f"Work on ticket {ticket_code} on project '{project_slug}' via MCP ({self.kanbanana_url}/mcp) "
                f"in worktree '{wt_path}'."
            )

        argv = self.build_cli_argv(instruction_text, model=req_model, effort=req_effort)
        ts = now_iso()
        self.last_active_at = ts

        log_file = wt_path / ".kanbanana-agent.log"
        entry = {
            "timestamp": ts,
            "type": "A2A_REMOTE_TASK_SEND",
            "task_id": task_id,
            "session_id": session_id,
            "ticket_code": ticket_code,
            "argv": argv,
            "content": instruction_text,
        }
        with log_file.open("a", encoding="utf-8") as lf:
            lf.write(json.dumps(entry) + "\n")

        spawned_pid: Optional[int] = None
        spawn_error: Optional[str] = None
        if self.auto_spawn_cli:
            try:
                with log_file.open("a", encoding="utf-8") as out_handle:
                    proc = subprocess.Popen(
                        argv,
                        cwd=str(wt_path),
                        stdout=out_handle,
                        stderr=subprocess.STDOUT,
                        text=True,
                    )
                spawned_pid = proc.pid
                with self.lock:
                    self.processes[task_id] = proc
            except Exception as e:
                spawn_error = str(e)

        task_record = {
            "id": task_id,
            "sessionId": session_id,
            "ticket_code": ticket_code,
            "worktree_path": str(wt_path),
            "cli_argv": argv,
            "pid": spawned_pid,
            "spawn_error": spawn_error,
            "log_file": str(log_file),
            "stream_url": f"{self.public_url}/stream?task_id={task_id}",
            "status": {
                "state": "working",
                "timestamp": ts,
                "message": {
                    "role": "agent",
                    "parts": [
                        {
                            "type": "text",
                            "text": (
                                f"Remote A2A agent '{self.agent_name}' accepted task {task_id} "
                                f"for ticket {ticket_code} in worktree {wt_path}"
                                + (f" (PID {spawned_pid})" if spawned_pid else "")
                            ),
                        }
                    ],
                },
            },
            "history": [message] if message else [],
        }
        with self.lock:
            self.tasks[task_id] = task_record
        return task_record

    def handle_task_get(self, params: dict[str, Any]) -> Optional[dict[str, Any]]:
        task_id = str(params.get("id") or "")
        self.active_task_count()
        with self.lock:
            task = self.tasks.get(task_id)
            if not task:
                return None
            result = dict(task)
        log_p = Path(result.get("log_file") or "")
        if log_p.exists():
            try:
                lines = log_p.read_text(encoding="utf-8", errors="replace").splitlines()
                result["log_tail"] = lines[-20:]
            except Exception:
                result["log_tail"] = []
        return result

    def handle_task_cancel(self, params: dict[str, Any]) -> Optional[dict[str, Any]]:
        task_id = str(params.get("id") or "")
        with self.lock:
            proc = self.processes.get(task_id)
            if proc and proc.poll() is None:
                proc.terminate()
            task = self.tasks.get(task_id)
            if not task:
                return None
            task["status"] = {"state": "canceled", "timestamp": now_iso()}
            return dict(task)


def make_handler(state: RemoteA2ABridgeState):
    class A2ABridgeHandler(BaseHTTPRequestHandler):
        def _send_json(self, code: int, payload: dict[str, Any]) -> None:
            raw = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Access-Control-Allow-Origin", state.kanbanana_url or "http://localhost:8765")
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", state.kanbanana_url or "http://localhost:8765")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.end_headers()

        def _stream_task_sse(self, req_id: Any, task_res: dict[str, Any]) -> None:
            """Streams A2A v0.2.1 TaskStatusUpdateEvent & TaskArtifactUpdateEvent over Server-Sent Events."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", state.kanbanana_url or "http://localhost:8765")
            self.end_headers()

            def write_sse(result_obj: dict[str, Any]) -> bool:
                frame = f"data: {json.dumps({'jsonrpc': '2.0', 'id': req_id, 'result': result_obj})}\n\n"
                try:
                    self.wfile.write(frame.encode("utf-8"))
                    self.wfile.flush()
                    return True
                except Exception:
                    return False

            task_id = task_res.get("id", "a2a-task")
            session_id = task_res.get("sessionId", "a2a-session")

            # 1. Emit initial TaskStatusUpdateEvent (working)
            if not write_sse(
                {
                    "id": task_id,
                    "sessionId": session_id,
                    "type": "status",
                    "status": task_res.get("status") or {"state": "working", "timestamp": now_iso()},
                    "final": False,
                }
            ):
                return

            # 2. Stream log lines as TaskArtifactUpdateEvent frames
            log_p = Path(task_res.get("log_file") or "")
            seen_lines = 0
            max_ticks = 20 if state.auto_spawn_cli else 2
            for tick in range(max_ticks):
                if log_p.exists():
                    try:
                        lines = log_p.read_text(encoding="utf-8", errors="replace").splitlines()
                        new_lines = lines[seen_lines:]
                        seen_lines = len(lines)
                        for idx, ln in enumerate(new_lines):
                            if not write_sse(
                                {
                                    "id": task_id,
                                    "sessionId": session_id,
                                    "type": "artifact",
                                    "artifact": {
                                        "name": "agent-transcript",
                                        "index": idx,
                                        "append": True,
                                        "parts": [{"type": "text", "text": ln}],
                                    },
                                    "final": False,
                                }
                            ):
                                return
                    except Exception:
                        pass
                with state.lock:
                    proc = state.processes.get(task_id)
                if not proc or proc.poll() is not None:
                    break
                time.sleep(0.15)

            # 3. Emit final TaskStatusUpdateEvent
            write_sse(
                {
                    "id": task_id,
                    "sessionId": session_id,
                    "type": "status",
                    "status": {
                        "state": "working" if state.active_task_count() > 0 else "completed",
                        "timestamp": now_iso(),
                        "message": {
                            "role": "agent",
                            "parts": [
                                {
                                    "type": "text",
                                    "text": f"A2A SSE stream sync complete for {task_id} on {state.agent_name}",
                                }
                            ],
                        },
                    },
                    "final": True,
                }
            )

        def do_GET(self) -> None:  # noqa: N802
            parts = self.path.split("?", 1)
            path = parts[0].rstrip("/") or "/"
            query = parts[1] if len(parts) > 1 else ""
            if path in ("/.well-known/agent.json", "/.well-known/agent-card.json", "/agent.json"):
                self._send_json(200, state.build_agent_card())
            elif path == "/stream":
                task_id = ""
                for kv in query.split("&"):
                    if kv.startswith("task_id="):
                        task_id = kv.split("=", 1)[1]
                with state.lock:
                    task_res = state.tasks.get(task_id) if task_id else (
                        next(reversed(state.tasks.values()), None) if state.tasks else None
                    )
                if not task_res:
                    task_res = {
                        "id": task_id or f"a2a-heartbeat-{uuid.uuid4().hex[:6]}",
                        "sessionId": "a2a-live-stream",
                        "status": {
                            "state": "working",
                            "timestamp": now_iso(),
                            "message": {
                                "role": "agent",
                                "parts": [
                                    {
                                        "type": "text",
                                        "text": f"A2A SSE stream connected to {state.agent_name} ({state.provider})",
                                    }
                                ],
                            },
                        },
                    }
                self._stream_task_sse("sse-stream", task_res)
            elif path == "/health":
                self._send_json(
                    200,
                    {
                        "status": "ok",
                        "agent_name": state.agent_name,
                        "provider": state.provider,
                        "streaming": True,
                        "running_tasks": state.active_task_count(),
                    },
                )
            else:
                self._send_json(404, {"error": f"Path '{path}' not found"})

        def do_POST(self) -> None:  # noqa: N802
            if state.auth_token:
                auth_header = self.headers.get("Authorization", "")
                bearer = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
                if not bearer or not hmac.compare_digest(bearer, state.auth_token):
                    self._send_json(
                        401,
                        {"jsonrpc": "2.0", "id": None, "error": {"code": -32000, "message": "Unauthorized"}},
                    )
                    return

            length = int(self.headers.get("Content-Length") or 0)
            if length > 1048576:
                self._send_json(
                    413,
                    {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Payload too large"}},
                )
                return
            raw = self.rfile.read(length).decode("utf-8", errors="replace") if length > 0 else "{}"
            try:
                payload = json.loads(raw)
            except Exception:
                self._send_json(
                    400,
                    {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
                )
                return

            req_id = payload.get("id", "req-1")
            method = payload.get("method", "")
            params = payload.get("params") or {}

            if method in ("tasks/send", "message/send"):
                task_res = state.handle_task_send(params)
                self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "result": task_res})
            elif method in ("tasks/sendSubscribe", "message/stream"):
                task_res = state.handle_task_send(params)
                self._stream_task_sse(req_id, task_res)
            elif method == "tasks/resubscribe":
                task_res = state.handle_task_get(params)
                if not task_res:
                    self._send_json(
                        200,
                        {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32001, "message": "Task not found"}},
                    )
                else:
                    self._stream_task_sse(req_id, task_res)
            elif method == "tasks/get":
                task_res = state.handle_task_get(params)
                if not task_res:
                    self._send_json(
                        200,
                        {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32001, "message": "Task not found"}},
                    )
                else:
                    self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "result": task_res})
            elif method == "tasks/cancel":
                task_res = state.handle_task_cancel(params)
                if not task_res:
                    self._send_json(
                        200,
                        {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32001, "message": "Task not found"}},
                    )
                else:
                    self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "result": task_res})
            elif method == "agent/authenticatedExtendedCard":
                self._send_json(200, {"jsonrpc": "2.0", "id": req_id, "result": state.build_agent_card()})
            else:
                self._send_json(
                    200,
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32601, "message": f"Unsupported A2A method '{method}'"},
                    },
                )

        def log_message(self, format: str, *args: Any) -> None:
            if os.environ.get("A2A_QUIET") == "1":
                return
            super().log_message(format, *args)

    return A2ABridgeHandler


def create_bridge_server(
    host: str = "127.0.0.1",
    port: int = 8081,
    provider: str = "kimi",
    agent_name: str = "",
    cli_command: str = "",
    default_args: str = "",
    config_dir: Optional[Path] = None,
    workspace_dir: Optional[Path] = None,
    worktrees_dir: Optional[Path] = None,
    kanbanana_url: str = "http://localhost:8765",
    project_slug: str = "default",
    public_url: str = "",
    auto_spawn_cli: bool = True,
    wire_on_start: bool = True,
    auth_token: str = "",
) -> tuple[ThreadingHTTPServer, RemoteA2ABridgeState]:
    import secrets

    prov = provider.lower()
    pdef = PROVIDER_DEFAULTS.get(prov, PROVIDER_DEFAULTS["kimi"])
    final_cli = cli_command or pdef["cli"]
    final_args = default_args if default_args != "" else pdef["args"]
    final_cfg = config_dir or Path(os.path.expanduser(pdef["default_config_dir"]))
    final_ws = workspace_dir or Path("/workspaces/project")
    final_wt = worktrees_dir or Path("/workspaces/worktrees")
    final_name = agent_name or f"{pdef['org'].split('·')[-1].strip()} ({socket.gethostname()})"
    final_token = (auth_token or os.environ.get("A2A_AUTH_TOKEN", "")).strip()
    if (
        not final_token
        and host.strip().lower() not in ("127.0.0.1", "localhost", "::1")
        and os.environ.get("A2A_ALLOW_INSECURE_BIND") != "1"
    ):
        final_token = secrets.token_urlsafe(24)
        print(f"[a2a-bridge-security] Non-loopback bind ({host}) auto-generated A2A_AUTH_TOKEN={final_token}")

    server = ThreadingHTTPServer((host, port), lambda *a, **kw: None)  # placeholder handler
    actual_port = server.server_address[1]
    final_public_url = public_url or f"http://127.0.0.1:{actual_port}"

    state = RemoteA2ABridgeState(
        provider=prov,
        agent_name=final_name,
        cli_command=final_cli,
        default_args=final_args,
        config_dir=final_cfg,
        workspace_dir=final_ws,
        worktrees_dir=final_wt,
        kanbanana_url=kanbanana_url,
        project_slug=project_slug,
        public_url=final_public_url,
        auto_spawn_cli=auto_spawn_cli,
        auth_token=final_token,
    )
    server.RequestHandlerClass = make_handler(state)
    if wire_on_start:
        state.wire_mcp_and_skills()
    return server, state


def main() -> None:
    parser = argparse.ArgumentParser(description="Kanbanana Remote A2A CLI Bridge")
    parser.add_argument("--host", default=os.environ.get("A2A_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("A2A_PORT", "8081")))
    parser.add_argument("--provider", default=os.environ.get("A2A_AGENT_PROVIDER", "kimi"))
    parser.add_argument("--name", default=os.environ.get("A2A_AGENT_NAME", ""))
    parser.add_argument("--cli", default=os.environ.get("A2A_AGENT_CLI", ""))
    parser.add_argument("--args", default=os.environ.get("A2A_AGENT_DEFAULT_ARGS", ""))
    parser.add_argument("--config-dir", default=os.environ.get("A2A_CONFIG_DIR", ""))
    parser.add_argument("--workspace-dir", default=os.environ.get("A2A_WORKSPACE_DIR", "/workspaces/project"))
    parser.add_argument("--worktrees-dir", default=os.environ.get("A2A_WORKTREES_DIR", "/workspaces/worktrees"))
    parser.add_argument(
        "--kanbanana-url",
        default=os.environ.get("KANBANANA_URL") or os.environ.get("KANBANANNA_URL", "http://localhost:8765"),
    )
    parser.add_argument(
        "--project-slug",
        default=os.environ.get("KANBANANA_PROJECT_SLUG") or os.environ.get("KANBANANNA_PROJECT_SLUG", "default"),
    )
    parser.add_argument("--public-url", default=os.environ.get("A2A_PUBLIC_URL", ""))
    parser.add_argument("--auth-token", default=os.environ.get("A2A_AUTH_TOKEN", ""))
    parser.add_argument(
        "--no-spawn",
        action="store_true",
        default=os.environ.get("A2A_AUTO_SPAWN_CLI", "1") == "0",
    )
    opts = parser.parse_args()

    cfg_path = Path(os.path.expanduser(opts.config_dir)) if opts.config_dir else None
    server, state = create_bridge_server(
        host=opts.host,
        port=opts.port,
        provider=opts.provider,
        agent_name=opts.name,
        cli_command=opts.cli,
        default_args=opts.args,
        config_dir=cfg_path,
        workspace_dir=Path(opts.workspace_dir),
        worktrees_dir=Path(opts.worktrees_dir),
        kanbanana_url=opts.kanbanana_url,
        project_slug=opts.project_slug,
        public_url=opts.public_url or f"http://localhost:{opts.port}",
        auto_spawn_cli=not opts.no_spawn,
        wire_on_start=True,
        auth_token=opts.auth_token,
    )
    print(
        f"[Kanbanana Remote A2A Bridge] Serving {state.agent_name} ({state.provider}) "
        f"at http://{opts.host}:{opts.port}/.well-known/agent.json -> MCP {state.kanbanana_url}/mcp"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main()
