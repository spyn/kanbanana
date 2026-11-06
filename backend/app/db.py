from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from .models import (
    AgentProfileCreate,
    AgentUpsertRequest,
    AgentUsageExhaustedRequest,
    GlobalSettingsUpdate,
    LockAcquireRequest,
    LockCreate,
    MessageCreate,
    NoteCreate,
    ProjectCreate,
    ProjectSettings,
    ProjectUpdate,
    ProposeTicketsRequest,
    SectionCreate,
    SkillConfig,
    TicketCreate,
    TicketUpdate,
)
from .routing_config import (
    build_default_global_settings,
    normalize_global_settings,
    normalize_project_settings,
    resolve_effective_project_lanes,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class Database:
    def __init__(self, db_path: str | Path | None = None) -> None:
        if db_path is None:
            env_path = os.environ.get("KANBANANA_DB_PATH")
            if env_path:
                Path(env_path).parent.mkdir(parents=True, exist_ok=True)
                db_path = env_path
            else:
                default_dir = Path(__file__).resolve().parent.parent / "data"
                default_dir.mkdir(parents=True, exist_ok=True)
                db_path = default_dir / "kanbanana.db"
        self.db_path = str(db_path)
        self._write_lock = threading.RLock()
        self._local = threading.local()
        self.init_db()

    def _get_thread_conn(self) -> sqlite3.Connection:
        conn: Optional[sqlite3.Connection] = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.execute("SELECT 1")
                return conn
            except sqlite3.ProgrammingError:
                self._local.conn = None
        conn = sqlite3.connect(self.db_path, timeout=30.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA busy_timeout=10000;")
        self._local.conn = conn
        return conn

    def close(self) -> None:
        conn: Optional[sqlite3.Connection] = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            self._local.conn = None

    @contextmanager
    def connect(self, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        if immediate:
            with self._write_lock:
                conn = self._get_thread_conn()
                if conn.in_transaction:
                    yield conn
                    return
                try:
                    conn.execute("BEGIN IMMEDIATE;")
                    yield conn
                    if conn.in_transaction:
                        conn.execute("COMMIT;")
                except Exception:
                    if conn.in_transaction:
                        conn.execute("ROLLBACK;")
                    raise
        else:
            conn = self._get_thread_conn()
            if conn.in_transaction:
                yield conn
                return
            try:
                conn.execute("BEGIN;")
                yield conn
                if conn.in_transaction:
                    conn.execute("COMMIT;")
            except Exception:
                if conn.in_transaction:
                    conn.execute("ROLLBACK;")
                raise

    def init_db(self) -> None:
        with self._write_lock:
            init_conn = self._get_thread_conn()
            init_conn.execute("PRAGMA journal_mode=WAL;")
            init_conn.execute("PRAGMA synchronous=NORMAL;")
        with self.connect(immediate=True) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    repo_path TEXT NOT NULL DEFAULT '',
                    worktrees_dir TEXT NOT NULL DEFAULT '',
                    board_background_md TEXT NOT NULL DEFAULT '',
                    skill_config_json TEXT NOT NULL DEFAULT '{}',
                    project_settings_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS global_settings (
                    id TEXT PRIMARY KEY,
                    settings_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS agent_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL DEFAULT 'custom',
                    config_path TEXT NOT NULL,
                    cli_command TEXT NOT NULL DEFAULT '',
                    default_args TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sections (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    code TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description_md TEXT NOT NULL DEFAULT '',
                    position INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(project_id, code)
                );

                CREATE TABLE IF NOT EXISTS tickets (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
                    code TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'triage',
                    triage_state TEXT NOT NULL DEFAULT 'new',
                    owner TEXT,
                    depends_on_json TEXT NOT NULL DEFAULT '[]',
                    files_md TEXT NOT NULL DEFAULT '',
                    do_md TEXT NOT NULL DEFAULT '',
                    done_when_md TEXT NOT NULL DEFAULT '',
                    blocked_reason TEXT NOT NULL DEFAULT '',
                    branch_name TEXT NOT NULL DEFAULT '',
                    worktree_path TEXT NOT NULL DEFAULT '',
                    pr_url TEXT NOT NULL DEFAULT '',
                    commit_sha TEXT NOT NULL DEFAULT '',
                    exactness_level TEXT NOT NULL DEFAULT '',
                    parent_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
                    is_held INTEGER NOT NULL DEFAULT 0,
                    position INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(project_id, code)
                );

                CREATE TABLE IF NOT EXISTS ticket_notes (
                    id TEXT PRIMARY KEY,
                    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    author TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'note',
                    content_md TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ticket_proposals (
                    id TEXT PRIMARY KEY,
                    triage_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    proposed_by TEXT NOT NULL,
                    code TEXT NOT NULL,
                    title TEXT NOT NULL,
                    section_code TEXT NOT NULL DEFAULT '1',
                    depends_on_json TEXT NOT NULL DEFAULT '[]',
                    files_md TEXT NOT NULL DEFAULT '',
                    do_md TEXT NOT NULL DEFAULT '',
                    done_when_md TEXT NOT NULL DEFAULT '',
                    rationale_md TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS feature_locks (
                    id TEXT PRIMARY KEY,
                    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                    name TEXT NOT NULL UNIQUE,
                    max_slots INTEGER NOT NULL DEFAULT 1,
                    description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS lock_claims (
                    id TEXT PRIMARY KEY,
                    lock_id TEXT NOT NULL REFERENCES feature_locks(id) ON DELETE CASCADE,
                    agent_id TEXT NOT NULL,
                    ticket_code TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'held',
                    reason TEXT NOT NULL DEFAULT '',
                    acquired_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    released_at TEXT
                );

                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT NOT NULL,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    status TEXT NOT NULL DEFAULT 'active',
                    current_ticket_code TEXT,
                    worktree_path TEXT NOT NULL DEFAULT '',
                    branch_name TEXT NOT NULL DEFAULT '',
                    usage_reset_at TEXT,
                    handoff_note TEXT NOT NULL DEFAULT '',
                    last_seen_at TEXT NOT NULL,
                    PRIMARY KEY (id, project_id)
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    author TEXT NOT NULL,
                    channel TEXT NOT NULL DEFAULT 'agents',
                    title TEXT NOT NULL,
                    body_md TEXT NOT NULL,
                    ticket_code TEXT NOT NULL DEFAULT '',
                    pinned INTEGER NOT NULL DEFAULT 0,
                    parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_tickets_project_status ON tickets(project_id, status);
                CREATE INDEX IF NOT EXISTS idx_tickets_project_code ON tickets(project_id, code);
                CREATE INDEX IF NOT EXISTS idx_tickets_project_owner ON tickets(project_id, owner);
                CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket ON ticket_notes(ticket_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_ticket_proposals_triage ON ticket_proposals(triage_ticket_id, status);
                CREATE INDEX IF NOT EXISTS idx_lock_claims_lock_status ON lock_claims(lock_id, status);
                CREATE INDEX IF NOT EXISTS idx_lock_claims_agent_status ON lock_claims(agent_id, status);
                CREATE INDEX IF NOT EXISTS idx_lock_claims_ticket_code ON lock_claims(ticket_code);
                CREATE INDEX IF NOT EXISTS idx_lock_claims_status_expires ON lock_claims(status, expires_at);
                CREATE INDEX IF NOT EXISTS idx_messages_project_channel ON messages(project_id, channel, pinned, created_at);
                """
            )
            # Ensure newer columns exist on older databases
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(projects)").fetchall()]
            if "worktrees_dir" not in cols:
                conn.execute("ALTER TABLE projects ADD COLUMN worktrees_dir TEXT NOT NULL DEFAULT ''")
            if "project_settings_json" not in cols:
                conn.execute("ALTER TABLE projects ADD COLUMN project_settings_json TEXT NOT NULL DEFAULT '{}'")
            cols_msg = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
            if "parent_id" not in cols_msg:
                conn.execute("ALTER TABLE messages ADD COLUMN parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id)")

            cols_t = [r["name"] for r in conn.execute("PRAGMA table_info(tickets)").fetchall()]
            if "is_held" not in cols_t:
                conn.execute("ALTER TABLE tickets ADD COLUMN is_held INTEGER NOT NULL DEFAULT 0")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tickets_project_status_held ON tickets(project_id, status, is_held)")

    # ------------------------------------------------------------------
    # Global Settings
    # ------------------------------------------------------------------
    def _get_global_settings_conn(self, conn: sqlite3.Connection) -> dict[str, Any]:
        row = conn.execute("SELECT settings_json, updated_at FROM global_settings WHERE id = 'singleton'").fetchone()
        raw_obj: dict[str, Any] = {}
        updated_at: Optional[str] = None
        if row:
            updated_at = row["updated_at"]
            try:
                raw_obj = json.loads(row["settings_json"] or "{}")
            except Exception:
                raw_obj = {}
        norm = normalize_global_settings(raw_obj)
        norm["updated_at"] = updated_at
        return norm

    def get_global_settings(self) -> dict[str, Any]:
        with self.connect() as conn:
            return self._get_global_settings_conn(conn)

    def update_global_settings(self, req: GlobalSettingsUpdate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            current = self._get_global_settings_conn(conn)
            current.pop("updated_at", None)
            patch = req.model_dump(exclude_none=True)
            merged = normalize_global_settings({**current, **patch})
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO global_settings (id, settings_json, updated_at)
                VALUES ('singleton', ?, ?)
                ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
                """,
                (json.dumps(merged), ts),
            )
            merged["updated_at"] = ts
            return merged

    def reset_global_settings(self) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            defaults = build_default_global_settings().model_dump()
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO global_settings (id, settings_json, updated_at)
                VALUES ('singleton', ?, ?)
                ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
                """,
                (json.dumps(defaults), ts),
            )
            defaults["updated_at"] = ts
            return defaults

    # ------------------------------------------------------------------
    # Projects & Sections
    # ------------------------------------------------------------------
    def get_default_project_slug(self) -> str:
        env_default = os.environ.get("KANBANANA_DEFAULT_PROJECT")
        if env_default and env_default.strip():
            return env_default.strip()
        with self.connect() as conn:
            row = conn.execute("SELECT slug FROM projects ORDER BY created_at ASC LIMIT 1").fetchone()
            if row:
                return row["slug"]
        return "default"

    def list_projects(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            g_settings = self._get_global_settings_conn(conn)
            rows = conn.execute("SELECT * FROM projects ORDER BY created_at ASC").fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["skill_config"] = json.loads(d.pop("skill_config_json") or "{}")
                raw_ps = json.loads(d.pop("project_settings_json", "{}") or "{}")
                d["project_settings"] = normalize_project_settings(raw_ps)
                d["effective_lanes"] = resolve_effective_project_lanes(g_settings, d["project_settings"])
                counts = conn.execute(
                    "SELECT status, COUNT(*) as cnt FROM tickets WHERE project_id = ? GROUP BY status",
                    (d["id"],),
                ).fetchall()
                d["ticket_counts"] = {c["status"]: c["cnt"] for c in counts}
                result.append(d)
            return result

    def get_project(self, slug: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM projects WHERE slug = ?", (slug,)).fetchone()
            if not row:
                return None
            g_settings = self._get_global_settings_conn(conn)
            d = dict(row)
            d["skill_config"] = json.loads(d.pop("skill_config_json") or "{}")
            raw_ps = json.loads(d.pop("project_settings_json", "{}") or "{}")
            d["project_settings"] = normalize_project_settings(raw_ps)
            d["effective_lanes"] = resolve_effective_project_lanes(g_settings, d["project_settings"])
            sections = conn.execute(
                "SELECT * FROM sections WHERE project_id = ? ORDER BY position ASC",
                (d["id"],),
            ).fetchall()
            d["sections"] = [dict(s) for s in sections]
            return d

    def create_project(self, req: ProjectCreate) -> dict[str, Any]:
        skill_cfg = (req.skill_config or SkillConfig(skill_name=f"{req.slug}-board")).model_dump()
        proj_settings = normalize_project_settings(
            req.project_settings.model_dump() if req.project_settings is not None else None
        )
        with self.connect(immediate=True) as conn:
            pid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO projects (
                    id, slug, name, description, repo_path, worktrees_dir,
                    board_background_md, skill_config_json, project_settings_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    pid,
                    req.slug,
                    req.name,
                    req.description,
                    req.repo_path,
                    req.worktrees_dir,
                    req.board_background_md,
                    json.dumps(skill_cfg),
                    json.dumps(proj_settings),
                    now_iso(),
                ),
            )
            # Create a default section if none exists
            conn.execute(
                """
                INSERT INTO sections (id, project_id, code, title, description_md, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), pid, "0", "0. Foundations", "", 0),
            )
            conn.execute(
                """
                INSERT INTO sections (id, project_id, code, title, description_md, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), pid, "1", "1. Quick wins", "", 1),
            )
            conn.execute(
                """
                INSERT INTO sections (id, project_id, code, title, description_md, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), pid, "2", "2. Medium projects", "", 2),
            )
            conn.execute(
                """
                INSERT INTO sections (id, project_id, code, title, description_md, position)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), pid, "3", "3. Big bets", "", 3),
            )
        return self.get_project(req.slug)  # type: ignore

    def update_project(self, slug: str, req: ProjectUpdate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            row = conn.execute("SELECT * FROM projects WHERE slug = ?", (slug,)).fetchone()
            if not row:
                raise ValueError(f"Project '{slug}' not found")
            current = dict(row)
            name = req.name if req.name is not None else current["name"]
            desc = req.description if req.description is not None else current["description"]
            repo = req.repo_path if req.repo_path is not None else current["repo_path"]
            wt_dir = req.worktrees_dir if req.worktrees_dir is not None else current.get("worktrees_dir", "")
            bg = req.board_background_md if req.board_background_md is not None else current["board_background_md"]
            skill_json = (
                json.dumps(req.skill_config.model_dump())
                if req.skill_config is not None
                else current["skill_config_json"]
            )
            ps_json = (
                json.dumps(normalize_project_settings(req.project_settings.model_dump()))
                if req.project_settings is not None
                else (current.get("project_settings_json") or "{}")
            )
            conn.execute(
                """
                UPDATE projects
                SET name = ?, description = ?, repo_path = ?, worktrees_dir = ?,
                    board_background_md = ?, skill_config_json = ?, project_settings_json = ?
                WHERE slug = ?
                """,
                (name, desc, repo, wt_dir, bg, skill_json, ps_json, slug),
            )
        return self.get_project(slug)  # type: ignore

    def delete_project(self, slug: str) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            row = conn.execute("SELECT id, slug, name FROM projects WHERE slug = ?", (slug,)).fetchone()
            if not row:
                raise ValueError(f"Project '{slug}' not found")
            total = conn.execute("SELECT COUNT(*) as cnt FROM projects").fetchone()["cnt"]
            if total <= 1:
                raise RuntimeError("Cannot delete the last remaining project on the board")
            conn.execute("DELETE FROM projects WHERE id = ?", (row["id"],))
            return {"deleted": row["slug"], "name": row["name"]}

    def upsert_section(self, project_slug: str, req: SectionCreate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            existing = conn.execute(
                "SELECT * FROM sections WHERE project_id = ? AND code = ?",
                (pid, req.code),
            ).fetchone()
            if existing:
                pos = req.position if req.position is not None else existing["position"]
                conn.execute(
                    "UPDATE sections SET title = ?, description_md = ?, position = ? WHERE id = ?",
                    (req.title, req.description_md, pos, existing["id"]),
                )
                sid = existing["id"]
            else:
                if req.position is None:
                    max_pos = conn.execute(
                        "SELECT COALESCE(MAX(position), -1) as mp FROM sections WHERE project_id = ?",
                        (pid,),
                    ).fetchone()["mp"]
                    pos = max_pos + 1
                else:
                    pos = req.position
                sid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO sections (id, project_id, code, title, description_md, position)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (sid, pid, req.code, req.title, req.description_md, pos),
                )
            row = conn.execute("SELECT * FROM sections WHERE id = ?", (sid,)).fetchone()
            return dict(row)

    def delete_section(self, project_slug: str, section_code: str) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            row = conn.execute(
                "SELECT id, code, title FROM sections WHERE project_id = ? AND code = ?",
                (proj["id"], section_code),
            ).fetchone()
            if not row:
                raise ValueError(f"Section '{section_code}' not found in project '{project_slug}'")
            conn.execute("DELETE FROM sections WHERE id = ?", (row["id"],))
            return {"deleted": row["code"], "title": row["title"]}

    def list_sections(self, project_slug: str) -> list[dict[str, Any]]:
        proj = self.get_project(project_slug)
        if not proj:
            return []
        return proj.get("sections", [])

    # ------------------------------------------------------------------
    # Tickets, Notes & Dependency Checking
    # ------------------------------------------------------------------
    def _format_ticket(
        self,
        conn: sqlite3.Connection,
        row: sqlite3.Row,
        include_notes: bool = True,
        include_proposals: bool = True,
        status_map: Optional[dict[str, str]] = None,
        note_counts_map: Optional[dict[str, int]] = None,
        notes_map: Optional[dict[str, list[dict[str, Any]]]] = None,
        proposals_map: Optional[dict[str, list[dict[str, Any]]]] = None,
    ) -> dict[str, Any]:
        d = dict(row)
        d.pop("sec_pos", None)
        pre_sec_code = d.pop("sec_code", None)
        pre_sec_title = d.pop("sec_title", None)
        d["depends_on"] = json.loads(d.pop("depends_on_json") or "[]")
        d["is_held"] = bool(d.get("is_held"))

        if pre_sec_code is not None or pre_sec_title is not None:
            d["section_code"] = pre_sec_code or ""
            d["section_title"] = pre_sec_title or ""
        else:
            sec = None
            if d.get("section_id"):
                srow = conn.execute("SELECT code, title FROM sections WHERE id = ?", (d["section_id"],)).fetchone()
                if srow:
                    sec = dict(srow)
            d["section_code"] = sec["code"] if sec else ""
            d["section_title"] = sec["title"] if sec else ""

        if status_map is None:
            all_t = conn.execute(
                "SELECT code, status FROM tickets WHERE project_id = ?",
                (d["project_id"],),
            ).fetchall()
            status_map = {r["code"]: r["status"] for r in all_t}

        dep_statuses = {dep: status_map.get(dep, "unknown") for dep in d["depends_on"]}
        d["dependency_statuses"] = dep_statuses
        d["dependencies_satisfied"] = all(
            st in ("done", "review") for st in dep_statuses.values()
        )
        d["dependencies_strictly_done"] = all(
            st == "done" for st in dep_statuses.values()
        )

        if include_notes:
            if notes_map is not None:
                d["notes"] = notes_map.get(d["id"], [])
            else:
                notes = conn.execute(
                    "SELECT * FROM ticket_notes WHERE ticket_id = ? ORDER BY created_at ASC",
                    (d["id"],),
                ).fetchall()
                d["notes"] = [dict(n) for n in notes]
        else:
            if note_counts_map is not None:
                d["note_count"] = note_counts_map.get(d["id"], 0)
            else:
                cnt = conn.execute(
                    "SELECT COUNT(*) as c FROM ticket_notes WHERE ticket_id = ?",
                    (d["id"],),
                ).fetchone()["c"]
                d["note_count"] = cnt

        if include_proposals:
            if proposals_map is not None:
                d["proposals"] = proposals_map.get(d["id"], [])
            else:
                props = conn.execute(
                    "SELECT * FROM ticket_proposals WHERE triage_ticket_id = ? ORDER BY created_at ASC",
                    (d["id"],),
                ).fetchall()
                formatted_props = []
                for p in props:
                    pd = dict(p)
                    pd["depends_on"] = json.loads(pd.pop("depends_on_json") or "[]")
                    formatted_props.append(pd)
                d["proposals"] = formatted_props

        return d

    def list_tickets(
        self,
        project_slug: str,
        status: Optional[str] = None,
        section_code: Optional[str] = None,
        owner: Optional[str] = None,
        include_notes: bool = False,
    ) -> list[dict[str, Any]]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            return self._list_tickets_conn(
                conn,
                pid,
                status=status,
                section_code=section_code,
                owner=owner,
                include_notes=include_notes,
            )

    def _list_tickets_conn(
        self,
        conn: sqlite3.Connection,
        pid: str,
        status: Optional[str] = None,
        section_code: Optional[str] = None,
        owner: Optional[str] = None,
        include_notes: bool = False,
        status_map: Optional[dict[str, str]] = None,
    ) -> list[dict[str, Any]]:
        if status_map is None:
            all_t = conn.execute(
                "SELECT code, status FROM tickets WHERE project_id = ?",
                (pid,),
            ).fetchall()
            status_map = {r["code"]: r["status"] for r in all_t}

        query = """
            SELECT t.*, COALESCE(s.position, 999) as sec_pos, s.code as sec_code, s.title as sec_title
            FROM tickets t
            LEFT JOIN sections s ON t.section_id = s.id
            WHERE t.project_id = ?
        """
        params: list[Any] = [pid]
        if status:
            query += " AND t.status = ?"
            params.append(status)
        if section_code:
            query += " AND s.code = ?"
            params.append(section_code)
        if owner:
            query += " AND t.owner = ?"
            params.append(owner)
        query += " ORDER BY sec_pos ASC, t.position ASC, t.created_at ASC"

        rows = conn.execute(query, params).fetchall()
        if not rows:
            return []

        ticket_ids = [r["id"] for r in rows]
        placeholders = ",".join("?" for _ in ticket_ids)

        note_counts_map: Optional[dict[str, int]] = None
        notes_map: Optional[dict[str, list[dict[str, Any]]]] = None
        if include_notes:
            notes_map = {tid: [] for tid in ticket_ids}
            n_rows = conn.execute(
                f"SELECT * FROM ticket_notes WHERE ticket_id IN ({placeholders}) ORDER BY created_at ASC",
                ticket_ids,
            ).fetchall()
            for nr in n_rows:
                notes_map[nr["ticket_id"]].append(dict(nr))
        else:
            note_counts_map = {tid: 0 for tid in ticket_ids}
            c_rows = conn.execute(
                f"SELECT ticket_id, COUNT(*) as c FROM ticket_notes WHERE ticket_id IN ({placeholders}) GROUP BY ticket_id",
                ticket_ids,
            ).fetchall()
            for cr in c_rows:
                note_counts_map[cr["ticket_id"]] = cr["c"]

        triage_ids = [r["id"] for r in rows if r["status"] == "triage" or include_notes]
        proposals_map: dict[str, list[dict[str, Any]]] = {tid: [] for tid in triage_ids}
        if triage_ids:
            t_placeholders = ",".join("?" for _ in triage_ids)
            p_rows = conn.execute(
                f"SELECT * FROM ticket_proposals WHERE triage_ticket_id IN ({t_placeholders}) ORDER BY created_at ASC",
                triage_ids,
            ).fetchall()
            for pr in p_rows:
                pd = dict(pr)
                pd["depends_on"] = json.loads(pd.pop("depends_on_json") or "[]")
                proposals_map[pd["triage_ticket_id"]].append(pd)

        return [
            self._format_ticket(
                conn,
                r,
                include_notes=include_notes,
                include_proposals=(r["status"] == "triage" or include_notes),
                status_map=status_map,
                note_counts_map=note_counts_map,
                notes_map=notes_map,
                proposals_map=proposals_map,
            )
            for r in rows
        ]

    def get_ticket(self, project_slug: str, code: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                return None
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (proj["id"], code),
            ).fetchone()
            if not row:
                return None
            return self._format_ticket(conn, row, include_notes=True, include_proposals=True)

    def create_ticket(self, project_slug: str, req: TicketCreate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]

            section_id = None
            if req.section_code:
                srow = conn.execute(
                    "SELECT id FROM sections WHERE project_id = ? AND code = ?",
                    (pid, req.section_code),
                ).fetchone()
                if srow:
                    section_id = srow["id"]

            code = req.code
            if not code:
                prefix = "T" if req.status == "triage" else "TASK"
                existing_codes = {
                    r["code"].upper()
                    for r in conn.execute("SELECT code FROM tickets WHERE project_id = ?", (pid,)).fetchall()
                }
                idx = 1
                while f"{prefix}{idx}" in existing_codes:
                    idx += 1
                code = f"{prefix}{idx}"

            max_pos = conn.execute(
                "SELECT COALESCE(MAX(position), -1) as mp FROM tickets WHERE project_id = ?",
                (pid,),
            ).fetchone()["mp"]

            tid = str(uuid.uuid4())
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO tickets (
                    id, project_id, section_id, code, title, status, triage_state, owner,
                    depends_on_json, files_md, do_md, done_when_md, blocked_reason,
                    branch_name, worktree_path, pr_url, commit_sha, exactness_level,
                    parent_ticket_id, is_held, position, updated_at, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tid,
                    pid,
                    section_id,
                    code,
                    req.title,
                    req.status,
                    req.triage_state or ("new" if req.status == "triage" else "approved"),
                    req.owner,
                    json.dumps(req.depends_on),
                    req.files_md,
                    req.do_md,
                    req.done_when_md,
                    req.blocked_reason,
                    req.branch_name,
                    req.worktree_path,
                    req.pr_url,
                    req.commit_sha,
                    req.exactness_level,
                    req.parent_ticket_id,
                    1 if getattr(req, "is_held", False) else 0,
                    max_pos + 1,
                    ts,
                    ts,
                ),
            )
            if req.initial_note_md:
                conn.execute(
                    """
                    INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), tid, req.initial_note_author, "note", req.initial_note_md, ts),
                )
            row = conn.execute("SELECT * FROM tickets WHERE id = ?", (tid,)).fetchone()
            return self._format_ticket(conn, row)

    def update_ticket(self, project_slug: str, code: str, req: TicketUpdate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (pid, code),
            ).fetchone()
            if not row:
                raise ValueError(f"Ticket '{code}' not found in project '{project_slug}'")
            cur = dict(row)

            section_id = cur["section_id"]
            if req.section_code is not None:
                srow = conn.execute(
                    "SELECT id FROM sections WHERE project_id = ? AND code = ?",
                    (pid, req.section_code),
                ).fetchone()
                section_id = srow["id"] if srow else None

            new_code = req.code if req.code is not None else cur["code"]
            title = req.title if req.title is not None else cur["title"]
            status = req.status if req.status is not None else cur["status"]
            triage_state = req.triage_state if req.triage_state is not None else cur["triage_state"]
            owner = req.owner if req.owner is not None else cur["owner"]
            if owner in ("—", "-", ""):
                owner = None
            depends_json = (
                json.dumps(req.depends_on) if req.depends_on is not None else cur["depends_on_json"]
            )
            files_md = req.files_md if req.files_md is not None else cur["files_md"]
            do_md = req.do_md if req.do_md is not None else cur["do_md"]
            done_when_md = req.done_when_md if req.done_when_md is not None else cur["done_when_md"]
            blocked_reason = req.blocked_reason if req.blocked_reason is not None else cur["blocked_reason"]
            branch_name = req.branch_name if req.branch_name is not None else cur["branch_name"]
            worktree_path = req.worktree_path if req.worktree_path is not None else cur["worktree_path"]
            pr_url = req.pr_url if req.pr_url is not None else cur["pr_url"]
            commit_sha = req.commit_sha if req.commit_sha is not None else cur["commit_sha"]
            exactness_level = (
                req.exactness_level if req.exactness_level is not None else cur["exactness_level"]
            )
            is_held = (
                (1 if req.is_held else 0)
                if req.is_held is not None
                else (1 if cur.get("is_held") else 0)
            )
            position = req.position if req.position is not None else cur["position"]

            ts = now_iso()
            conn.execute(
                """
                UPDATE tickets SET
                    section_id = ?, code = ?, title = ?, status = ?, triage_state = ?,
                    owner = ?, depends_on_json = ?, files_md = ?, do_md = ?, done_when_md = ?,
                    blocked_reason = ?, branch_name = ?, worktree_path = ?, pr_url = ?,
                    commit_sha = ?, exactness_level = ?, is_held = ?, position = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    section_id,
                    new_code,
                    title,
                    status,
                    triage_state,
                    owner,
                    depends_json,
                    files_md,
                    do_md,
                    done_when_md,
                    blocked_reason,
                    branch_name,
                    worktree_path,
                    pr_url,
                    commit_sha,
                    exactness_level,
                    is_held,
                    position,
                    ts,
                    cur["id"],
                ),
            )
            # Keep agents table in sync when status or owner updates
            active_agent = owner or cur.get("owner")
            if active_agent and active_agent not in ("—", "-", ""):
                if status in ("done", "todo"):
                    conn.execute(
                        """
                        UPDATE agents
                        SET current_ticket_code = CASE WHEN current_ticket_code = ? THEN NULL ELSE current_ticket_code END,
                            last_seen_at = ?
                        WHERE id = ? AND project_id = ?
                        """,
                        (new_code, ts, active_agent, pid),
                    )
                elif status in ("in-progress", "review", "blocked"):
                    conn.execute(
                        """
                        INSERT INTO agents (id, project_id, status, current_ticket_code, worktree_path, branch_name, last_seen_at)
                        VALUES (?, ?, 'active', ?, ?, ?, ?)
                        ON CONFLICT(id, project_id) DO UPDATE SET
                            status = 'active',
                            current_ticket_code = excluded.current_ticket_code,
                            worktree_path = CASE WHEN excluded.worktree_path != '' THEN excluded.worktree_path ELSE agents.worktree_path END,
                            branch_name = CASE WHEN excluded.branch_name != '' THEN excluded.branch_name ELSE agents.branch_name END,
                            last_seen_at = excluded.last_seen_at
                        """,
                        (active_agent, pid, new_code, worktree_path or "", branch_name or "", ts),
                    )

            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (cur["id"],)).fetchone()
            formatted = self._format_ticket(conn, updated)
            if cur["status"] not in ("done", "review") and status in ("done", "review"):
                formatted["newly_unblocked_tickets"] = self._find_newly_unblocked_conn(conn, pid, new_code)
            if active_agent and status in ("done", "review", "todo"):
                held_locks = conn.execute(
                    """
                    SELECT fl.name FROM lock_claims lc
                    JOIN feature_locks fl ON lc.lock_id = fl.id
                    WHERE lc.agent_id = ? AND lc.status = 'held'
                    """,
                    (active_agent,),
                ).fetchall()
                if held_locks:
                    formatted["held_locks_reminder"] = [r["name"] for r in held_locks]
            return formatted

    @staticmethod
    def _extract_file_tokens(files_md: str) -> set[str]:
        if not files_md:
            return set()
        tokens: set[str] = set()
        for m in re.findall(r"`([^`]+)`|([A-Za-z0-9_./-]+\.(?:rs|cpp|h|hpp|c|cu|hip|py|ts|tsx|toml|md))", files_md):
            raw = (m[0] or m[1]).strip()
            for part in re.split(r"[\s,]+", raw):
                clean = part.strip("`'\"()[]{}:;")
                if "/" in clean or "." in clean:
                    # Normalize function suffixes like `src/engine.rs (try_graph_decode)` -> `src/engine.rs`
                    if clean.endswith((".rs", ".cpp", ".h", ".hpp", ".c", ".cu", ".hip", ".py", ".ts", ".tsx", ".toml")):
                        tokens.add(clean.lower())
        return tokens

    def _find_file_overlaps_conn(
        self, conn: sqlite3.Connection, pid: str, exclude_code: str, files_md: str
    ) -> list[dict[str, Any]]:
        my_files = self._extract_file_tokens(files_md)
        if not my_files:
            return []
        in_prog = conn.execute(
            "SELECT code, title, owner, branch_name, files_md FROM tickets WHERE project_id = ? AND status = 'in-progress' AND UPPER(code) != UPPER(?)",
            (pid, exclude_code),
        ).fetchall()
        overlaps: list[dict[str, Any]] = []
        for r in in_prog:
            other_files = self._extract_file_tokens(r["files_md"] or "")
            shared = sorted(my_files.intersection(other_files))
            if shared:
                overlaps.append(
                    {
                        "ticket_code": r["code"],
                        "title": r["title"],
                        "owner": r["owner"],
                        "branch_name": r["branch_name"],
                        "overlapping_files": shared,
                    }
                )
        return overlaps

    def _find_newly_unblocked_conn(
        self, conn: sqlite3.Connection, pid: str, completed_code: str
    ) -> list[dict[str, str]]:
        all_t = conn.execute(
            "SELECT code, title, status, depends_on_json FROM tickets WHERE project_id = ?",
            (pid,),
        ).fetchall()
        status_map = {r["code"]: r["status"] for r in all_t}
        newly_unblocked: list[dict[str, str]] = []
        for r in all_t:
            if r["status"] != "todo":
                continue
            deps = json.loads(r["depends_on_json"] or "[]")
            if completed_code in deps and all(status_map.get(d) in ("done", "review") for d in deps):
                newly_unblocked.append({"code": r["code"], "title": r["title"]})
        return newly_unblocked

    def check_file_conflicts(
        self, project_slug: str, code: str = "", files_md: str = ""
    ) -> list[dict[str, Any]]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            target_files_md = files_md
            if code and not target_files_md:
                t = conn.execute(
                    "SELECT files_md FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                    (pid, code),
                ).fetchone()
                if t:
                    target_files_md = t["files_md"] or ""
            return self._find_file_overlaps_conn(conn, pid, code or "", target_files_md)

    def add_ticket_note(self, project_slug: str, code: str, req: NoteCreate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (proj["id"], code),
            ).fetchone()
            if not row:
                raise ValueError(f"Ticket '{code}' not found")
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), row["id"], req.author, req.kind, req.content_md, ts),
            )
            # If user answers a triage question, automatically transition needs-info -> researching
            if row["status"] == "triage" and row["triage_state"] == "needs-info" and req.kind == "answer":
                conn.execute(
                    "UPDATE tickets SET triage_state = 'researching', updated_at = ? WHERE id = ?",
                    (ts, row["id"]),
                )
            else:
                conn.execute("UPDATE tickets SET updated_at = ? WHERE id = ?", (ts, row["id"]))
            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (row["id"],)).fetchone()
            return self._format_ticket(conn, updated)

    # ------------------------------------------------------------------
    # Atomic Claiming & Progress Updates for Agents
    # ------------------------------------------------------------------
    def claim_ticket(
        self,
        project_slug: str,
        code: str,
        agent_id: str,
        branch_name: str = "",
        worktree_path: str = "",
        allow_review_deps: bool = True,
    ) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (pid, code),
            ).fetchone()
            if not row:
                raise ValueError(f"Ticket '{code}' not found")

            if row["status"] not in ("todo", "blocked"):
                raise RuntimeError(
                    f"Cannot claim ticket '{row['code']}': current status is '{row['status']}' "
                    f"(owner: {row['owner'] or 'none'}). Only tickets in 'todo' or 'blocked' can be claimed."
                )

            if bool(row["is_held"]):
                raise RuntimeError(
                    f"Cannot claim ticket '{row['code']}': ticket is on hold (is_held=True). "
                    f"Resume or unhold the ticket before claiming."
                )

            deps = json.loads(row["depends_on_json"] or "[]")
            if deps:
                all_t = conn.execute(
                    "SELECT code, status FROM tickets WHERE project_id = ?", (pid,)
                ).fetchall()
                status_map = {r["code"]: r["status"] for r in all_t}
                allowed = ("done", "review") if allow_review_deps else ("done",)
                unmet = [d for d in deps if status_map.get(d, "unknown") not in allowed]
                if unmet:
                    raise RuntimeError(
                        f"Cannot claim ticket '{row['code']}': dependencies not satisfied: "
                        + ", ".join(f"{d} ({status_map.get(d, 'unknown')})" for d in unmet)
                    )

            ts = now_iso()
            slug_branch = branch_name or row["branch_name"] or f"board/{row['code'].lower()}"
            wt_path = worktree_path or row["worktree_path"]
            was_blocked = row["status"] == "blocked"
            old_owner = row["owner"]
            conn.execute(
                """
                UPDATE tickets
                SET status = 'in-progress', owner = ?, branch_name = ?, worktree_path = ?, blocked_reason = '', updated_at = ?
                WHERE id = ? AND status IN ('todo', 'blocked')
                """,
                (agent_id, slug_branch, wt_path, ts, row["id"]),
            )
            if was_blocked:
                note_content = (
                    f"**Ticket Handover / Resumed** by `{agent_id}`"
                    + (f" (transferred from `{old_owner}`)." if old_owner and old_owner != agent_id else ".")
                )
                conn.execute(
                    """
                    INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                    VALUES (?, ?, ?, 'handoff', ?, ?)
                    """,
                    (str(uuid.uuid4()), row["id"], agent_id, note_content, ts),
                )
            conn.execute(
                """
                INSERT INTO agents (id, project_id, status, current_ticket_code, worktree_path, branch_name, last_seen_at)
                VALUES (?, ?, 'active', ?, ?, ?, ?)
                ON CONFLICT(id, project_id) DO UPDATE SET
                    status = 'active',
                    current_ticket_code = excluded.current_ticket_code,
                    worktree_path = CASE WHEN excluded.worktree_path != '' THEN excluded.worktree_path ELSE agents.worktree_path END,
                    branch_name = CASE WHEN excluded.branch_name != '' THEN excluded.branch_name ELSE agents.branch_name END,
                    last_seen_at = excluded.last_seen_at
                """,
                (agent_id, pid, row["code"], wt_path, slug_branch, ts),
            )
            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (row["id"],)).fetchone()
            formatted = self._format_ticket(conn, updated)
            overlaps = self._find_file_overlaps_conn(conn, pid, row["code"], row["files_md"] or "")
            if overlaps:
                formatted["concurrent_file_overlap_warnings"] = overlaps
            return formatted

    def pick_next_todo(
        self,
        project_slug: str,
        agent_id: str,
        branch_name: str = "",
        worktree_path: str = "",
        allow_review_deps: bool = True,
    ) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            all_t = conn.execute(
                "SELECT code, status FROM tickets WHERE project_id = ?", (pid,)
            ).fetchall()
            status_map = {r["code"]: r["status"] for r in all_t}
            allowed = ("done", "review") if allow_review_deps else ("done",)

            candidates = conn.execute(
                """
                SELECT t.*, COALESCE(s.position, 999) as sec_pos
                FROM tickets t
                LEFT JOIN sections s ON t.section_id = s.id
                WHERE t.project_id = ? AND t.status = 'todo' AND t.is_held = 0
                ORDER BY sec_pos ASC, t.position ASC, t.created_at ASC
                """,
                (pid,),
            ).fetchall()

            chosen = None
            for cand in candidates:
                deps = json.loads(cand["depends_on_json"] or "[]")
                if all(status_map.get(d, "unknown") in allowed for d in deps):
                    chosen = cand
                    break

            if not chosen:
                raise RuntimeError("No unblocked 'todo' tickets are currently available to claim.")

            ts = now_iso()
            slug_branch = branch_name or chosen["branch_name"] or f"board/{chosen['code'].lower()}"
            wt_path = worktree_path or chosen["worktree_path"]
            conn.execute(
                """
                UPDATE tickets
                SET status = 'in-progress', owner = ?, branch_name = ?, worktree_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (agent_id, slug_branch, wt_path, ts, chosen["id"]),
            )
            conn.execute(
                """
                INSERT INTO agents (id, project_id, status, current_ticket_code, worktree_path, branch_name, last_seen_at)
                VALUES (?, ?, 'active', ?, ?, ?, ?)
                ON CONFLICT(id, project_id) DO UPDATE SET
                    status = 'active',
                    current_ticket_code = excluded.current_ticket_code,
                    worktree_path = CASE WHEN excluded.worktree_path != '' THEN excluded.worktree_path ELSE agents.worktree_path END,
                    branch_name = CASE WHEN excluded.branch_name != '' THEN excluded.branch_name ELSE agents.branch_name END,
                    last_seen_at = excluded.last_seen_at
                """,
                (agent_id, pid, chosen["code"], wt_path, slug_branch, ts),
            )
            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (chosen["id"],)).fetchone()
            formatted = self._format_ticket(conn, updated)
            overlaps = self._find_file_overlaps_conn(conn, pid, chosen["code"], chosen["files_md"] or "")
            if overlaps:
                formatted["concurrent_file_overlap_warnings"] = overlaps
            return formatted

    def review_ticket(
        self,
        project_slug: str,
        code: str,
        reviewer_agent_id: str,
        verdict: str,
        review_md: str = "",
        reviewer_model: str = "claude-sonnet-4-5",
        code_issues: Optional[list[str]] = None,
        security_issues: Optional[list[str]] = None,
        exactness_level: Optional[str] = None,
        commit_sha: Optional[str] = None,
        merge_info: Optional[dict[str, Any]] = None,
        hold_in_review: bool = False,
    ) -> dict[str, Any]:
        """
        Code & Security Review for a ticket (`verdict`: 'approve' -> marks 'done', 'request-changes' -> marks 'in-progress', 'comment' -> keeps current status).
        Enforces strict gate: if `code_issues` or `security_issues` are non-empty, forces `verdict = 'request-changes'` and blocks merging.
        """
        c_issues = [i.strip() for i in (code_issues or []) if i and i.strip()]
        s_issues = [i.strip() for i in (security_issues or []) if i and i.strip()]
        has_issues = len(c_issues) > 0 or len(s_issues) > 0

        effective_verdict = verdict
        if has_issues and effective_verdict == "approve":
            effective_verdict = "request-changes"

        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (pid, code),
            ).fetchone()
            if not row:
                raise ValueError(f"Ticket '{code}' not found")

            ts = now_iso()
            new_status = row["status"]
            if effective_verdict == "approve":
                new_status = "review" if hold_in_review else "done"
            elif effective_verdict == "request-changes":
                new_status = "in-progress"

            new_exact = exactness_level if exactness_level is not None else row["exactness_level"]
            new_sha = (
                (merge_info or {}).get("merge_commit_sha")
                or (commit_sha if commit_sha is not None else row["commit_sha"])
            )

            conn.execute(
                """
                UPDATE tickets
                SET status = ?, exactness_level = ?, commit_sha = ?, updated_at = ?
                WHERE id = ?
                """,
                (new_status, new_exact, new_sha, ts, row["id"]),
            )
            header = f"**Code & Security Review (`{effective_verdict.upper()}`)** · Model: `{reviewer_model}`"
            if new_exact:
                header += f" · Exactness: `{new_exact}`"

            body_parts = [header]
            if c_issues:
                body_parts.append("\n**Code Issues Found:**\n" + "\n".join(f"- ⚠️ {item}" for item in c_issues))
            else:
                body_parts.append("- ✅ **Code Issues:** None found (0)")

            if s_issues:
                body_parts.append("\n**Security Issues Found:**\n" + "\n".join(f"- 🔒 {item}" for item in s_issues))
            else:
                body_parts.append("- 🛡️ **Security Issues:** None found (0)")

            if merge_info and not has_issues and effective_verdict == "approve":
                body_parts.append(
                    f"- 🔀 **MR/PR Merged:** `{merge_info.get('target', '')}` via `{merge_info.get('method', '')}` "
                    f"(commit `{merge_info.get('merge_commit_sha', new_sha)}`)"
                )
            elif hold_in_review and not has_issues and effective_verdict == "approve":
                body_parts.append(
                    "- ⏸️ **Human Merge Gate Active:** Clean review recorded; held in `review` for human operator merge."
                )
            elif has_issues:
                body_parts.append("- ⛔ **Merge Blocked:** Resolve all code and security issues above before merging.")

            if review_md.strip():
                body_parts.append("\n" + review_md.strip())

            full_review_md = "\n".join(body_parts)

            conn.execute(
                """
                INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                VALUES (?, ?, ?, 'review', ?, ?)
                """,
                (str(uuid.uuid4()), row["id"], reviewer_agent_id, full_review_md, ts),
            )
            if effective_verdict in ("approve", "request-changes"):
                conn.execute(
                    """
                    INSERT INTO messages (id, project_id, author, channel, title, body_md, ticket_code, pinned, created_at)
                    VALUES (?, ?, ?, 'reviews', ?, ?, ?, 0, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        pid,
                        reviewer_agent_id,
                        f"Review [{effective_verdict.upper()}] on {row['code']} ({reviewer_model}): {row['title']}",
                        full_review_md,
                        row["code"],
                        ts,
                    ),
                )
            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (row["id"],)).fetchone()
            formatted = self._format_ticket(conn, updated)
            formatted["review_summary"] = {
                "effective_verdict": effective_verdict,
                "reviewer_model": reviewer_model,
                "code_issues_count": len(c_issues),
                "security_issues_count": len(s_issues),
                "code_issues": c_issues,
                "security_issues": s_issues,
                "merged": bool(merge_info and not has_issues and effective_verdict == "approve"),
                "hold_in_review": bool(hold_in_review and not has_issues and effective_verdict == "approve"),
                "merge_info": merge_info if (not has_issues and effective_verdict == "approve") else None,
            }
            if row["status"] not in ("done", "review") and new_status in ("done", "review"):
                formatted["newly_unblocked_tickets"] = self._find_newly_unblocked_conn(conn, pid, row["code"])
            return formatted

    def search_board(
        self,
        project_slug: str,
        query: str,
        scope: str = "all",
        limit: int = 25,
    ) -> dict[str, Any]:
        """
        Search across tickets (code, title, files_md, do_md, done_when_md), ticket_notes,
        messages, and project board_background_md (including 'Measured & Rejected').
        """
        q = query.strip()
        if not q:
            return {"query": "", "tickets": [], "notes": [], "messages": [], "background_matches": []}
        like_pat = f"%{q}%"
        with self.connect() as conn:
            proj = conn.execute("SELECT * FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]

            tickets_out: list[dict[str, Any]] = []
            if scope in ("all", "tickets"):
                t_rows = conn.execute(
                    """
                    SELECT code, title, status, owner, files_md, do_md, done_when_md
                    FROM tickets
                    WHERE project_id = ?
                      AND (code LIKE ? OR title LIKE ? OR files_md LIKE ? OR do_md LIKE ? OR done_when_md LIKE ?)
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (pid, like_pat, like_pat, like_pat, like_pat, like_pat, limit),
                ).fetchall()
                tickets_out = [dict(r) for r in t_rows]

            notes_out: list[dict[str, Any]] = []
            if scope in ("all", "notes"):
                n_rows = conn.execute(
                    """
                    SELECT t.code as ticket_code, t.title as ticket_title, tn.author, tn.kind, tn.content_md, tn.created_at
                    FROM ticket_notes tn
                    JOIN tickets t ON tn.ticket_id = t.id
                    WHERE t.project_id = ? AND (tn.content_md LIKE ? OR tn.author LIKE ?)
                    ORDER BY tn.created_at DESC
                    LIMIT ?
                    """,
                    (pid, like_pat, like_pat, limit),
                ).fetchall()
                notes_out = [dict(r) for r in n_rows]

            messages_out: list[dict[str, Any]] = []
            if scope in ("all", "messages"):
                m_rows = conn.execute(
                    """
                    SELECT channel, author, title, body_md, ticket_code, created_at
                    FROM messages
                    WHERE project_id = ? AND (title LIKE ? OR body_md LIKE ? OR author LIKE ?)
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (pid, like_pat, like_pat, like_pat, limit),
                ).fetchall()
                messages_out = [dict(r) for r in m_rows]

            bg_matches: list[str] = []
            if scope in ("all", "background") and proj["board_background_md"]:
                q_low = q.lower()
                for para in proj["board_background_md"].split("\n\n"):
                    if q_low in para.lower():
                        bg_matches.append(para.strip()[:500])
                        if len(bg_matches) >= 5:
                            break

            return {
                "query": q,
                "tickets": tickets_out,
                "notes": notes_out,
                "messages": messages_out,
                "background_matches": bg_matches,
            }

    def get_onboarding_bundle(self, project_slug: str, compact: bool = False) -> dict[str, Any]:
        """
        Single-connection onboarding snapshot for `get_project_onboarding`.
        Eliminates 6 separate connections and N+1 ticket queries.
        """
        with self.connect(immediate=True) as conn:
            proj_row = conn.execute("SELECT * FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj_row:
                raise ValueError(f"Project '{project_slug}' not found")
            proj = dict(proj_row)
            proj["skill_config"] = json.loads(proj.pop("skill_config_json") or "{}")
            raw_ps = json.loads(proj.pop("project_settings_json", "{}") or "{}")
            proj["project_settings"] = normalize_project_settings(raw_ps)
            g_settings = self._get_global_settings_conn(conn)
            proj["effective_lanes"] = resolve_effective_project_lanes(g_settings, proj["project_settings"])
            pid = proj["id"]

            # 1. Expire & fetch locks in the same connection
            self._expire_and_promote_locks(conn)
            lock_rows = conn.execute(
                "SELECT * FROM feature_locks WHERE project_id IS NULL OR project_id = ? ORDER BY name ASC",
                (pid,),
            ).fetchall()
            locks = [self._format_lock(conn, r) for r in lock_rows]

            # 2. Fetch recent messages
            msg_rows = conn.execute(
                "SELECT * FROM messages WHERE project_id = ? ORDER BY pinned DESC, created_at DESC LIMIT ?",
                (pid, 6 if compact else 10),
            ).fetchall()
            messages = [dict(r) for r in msg_rows]

            # 3. Fetch status map once
            all_t = conn.execute(
                "SELECT code, status FROM tickets WHERE project_id = ?",
                (pid,),
            ).fetchall()
            status_map = {r["code"]: r["status"] for r in all_t}
            status_counts: dict[str, int] = {}
            for r in all_t:
                status_counts[r["status"]] = status_counts.get(r["status"], 0) + 1

            # 4. Batch fetch todo, in-progress, review, and triage tickets
            all_todos = self._list_tickets_conn(conn, pid, status="todo", include_notes=False, status_map=status_map)
            claimable_todos = [
                {
                    "code": t["code"],
                    "title": t["title"],
                    "section_code": t["section_code"],
                    "depends_on": t["depends_on"],
                    "dependency_statuses": t["dependency_statuses"],
                    "files_md": t["files_md"],
                    **({} if compact else {"do_md": t["do_md"], "done_when_md": t["done_when_md"]}),
                }
                for t in all_todos
                if t["dependencies_satisfied"] and not t.get("is_held")
            ]
            blocked_by_deps_todos = [
                {
                    "code": t["code"],
                    "title": t["title"],
                    "section_code": t["section_code"],
                    "depends_on": t["depends_on"],
                    "dependency_statuses": t["dependency_statuses"],
                }
                for t in all_todos
                if not t["dependencies_satisfied"]
            ]

            in_progress = [
                {
                    "code": t["code"],
                    "title": t["title"],
                    "owner": t["owner"],
                    "branch_name": t["branch_name"],
                    "files_md": t["files_md"],
                }
                for t in self._list_tickets_conn(conn, pid, status="in-progress", include_notes=False, status_map=status_map)
            ]

            review_tickets = [
                {
                    "code": t["code"],
                    "title": t["title"],
                    "owner": t["owner"],
                    "branch_name": t["branch_name"],
                    "commit_sha": t["commit_sha"],
                }
                for t in self._list_tickets_conn(conn, pid, status="review", include_notes=False, status_map=status_map)
            ]

            triage_tickets = [
                {
                    "code": t["code"],
                    "title": t["title"],
                    "triage_state": t["triage_state"],
                    "owner": t["owner"],
                    **({} if compact else {"do_md": t["do_md"]}),
                }
                for t in self._list_tickets_conn(conn, pid, status="triage", include_notes=False, status_map=status_map)
            ]

            bg_md = proj["board_background_md"]
            if compact and len(bg_md) > 1200:
                bg_md = bg_md[:1200] + "\n\n...(truncated for compact mode; read `board://{slug}/background.md` or call `search_board` for full history)..."

            return {
                "project": {
                    "slug": proj["slug"],
                    "name": proj["name"],
                    "repo_path": proj["repo_path"],
                    "worktrees_dir": proj.get("worktrees_dir", ""),
                    "board_background_md": bg_md,
                    "skill_config": proj["skill_config"],
                    "ticket_counts": status_counts,
                },
                "locks": locks,
                "recent_messages": messages,
                "claimable_todo_tickets": claimable_todos,
                "blocked_by_dependencies_todo_tickets": blocked_by_deps_todos,
                "in_progress_tickets": in_progress,
                "review_tickets": review_tickets,
                "open_triage_tickets": triage_tickets,
            }

    # ------------------------------------------------------------------
    # Triage Refinement & Proposal Approval Workflow
    # ------------------------------------------------------------------
    def claim_triage_ticket(self, project_slug: str, code: str, agent_id: str) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (proj["id"], code),
            ).fetchone()
            if not row:
                raise ValueError(f"Ticket '{code}' not found")
            if row["status"] != "triage":
                raise RuntimeError(f"Ticket '{code}' is not in 'triage' status (current: {row['status']})")
            ts = now_iso()
            conn.execute(
                "UPDATE tickets SET owner = ?, triage_state = 'researching', updated_at = ? WHERE id = ?",
                (agent_id, ts, row["id"]),
            )
            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (row["id"],)).fetchone()
            return self._format_ticket(conn, updated)

    def ask_triage_questions(
        self, project_slug: str, code: str, agent_id: str, questions_md: str
    ) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (proj["id"], code),
            ).fetchone()
            if not row:
                raise ValueError(f"Ticket '{code}' not found")
            ts = now_iso()
            conn.execute(
                "UPDATE tickets SET triage_state = 'needs-info', owner = COALESCE(owner, ?), updated_at = ? WHERE id = ?",
                (agent_id, ts, row["id"]),
            )
            conn.execute(
                """
                INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                VALUES (?, ?, ?, 'question', ?, ?)
                """,
                (str(uuid.uuid4()), row["id"], agent_id, questions_md, ts),
            )
            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (row["id"],)).fetchone()
            return self._format_ticket(conn, updated)

    def propose_todo_tickets(
        self, project_slug: str, triage_code: str, req: ProposeTicketsRequest
    ) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (pid, triage_code),
            ).fetchone()
            if not row:
                raise ValueError(f"Triage ticket '{triage_code}' not found")

            ts = now_iso()
            created_proposal_ids: list[str] = []
            for p in req.proposals:
                prop_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO ticket_proposals (
                        id, triage_ticket_id, proposed_by, code, title, section_code,
                        depends_on_json, files_md, do_md, done_when_md, rationale_md, status, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        prop_id,
                        row["id"],
                        req.proposed_by,
                        p.code,
                        p.title,
                        p.section_code,
                        json.dumps(p.depends_on),
                        p.files_md,
                        p.do_md,
                        p.done_when_md,
                        p.rationale_md,
                        ts,
                    ),
                )
                created_proposal_ids.append(prop_id)

            summary_lines = [f"Proposed {len(req.proposals)} TODO ticket(s):"]
            for p in req.proposals:
                summary_lines.append(f"- **{p.code} · {p.title}** (section `{p.section_code}`)")
            conn.execute(
                """
                INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                VALUES (?, ?, ?, 'note', ?, ?)
                """,
                (str(uuid.uuid4()), row["id"], req.proposed_by, "\n".join(summary_lines), ts),
            )
            conn.execute(
                "UPDATE tickets SET triage_state = 'proposed', updated_at = ? WHERE id = ?",
                (ts, row["id"]),
            )

        if req.auto_promote:
            return self.approve_triage_proposals(project_slug, triage_code)
        return self.get_ticket(project_slug, triage_code)  # type: ignore

    def approve_triage_proposals(
        self,
        project_slug: str,
        triage_code: str,
        proposal_ids: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]
            triage_row = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (pid, triage_code),
            ).fetchone()
            if not triage_row:
                raise ValueError(f"Triage ticket '{triage_code}' not found")

            props = conn.execute(
                "SELECT * FROM ticket_proposals WHERE triage_ticket_id = ? AND status = 'pending' ORDER BY created_at ASC",
                (triage_row["id"],),
            ).fetchall()

            ts = now_iso()
            created_codes: list[str] = []
            for p in props:
                if proposal_ids is not None and p["id"] not in proposal_ids:
                    continue
                srow = conn.execute(
                    "SELECT id FROM sections WHERE project_id = ? AND code = ?",
                    (pid, p["section_code"]),
                ).fetchone()
                section_id = srow["id"] if srow else triage_row["section_id"]

                # Ensure unique code
                base_code = p["code"]
                existing = conn.execute(
                    "SELECT id FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                    (pid, base_code),
                ).fetchone()
                final_code = base_code
                suffix = 2
                while existing:
                    final_code = f"{base_code}_{suffix}"
                    existing = conn.execute(
                        "SELECT id FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                        (pid, final_code),
                    ).fetchone()
                    suffix += 1

                max_pos = conn.execute(
                    "SELECT COALESCE(MAX(position), -1) as mp FROM tickets WHERE project_id = ?",
                    (pid,),
                ).fetchone()["mp"]

                new_tid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO tickets (
                        id, project_id, section_id, code, title, status, triage_state,
                        owner, depends_on_json, files_md, do_md, done_when_md,
                        parent_ticket_id, position, updated_at, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, 'todo', 'approved', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_tid,
                        pid,
                        section_id,
                        final_code,
                        p["title"],
                        p["depends_on_json"],
                        p["files_md"],
                        p["do_md"],
                        p["done_when_md"],
                        triage_row["id"],
                        max_pos + 1,
                        ts,
                        ts,
                    ),
                )
                if p["rationale_md"]:
                    conn.execute(
                        """
                        INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                        VALUES (?, ?, ?, 'system', ?, ?)
                        """,
                        (
                            str(uuid.uuid4()),
                            new_tid,
                            p["proposed_by"],
                            f"Promoted from triage ticket `{triage_row['code']}`.\n\n**Rationale:** {p['rationale_md']}",
                            ts,
                        ),
                    )
                conn.execute(
                    "UPDATE ticket_proposals SET status = 'approved', created_ticket_id = ? WHERE id = ?",
                    (new_tid, p["id"]),
                )
                created_codes.append(final_code)

            remaining_pending = conn.execute(
                "SELECT COUNT(*) as c FROM ticket_proposals WHERE triage_ticket_id = ? AND status = 'pending'",
                (triage_row["id"],),
            ).fetchone()["c"]

            if remaining_pending == 0 and created_codes:
                conn.execute(
                    "UPDATE tickets SET status = 'done', triage_state = 'approved', updated_at = ? WHERE id = ?",
                    (ts, triage_row["id"]),
                )
                conn.execute(
                    """
                    INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                    VALUES (?, ?, 'system', 'system', ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        triage_row["id"],
                        f"Approved and promoted to TODO ticket(s): {', '.join(f'`{c}`' for c in created_codes)}",
                        ts,
                    ),
                )

            updated = conn.execute("SELECT * FROM tickets WHERE id = ?", (triage_row["id"],)).fetchone()
            result = self._format_ticket(conn, updated)
            result["promoted_todo_codes"] = created_codes
            return result

    def reject_triage_proposal(self, project_slug: str, triage_code: str, proposal_id: str) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            conn.execute(
                "UPDATE ticket_proposals SET status = 'rejected' WHERE id = ?",
                (proposal_id,),
            )
        return self.get_ticket(project_slug, triage_code)  # type: ignore

    # ------------------------------------------------------------------
    # Flexible Feature Locks (Mutexes, Semaphores, TTL & Wait Queue)
    # ------------------------------------------------------------------
    def _expire_and_promote_locks(self, conn: sqlite3.Connection) -> None:
        ts = now_iso()
        expired_claims = conn.execute(
            "SELECT * FROM lock_claims WHERE status = 'held' AND expires_at <= ?",
            (ts,),
        ).fetchall()
        affected_lock_ids = {c["lock_id"] for c in expired_claims}
        if expired_claims:
            conn.execute(
                "UPDATE lock_claims SET status = 'expired', released_at = ? WHERE status = 'held' AND expires_at <= ?",
                (ts, ts),
            )
        for lock_id in affected_lock_ids:
            self._promote_queued_claims(conn, lock_id)

    def _promote_queued_claims(self, conn: sqlite3.Connection, lock_id: str) -> list[dict[str, Any]]:
        lock_row = conn.execute("SELECT * FROM feature_locks WHERE id = ?", (lock_id,)).fetchone()
        if not lock_row:
            return []
        held_count = conn.execute(
            "SELECT COUNT(*) as c FROM lock_claims WHERE lock_id = ? AND status = 'held'",
            (lock_id,),
        ).fetchone()["c"]
        free_slots = max(0, lock_row["max_slots"] - held_count)
        if free_slots <= 0:
            return []

        queued = conn.execute(
            "SELECT * FROM lock_claims WHERE lock_id = ? AND status = 'queued' ORDER BY acquired_at ASC LIMIT ?",
            (lock_id, free_slots),
        ).fetchall()
        promoted = []
        now = datetime.now(timezone.utc)
        for q in queued:
            # Preserve requested duration (stored as expires_at - acquired_at) or default 30m
            try:
                orig_acq = datetime.strptime(q["acquired_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                orig_exp = datetime.strptime(q["expires_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                dur = max(timedelta(minutes=5), orig_exp - orig_acq)
            except Exception:
                dur = timedelta(minutes=30)
            new_acq = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            new_exp = (now + dur).strftime("%Y-%m-%dT%H:%M:%SZ")
            conn.execute(
                "UPDATE lock_claims SET status = 'held', acquired_at = ?, expires_at = ? WHERE id = ?",
                (new_acq, new_exp, q["id"]),
            )
            promoted.append(dict(q))
        return promoted

    def _format_lock(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        held = conn.execute(
            "SELECT * FROM lock_claims WHERE lock_id = ? AND status = 'held' ORDER BY acquired_at ASC",
            (d["id"],),
        ).fetchall()
        queued = conn.execute(
            "SELECT * FROM lock_claims WHERE lock_id = ? AND status = 'queued' ORDER BY acquired_at ASC",
            (d["id"],),
        ).fetchall()
        d["active_claims"] = [dict(c) for c in held]
        d["wait_queue"] = [dict(c) for c in queued]
        d["available_slots"] = max(0, d["max_slots"] - len(held))
        d["status"] = "free" if len(held) < d["max_slots"] else "held"
        return d

    def list_locks(self, project_slug: Optional[str] = None) -> list[dict[str, Any]]:
        ts = now_iso()
        with self.connect() as rconn:
            has_expired = (
                rconn.execute(
                    "SELECT 1 FROM lock_claims WHERE status = 'held' AND expires_at <= ? LIMIT 1",
                    (ts,),
                ).fetchone()
                is not None
            )
        if has_expired:
            with self.connect(immediate=True) as wconn:
                self._expire_and_promote_locks(wconn)

        with self.connect() as conn:
            if project_slug:
                proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
                if proj:
                    rows = conn.execute(
                        "SELECT * FROM feature_locks WHERE project_id IS NULL OR project_id = ? ORDER BY name ASC",
                        (proj["id"],),
                    ).fetchall()
                else:
                    rows = conn.execute("SELECT * FROM feature_locks ORDER BY name ASC").fetchall()
            else:
                rows = conn.execute("SELECT * FROM feature_locks ORDER BY name ASC").fetchall()

            if not rows:
                return []

            lock_ids = [r["id"] for r in rows]
            placeholders = ",".join("?" for _ in lock_ids)
            claim_rows = conn.execute(
                f"""
                SELECT * FROM lock_claims
                WHERE lock_id IN ({placeholders}) AND status IN ('held', 'queued')
                ORDER BY acquired_at ASC
                """,
                lock_ids,
            ).fetchall()

            held_by_lock: dict[str, list[dict[str, Any]]] = {lid: [] for lid in lock_ids}
            queued_by_lock: dict[str, list[dict[str, Any]]] = {lid: [] for lid in lock_ids}
            for cr in claim_rows:
                cd = dict(cr)
                if cd["status"] == "held":
                    held_by_lock[cd["lock_id"]].append(cd)
                else:
                    queued_by_lock[cd["lock_id"]].append(cd)

            result: list[dict[str, Any]] = []
            for row in rows:
                d = dict(row)
                held = held_by_lock[d["id"]]
                queued = queued_by_lock[d["id"]]
                d["active_claims"] = held
                d["wait_queue"] = queued
                d["available_slots"] = max(0, d["max_slots"] - len(held))
                d["status"] = "free" if len(held) < d["max_slots"] else "held"
                result.append(d)
            return result

    def upsert_lock(self, req: LockCreate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            pid = None
            if req.project_slug:
                p = conn.execute("SELECT id FROM projects WHERE slug = ?", (req.project_slug,)).fetchone()
                if p:
                    pid = p["id"]
            existing = conn.execute("SELECT * FROM feature_locks WHERE name = ?", (req.name,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE feature_locks SET max_slots = ?, description = ?, project_id = COALESCE(?, project_id) WHERE id = ?",
                    (req.max_slots, req.description, pid, existing["id"]),
                )
                lid = existing["id"]
            else:
                lid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO feature_locks (id, project_id, name, max_slots, description, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (lid, pid, req.name, req.max_slots, req.description, now_iso()),
                )
            row = conn.execute("SELECT * FROM feature_locks WHERE id = ?", (lid,)).fetchone()
            return self._format_lock(conn, row)

    def acquire_lock(self, lock_name: str, req: LockAcquireRequest) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            self._expire_and_promote_locks(conn)
            lock_row = conn.execute("SELECT * FROM feature_locks WHERE name = ?", (lock_name,)).fetchone()
            if not lock_row:
                lid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO feature_locks (id, project_id, name, max_slots, description, created_at)
                    VALUES (?, NULL, ?, 1, 'Auto-created feature lock', ?)
                    """,
                    (lid, lock_name, now_iso()),
                )
                lock_row = conn.execute("SELECT * FROM feature_locks WHERE id = ?", (lid,)).fetchone()

            lid = lock_row["id"]
            now = datetime.now(timezone.utc)
            acq_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            exp_iso = (now + timedelta(minutes=max(1, req.expected_minutes))).strftime("%Y-%m-%dT%H:%M:%SZ")

            # Check if this agent already holds or is queued for this lock
            existing_claim = conn.execute(
                "SELECT * FROM lock_claims WHERE lock_id = ? AND agent_id = ? AND status IN ('held', 'queued')",
                (lid, req.agent_id),
            ).fetchone()
            if existing_claim:
                conn.execute(
                    "UPDATE lock_claims SET reason = ?, ticket_code = ?, expires_at = ? WHERE id = ?",
                    (req.reason, req.ticket_code, exp_iso, existing_claim["id"]),
                )
                lock_info = self._format_lock(conn, lock_row)
                return {
                    "acquired": existing_claim["status"] == "held",
                    "claim_status": existing_claim["status"],
                    "lock": lock_info,
                }

            held_count = conn.execute(
                "SELECT COUNT(*) as c FROM lock_claims WHERE lock_id = ? AND status = 'held'",
                (lid,),
            ).fetchone()["c"]

            if held_count < lock_row["max_slots"]:
                conn.execute(
                    """
                    INSERT INTO lock_claims (id, lock_id, agent_id, ticket_code, status, reason, acquired_at, expires_at)
                    VALUES (?, ?, ?, ?, 'held', ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), lid, req.agent_id, req.ticket_code, req.reason, acq_iso, exp_iso),
                )
                lock_info = self._format_lock(conn, lock_row)
                return {
                    "acquired": True,
                    "claim_status": "held",
                    "lock": lock_info,
                }

            if req.enqueue_if_busy:
                conn.execute(
                    """
                    INSERT INTO lock_claims (id, lock_id, agent_id, ticket_code, status, reason, acquired_at, expires_at)
                    VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), lid, req.agent_id, req.ticket_code, req.reason, acq_iso, exp_iso),
                )
                lock_info = self._format_lock(conn, lock_row)
                queue_pos = next(
                    (i + 1 for i, c in enumerate(lock_info["wait_queue"]) if c["agent_id"] == req.agent_id),
                    len(lock_info["wait_queue"]),
                )
                return {
                    "acquired": False,
                    "claim_status": "queued",
                    "queue_position": queue_pos,
                    "lock": lock_info,
                }

            lock_info = self._format_lock(conn, lock_row)
            return {
                "acquired": False,
                "claim_status": "busy",
                "lock": lock_info,
            }

    def release_lock(self, lock_name: str, agent_id: str) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            self._expire_and_promote_locks(conn)
            lock_row = conn.execute("SELECT * FROM feature_locks WHERE name = ?", (lock_name,)).fetchone()
            if not lock_row:
                raise ValueError(f"Lock '{lock_name}' not found")
            lid = lock_row["id"]
            ts = now_iso()
            conn.execute(
                """
                UPDATE lock_claims
                SET status = 'released', released_at = ?
                WHERE lock_id = ? AND agent_id = ? AND status IN ('held', 'queued')
                """,
                (ts, lid, agent_id),
            )
            promoted = self._promote_queued_claims(conn, lid)
            lock_info = self._format_lock(conn, lock_row)
            return {
                "released": True,
                "promoted_agents": [p["agent_id"] for p in promoted],
                "lock": lock_info,
            }

    def heartbeat_lock(self, lock_name: str, agent_id: str, extend_minutes: int = 15) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            self._expire_and_promote_locks(conn)
            lock_row = conn.execute("SELECT * FROM feature_locks WHERE name = ?", (lock_name,)).fetchone()
            if not lock_row:
                raise ValueError(f"Lock '{lock_name}' not found")
            claim = conn.execute(
                "SELECT * FROM lock_claims WHERE lock_id = ? AND agent_id = ? AND status = 'held'",
                (lock_row["id"], agent_id),
            ).fetchone()
            if not claim:
                raise RuntimeError(f"Agent '{agent_id}' does not currently hold lock '{lock_name}'")
            new_exp = (datetime.now(timezone.utc) + timedelta(minutes=max(1, extend_minutes))).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            conn.execute("UPDATE lock_claims SET expires_at = ? WHERE id = ?", (new_exp, claim["id"]))
            return self._format_lock(conn, lock_row)

    # ------------------------------------------------------------------
    # Agents & Quota / Usage Exhaustion Handoff
    # ------------------------------------------------------------------
    def list_agents(self, project_slug: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            rows = conn.execute(
                "SELECT * FROM agents WHERE project_id = ? ORDER BY last_seen_at DESC",
                (proj["id"],),
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                held_locks = conn.execute(
                    """
                    SELECT fl.name FROM lock_claims lc
                    JOIN feature_locks fl ON lc.lock_id = fl.id
                    WHERE lc.agent_id = ? AND lc.status = 'held'
                    """,
                    (d["id"],),
                ).fetchall()
                d["held_locks"] = [hl["name"] for hl in held_locks]
                result.append(d)
            return result

    def upsert_agent(self, req: AgentUpsertRequest) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (req.project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{req.project_slug}' not found")
            pid = proj["id"]
            ts = now_iso()
            conn.execute(
                """
                INSERT INTO agents (
                    id, project_id, status, current_ticket_code, worktree_path,
                    branch_name, usage_reset_at, handoff_note, last_seen_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id, project_id) DO UPDATE SET
                    status = excluded.status,
                    current_ticket_code = COALESCE(excluded.current_ticket_code, agents.current_ticket_code),
                    worktree_path = CASE WHEN excluded.worktree_path != '' THEN excluded.worktree_path ELSE agents.worktree_path END,
                    branch_name = CASE WHEN excluded.branch_name != '' THEN excluded.branch_name ELSE agents.branch_name END,
                    usage_reset_at = excluded.usage_reset_at,
                    handoff_note = CASE WHEN excluded.handoff_note != '' THEN excluded.handoff_note ELSE agents.handoff_note END,
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    req.agent_id,
                    pid,
                    req.status,
                    req.current_ticket_code,
                    req.worktree_path or "",
                    req.branch_name or "",
                    req.usage_reset_at,
                    req.handoff_note or "",
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM agents WHERE id = ? AND project_id = ?", (req.agent_id, pid)
            ).fetchone()
            return dict(row)

    def report_agent_usage_exhausted(self, req: AgentUsageExhaustedRequest) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (req.project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{req.project_slug}' not found")
            pid = proj["id"]
            ts = now_iso()

            # 1. Release all locks held or queued by this agent
            claims = conn.execute(
                """
                SELECT lc.lock_id, fl.name FROM lock_claims lc
                JOIN feature_locks fl ON lc.lock_id = fl.id
                WHERE lc.agent_id = ? AND lc.status IN ('held', 'queued')
                """,
                (req.agent_id,),
            ).fetchall()
            released_locks = [c["name"] for c in claims]
            conn.execute(
                "UPDATE lock_claims SET status = 'released', released_at = ? WHERE agent_id = ? AND status IN ('held', 'queued')",
                (ts, req.agent_id),
            )
            for c in {c["lock_id"] for c in claims}:
                self._promote_queued_claims(conn, c)

            # 2. Find active ticket(s) owned by this agent
            owned_tickets = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND owner = ? AND status IN ('in-progress', 'blocked', 'triage')",
                (pid, req.agent_id),
            ).fetchall()
            handed_off_tickets: list[str] = []
            for t in owned_tickets:
                new_status = "blocked" if (req.release_ticket and t["status"] == "in-progress") else t["status"]
                blocked_reason = (
                    f"Quota/usage exhausted by {req.agent_id}. Awaiting handover."
                    if (req.release_ticket and t["status"] == "in-progress")
                    else (t["blocked_reason"] or "")
                )
                new_owner = t["owner"]
                branch = req.branch_name or t["branch_name"]
                wt = req.worktree_path or t["worktree_path"]
                sha = req.commit_sha or t["commit_sha"]
                conn.execute(
                    """
                    UPDATE tickets
                    SET status = ?, owner = ?, blocked_reason = ?, branch_name = ?, worktree_path = ?, commit_sha = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (new_status, new_owner, blocked_reason, branch, wt, sha, ts, t["id"]),
                )
                note_body = (
                    f"**Usage/Quota Exhausted Handoff (`{req.agent_id}`)**\n"
                    f"- Reset expected at: `{req.usage_reset_at or 'unknown'}`\n"
                    f"- Branch: `{branch or 'n/a'}` | Worktree: `{wt or 'n/a'}` | Commit: `{sha or 'n/a'}`\n"
                    f"- Status: Moved to `blocked` for handover.\n"
                    f"- Summary: {req.handoff_summary_md}"
                )
                conn.execute(
                    """
                    INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                    VALUES (?, ?, ?, 'handoff', ?, ?)
                    """,
                    (str(uuid.uuid4()), t["id"], req.agent_id, note_body, ts),
                )
                handed_off_tickets.append(t["code"])

            # 3. Update agent record
            conn.execute(
                """
                INSERT INTO agents (
                    id, project_id, status, current_ticket_code, worktree_path,
                    branch_name, usage_reset_at, handoff_note, last_seen_at
                )
                VALUES (?, ?, 'out-of-usage', NULL, ?, ?, ?, ?, ?)
                ON CONFLICT(id, project_id) DO UPDATE SET
                    status = 'out-of-usage',
                    current_ticket_code = NULL,
                    worktree_path = CASE WHEN excluded.worktree_path != '' THEN excluded.worktree_path ELSE agents.worktree_path END,
                    branch_name = CASE WHEN excluded.branch_name != '' THEN excluded.branch_name ELSE agents.branch_name END,
                    usage_reset_at = excluded.usage_reset_at,
                    handoff_note = excluded.handoff_note,
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    req.agent_id,
                    pid,
                    req.worktree_path or "",
                    req.branch_name or "",
                    req.usage_reset_at,
                    req.handoff_summary_md,
                    ts,
                ),
            )

            # 4. Post message to #agents channel
            t_str = ", ".join(handed_off_tickets) if handed_off_tickets else "none"
            conn.execute(
                """
                INSERT INTO messages (id, project_id, author, channel, title, body_md, ticket_code, pinned, created_at)
                VALUES (?, ?, ?, 'agents', ?, ?, ?, 0, ?)
                """,
                (
                    str(uuid.uuid4()),
                    pid,
                    req.agent_id,
                    f"Agent {req.agent_id} ran out of usage (Tickets: {t_str})",
                    f"**Handoff Summary:** {req.handoff_summary_md}\n\n"
                    f"- **Released locks:** {', '.join(released_locks) if released_locks else 'none'}\n"
                    f"- **Reset time:** `{req.usage_reset_at or 'unspecified'}`\n"
                    f"- **Story status:** Moved to `blocked` for peer handover.",
                    handed_off_tickets[0] if handed_off_tickets else "",
                    ts,
                ),
            )

            return {
                "agent_id": req.agent_id,
                "status": "out-of-usage",
                "usage_reset_at": req.usage_reset_at,
                "released_locks": released_locks,
                "handed_off_tickets": handed_off_tickets,
            }

    # ------------------------------------------------------------------
    # Agent Message Board
    # ------------------------------------------------------------------
    def list_messages(
        self,
        project_slug: str,
        channel: Optional[str] = None,
        limit: int = 50,
        parent_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]

            if parent_id is not None:
                rows = conn.execute(
                    """
                    SELECT * FROM messages
                    WHERE project_id = ? AND parent_id = ?
                    ORDER BY created_at ASC
                    LIMIT ?
                    """,
                    (pid, parent_id, limit),
                ).fetchall()
                return [dict(r) for r in rows]

            query = "SELECT * FROM messages WHERE project_id = ? AND (parent_id IS NULL OR parent_id = '')"
            params: list[Any] = [pid]
            if channel and channel != "all":
                query += " AND channel = ?"
                params.append(channel)
            query += " ORDER BY pinned DESC, created_at DESC LIMIT ?"
            params.append(limit)
            root_rows = conn.execute(query, params).fetchall()
            roots = [dict(r) for r in root_rows]
            if not roots:
                return []

            root_ids = [r["id"] for r in roots]
            placeholders = ",".join("?" for _ in root_ids)
            reply_rows = conn.execute(
                f"""
                SELECT * FROM messages
                WHERE project_id = ? AND parent_id IN ({placeholders})
                ORDER BY created_at ASC
                """,
                [pid, *root_ids],
            ).fetchall()

            replies_by_parent: dict[str, list[dict[str, Any]]] = {rid: [] for rid in root_ids}
            for rep in reply_rows:
                rep_dict = dict(rep)
                p = rep_dict.get("parent_id")
                if p in replies_by_parent:
                    replies_by_parent[p].append(rep_dict)

            for r in roots:
                r["reply_count"] = len(replies_by_parent.get(r["id"], []))
                r["replies"] = replies_by_parent.get(r["id"], [])

            return roots

    def post_message(self, project_slug: str, req: MessageCreate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            mid = str(uuid.uuid4())
            ts = now_iso()
            target_channel = (req.channel or "agents").strip()
            conn.execute(
                """
                INSERT INTO messages (id, project_id, author, channel, title, body_md, ticket_code, pinned, parent_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    mid,
                    proj["id"],
                    req.author,
                    target_channel,
                    req.title,
                    req.body_md,
                    req.ticket_code,
                    1 if req.pinned else 0,
                    req.parent_id,
                    ts,
                ),
            )
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
            res = dict(row)
            res["reply_count"] = 0
            res["replies"] = []
            return res

    # ------------------------------------------------------------------
    # Custom Agent Profiles
    # ------------------------------------------------------------------
    def list_custom_agent_profiles(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM agent_profiles ORDER BY created_at ASC").fetchall()
            return [dict(r) for r in rows]

    def upsert_agent_profile(self, req: AgentProfileCreate) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            pid = req.id or f"custom-{req.name.lower().replace(' ', '-')}-{str(uuid.uuid4())[:6]}"
            existing = conn.execute("SELECT id FROM agent_profiles WHERE id = ?", (pid,)).fetchone()
            ts = now_iso()
            if existing:
                conn.execute(
                    """
                    UPDATE agent_profiles
                    SET name = ?, provider = ?, config_path = ?, cli_command = ?, default_args = ?
                    WHERE id = ?
                    """,
                    (req.name, req.provider, req.config_path, req.cli_command, req.default_args, pid),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO agent_profiles (id, name, provider, config_path, cli_command, default_args, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (pid, req.name, req.provider, req.config_path, req.cli_command, req.default_args, ts),
                )
            row = conn.execute("SELECT * FROM agent_profiles WHERE id = ?", (pid,)).fetchone()
            return dict(row)

    def delete_agent_profile(self, profile_id: str) -> None:
        with self.connect(immediate=True) as conn:
            conn.execute("DELETE FROM agent_profiles WHERE id = ?", (profile_id,))

    # ------------------------------------------------------------------
    # Dead-Agent Watchdog, Auto-Runner & Grill Me Helpers
    # ------------------------------------------------------------------
    def check_and_recover_stalled_tasks(
        self,
        project_slug: Optional[str] = None,
        stall_threshold_minutes: int = 15,
        action: str = "block",
        auto_release_locks: bool = True,
    ) -> list[dict[str, Any]]:
        threshold_sec = max(1, stall_threshold_minutes) * 60
        now_dt = datetime.now(timezone.utc)
        cutoff_iso = (now_dt - timedelta(seconds=threshold_sec)).strftime("%Y-%m-%dT%H:%M:%SZ")

        with self.connect(immediate=True) as conn:
            proj_clause = ""
            params: list[Any] = []
            if project_slug:
                proj = conn.execute("SELECT id, slug FROM projects WHERE slug = ?", (project_slug,)).fetchone()
                if not proj:
                    return []
                proj_clause = "AND t.project_id = ?"
                params.append(proj["id"])

            query = f"""
                SELECT t.*, p.slug as project_slug, COALESCE(a.last_seen_at, t.updated_at) as effective_last_seen
                FROM tickets t
                JOIN projects p ON t.project_id = p.id
                LEFT JOIN agents a ON t.owner = a.id AND t.project_id = a.project_id
                WHERE t.status IN ('in-progress', 'review')
                  AND t.owner IS NOT NULL
                  AND t.owner NOT IN ('', '-', '—')
                  AND t.is_held = 0
                  AND (t.updated_at < ? OR t.updated_at IS NULL)
                  AND (a.last_seen_at < ? OR a.last_seen_at IS NULL)
                  {proj_clause}
                ORDER BY t.updated_at ASC
            """
            rows = conn.execute(query, [cutoff_iso, cutoff_iso] + params).fetchall()
            stalled: list[dict[str, Any]] = []

            ts = now_iso()
            for r in rows:
                tid = r["id"]
                code = r["code"]
                owner = r["owner"]
                p_slug = r["project_slug"]
                released_locks: list[str] = []

                if auto_release_locks:
                    held_claims = conn.execute(
                        """
                        SELECT lc.id, lc.lock_id, fl.name as lock_name
                        FROM lock_claims lc
                        JOIN feature_locks fl ON lc.lock_id = fl.id
                        WHERE lc.status = 'held' AND (lc.ticket_code = ? OR lc.agent_id = ?)
                        """,
                        (code, owner),
                    ).fetchall()
                    for hc in held_claims:
                        conn.execute(
                            "UPDATE lock_claims SET status = 'released', released_at = ? WHERE id = ?",
                            (ts, hc["id"]),
                        )
                        self._promote_queued_claims(conn, hc["lock_id"])
                        released_locks.append(hc["lock_name"])

                new_status = "blocked" if action == "block" else "todo"
                blocked_reason = (
                    f"Dead-Agent Watchdog: Agent '{owner}' stalled (silent for >{stall_threshold_minutes}m)."
                    if new_status == "blocked"
                    else ""
                )
                new_owner = owner if new_status == "blocked" else ""
                conn.execute(
                    """
                    UPDATE tickets
                    SET status = ?, owner = ?, blocked_reason = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (new_status, new_owner, blocked_reason, ts, tid),
                )

                note_body = (
                    f"⏱️ **Dead-Agent Watchdog**: Agent `{owner}` stalled without heartbeat or updates for "
                    f">`{stall_threshold_minutes}m`.\n"
                    f"- **Action Taken**: Ticket moved to `{new_status}` for recovery / peer handover.\n"
                    + (f"- **Released Locks**: {', '.join(released_locks)}\n" if released_locks else "")
                )
                conn.execute(
                    """
                    INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                    VALUES (?, ?, 'watchdog', 'system', ?, ?)
                    """,
                    (str(uuid.uuid4()), tid, note_body, ts),
                )

                # Post alert to #agents channel
                conn.execute(
                    """
                    INSERT INTO messages (id, project_id, author, channel, title, body_md, ticket_code, pinned, created_at)
                    VALUES (?, ?, 'watchdog', 'agents', ?, ?, ?, 0, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        r["project_id"],
                        f"Watchdog recovered stalled ticket {code} ({owner})",
                        note_body,
                        code,
                        ts,
                    ),
                )

                stalled.append({
                    "code": code,
                    "ticket_code": code,
                    "project_slug": p_slug,
                    "previous_status": r["status"],
                    "new_status": new_status,
                    "action": action,
                    "agent_id": owner,
                    "released_locks": released_locks,
                    "released_locks_count": len(released_locks),
                })

            return stalled

    def get_autorunner_queue(self, project_slug: str) -> dict[str, Any]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id, slug FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            pid = proj["id"]

            all_t = conn.execute("SELECT code, status FROM tickets WHERE project_id = ?", (pid,)).fetchall()
            status_map = {r["code"]: r["status"] for r in all_t}

            todo_rows = conn.execute(
                """
                SELECT t.*, COALESCE(s.position, 999) as sec_pos
                FROM tickets t
                LEFT JOIN sections s ON t.section_id = s.id
                WHERE t.project_id = ? AND t.status = 'todo' AND t.is_held = 0
                ORDER BY sec_pos ASC, t.position ASC, t.created_at ASC
                """,
                (pid,),
            ).fetchall()
            claimable_todos = []
            for r in todo_rows:
                deps = json.loads(r["depends_on_json"] or "[]")
                if all(status_map.get(d) in ("done", "review") for d in deps):
                    claimable_todos.append(self._format_ticket(conn, r, status_map=status_map))

            in_prog_rows = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND status = 'in-progress' AND is_held = 0 ORDER BY updated_at DESC",
                (pid,),
            ).fetchall()
            active_in_progress = [self._format_ticket(conn, r, status_map=status_map) for r in in_prog_rows]

            rev_rows = conn.execute(
                "SELECT * FROM tickets WHERE project_id = ? AND status = 'review' AND is_held = 0 ORDER BY updated_at DESC",
                (pid,),
            ).fetchall()
            pending_reviews = [
                self._format_ticket(conn, r, include_notes=True, status_map=status_map)
                for r in rev_rows
            ]

            return {
                "claimable_todos": claimable_todos,
                "active_in_progress": active_in_progress,
                "pending_reviews": pending_reviews,
            }

    def get_ticket_grill_chat(self, project_slug: str, code: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                return []
            trow = conn.execute(
                "SELECT id FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (proj["id"], code),
            ).fetchone()
            if not trow:
                return []
            rows = conn.execute(
                "SELECT * FROM ticket_notes WHERE ticket_id = ? AND kind = 'grill-chat' ORDER BY created_at ASC",
                (trow["id"],),
            ).fetchall()
            return [
                {
                    "role": r["author"],
                    "content": r["content_md"],
                    "timestamp": r["created_at"],
                }
                for r in rows
            ]

    def add_ticket_grill_message(
        self, project_slug: str, code: str, role: str, content: str
    ) -> dict[str, Any]:
        with self.connect(immediate=True) as conn:
            proj = conn.execute("SELECT id FROM projects WHERE slug = ?", (project_slug,)).fetchone()
            if not proj:
                raise ValueError(f"Project '{project_slug}' not found")
            trow = conn.execute(
                "SELECT id FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (proj["id"], code),
            ).fetchone()
            if not trow:
                raise ValueError(f"Ticket '{code}' not found")
            ts = now_iso()
            mid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                VALUES (?, ?, ?, 'grill-chat', ?, ?)
                """,
                (mid, trow["id"], role, content, ts),
            )
            return {
                "id": mid,
                "role": role,
                "content": content,
                "timestamp": ts,
            }

