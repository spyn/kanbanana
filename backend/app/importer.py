from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from .db import Database, now_iso
from .models import (
    LockAcquireRequest,
    LockCreate,
    MessageCreate,
    ProjectCreate,
    ProjectSettings,
    ProjectUpdate,
    SectionCreate,
    SkillConfig,
    SkillContextRow,
)
from .routing_config import normalize_project_settings


TICKET_CODE_RE = re.compile(r"\b(M0|X0|[QDPRSB]\d{1,2})\b")
BRANCH_RE = re.compile(r"`(board/[a-zA-Z0-9._-]+|feat/[a-zA-Z0-9._-]+)`")
PR_URL_RE = re.compile(r"(https?://[^\s)\]>]+/pulls/\d+)")
COMMIT_RE = re.compile(r"\b([0-9a-f]{7,10})\b")


def get_configs_dir() -> Path:
    env_dir = os.environ.get("KANBANANA_CONFIGS_DIR")
    if env_dir:
        p = Path(env_dir)
        if p.exists():
            return p
    root = Path(__file__).resolve().parent.parent.parent
    p = root / "configs" / "projects"
    if p.exists():
        return p
    return root / "configs"


def list_project_presets() -> list[dict[str, Any]]:
    configs_dir = get_configs_dir()
    presets: list[dict[str, Any]] = []
    if not configs_dir.exists():
        return presets
    for f in sorted(configs_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            slug = data.get("slug") or f.stem
            presets.append(
                {
                    "slug": slug,
                    "name": data.get("name", slug),
                    "description": data.get("description", ""),
                    "repo_path": data.get("repo_path", ""),
                    "file_path": str(f),
                }
            )
        except Exception:
            continue
    return presets


def load_project_preset(
    preset_name: str | None = None,
    config_path: str | Path | None = None,
) -> dict[str, Any]:
    if config_path:
        p = Path(config_path)
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass

    configs_dir = get_configs_dir()
    target_slug = preset_name or os.environ.get("KANBANANA_DEFAULT_PROJECT") or "default"

    preset_file = configs_dir / f"{target_slug}.json"
    if preset_file.exists():
        try:
            return json.loads(preset_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    for f in configs_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("slug") == target_slug:
                return data
        except Exception:
            continue

    default_file = configs_dir / "default.json"
    if default_file.exists():
        try:
            return json.loads(default_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {}


def parse_skill_md(
    skill_text: str,
    project_slug: str = "default",
    preset: dict[str, Any] | None = None,
) -> SkillConfig:
    if preset is None:
        preset = load_project_preset(project_slug)

    skill_cfg_data = preset.get("skill_config", {}) if preset else {}

    memory_rows: list[SkillContextRow] = []
    in_table = False
    for line in skill_text.splitlines():
        s = line.strip()
        if s.startswith("| Task area |"):
            in_table = True
            continue
        if in_table:
            if s.startswith("|---"):
                continue
            if s.startswith("|") and s.endswith("|"):
                parts = [p.strip() for p in s.strip("|").split("|")]
                if len(parts) >= 3:
                    memory_rows.append(
                        SkillContextRow(
                            task_area=parts[0],
                            board_ids=parts[1],
                            read_files=parts[2],
                        )
                    )
            else:
                in_table = False

    custom_rules = ""
    if "## 4. Rules while working" in skill_text:
        after_r = skill_text.split("## 4. Rules while working", 1)[1]
        if "## 5." in after_r:
            custom_rules = after_r.split("## 5.", 1)[0].strip()
        else:
            custom_rules = after_r.strip()

    if not memory_rows and "memory_table" in skill_cfg_data:
        for r in skill_cfg_data["memory_table"]:
            memory_rows.append(
                SkillContextRow(
                    task_area=r.get("task_area", ""),
                    board_ids=r.get("board_ids", ""),
                    read_files=r.get("read_files", ""),
                )
            )

    return SkillConfig(
        skill_name=skill_cfg_data.get("skill_name") or f"{project_slug}-board",
        description=(
            skill_cfg_data.get("description")
            or f"How to pick up, work, triage, and hand back a task from the shared {project_slug} Kanbanana MCP board without clashing with other agents."
        ),
        board_path_note=skill_cfg_data.get("board_path_note") or "Managed via Kanbanana MCP",
        background_report_path=skill_cfg_data.get("background_report_path", ""),
        research_notes_path=skill_cfg_data.get("research_notes_path", ""),
        hindsight_url=skill_cfg_data.get("hindsight_url", ""),
        local_memory_dir=skill_cfg_data.get("local_memory_dir", ""),
        memory_table=memory_rows,
        graphify_graph_path=skill_cfg_data.get("graphify_graph_path", ""),
        custom_rules_md=custom_rules or skill_cfg_data.get("custom_rules_md", ""),
        skill_output_path=skill_cfg_data.get("skill_output_path") or f"~/.claude/skills/{project_slug}-board/SKILL.md",
    )


def parse_board_md(board_text: str) -> dict[str, Any]:
    lines = board_text.splitlines()
    sections: list[dict[str, Any]] = []
    tickets: list[dict[str, Any]] = []

    current_section: Optional[dict[str, Any]] = None
    current_ticket: Optional[dict[str, Any]] = None
    current_field: Optional[str] = None

    sec_header_re = re.compile(r"^##\s+([0-9a-zA-Z]+)\.\s+(.*)$")
    ticket_header_re = re.compile(r"^###\s+([A-Za-z0-9_-]+)\s+[^\w\s]\s+(.*)$")
    state_re = re.compile(
        r"^-\s+\*\*State:\*\*\s*([A-Za-z0-9_-]+)\s*\|\s*([a-zA-Z-]+)\s*\|\s*owner:\s*([^|]+)\|\s*updated:\s*(.*)$"
    )

    def flush_ticket() -> None:
        nonlocal current_ticket, current_field
        if current_ticket is not None:
            for k in ("files_md", "do_md", "done_when_md", "notes_raw"):
                current_ticket[k] = "\n".join(current_ticket[k]).strip()
            tickets.append(current_ticket)
            current_ticket = None
            current_field = None

    for line in lines:
        sec_m = sec_header_re.match(line)
        if sec_m:
            flush_ticket()
            sec_code = sec_m.group(1).strip()
            sec_title = f"{sec_code}. {sec_m.group(2).strip()}"
            current_section = {
                "code": sec_code,
                "title": sec_title,
                "desc_lines": [],
                "position": len(sections),
            }
            sections.append(current_section)
            continue

        t_m = ticket_header_re.match(line)
        if t_m:
            flush_ticket()
            t_code = t_m.group(1).strip()
            t_title = t_m.group(2).strip()
            current_ticket = {
                "code": t_code,
                "title": t_title,
                "section_code": current_section["code"] if current_section else "0",
                "status": "todo",
                "owner": None,
                "updated": None,
                "depends_on": [],
                "files_md": [],
                "do_md": [],
                "done_when_md": [],
                "notes_raw": [],
                "position": len(tickets),
            }
            current_field = None
            continue

        if current_ticket is None:
            if current_section is not None and not line.strip().startswith("---"):
                current_section["desc_lines"].append(line)
            continue

        # Inside a ticket
        if line.strip() == "---":
            continue

        st_m = state_re.match(line.strip())
        if st_m:
            raw_status = st_m.group(2).strip().lower()
            valid_statuses = {"triage", "todo", "in-progress", "review", "blocked", "done"}
            current_ticket["status"] = raw_status if raw_status in valid_statuses else "todo"
            raw_owner = st_m.group(3).strip()
            current_ticket["owner"] = None if raw_owner in ("—", "-", "", "none") else raw_owner
            raw_upd = st_m.group(4).strip()
            current_ticket["updated"] = None if raw_upd in ("—", "-", "") else raw_upd
            current_field = None
            continue

        if line.startswith("- **Depends on:**"):
            dep_str = line.split("- **Depends on:**", 1)[1].strip()
            if dep_str not in ("—", "-", ""):
                deps = []
                for m in TICKET_CODE_RE.finditer(dep_str):
                    code_dep = m.group(1)
                    if code_dep != current_ticket["code"] and code_dep not in deps:
                        deps.append(code_dep)
                current_ticket["depends_on"] = deps
            current_field = None
            continue

        if line.startswith("- **Files:**"):
            val = line.split("- **Files:**", 1)[1].strip()
            if val:
                current_ticket["files_md"].append(val)
            current_field = "files_md"
            continue

        if line.startswith("- **Do:**"):
            val = line.split("- **Do:**", 1)[1].strip()
            if val:
                current_ticket["do_md"].append(val)
            current_field = "do_md"
            continue

        if line.startswith("- **Done when:**"):
            val = line.split("- **Done when:**", 1)[1].strip()
            if val:
                current_ticket["done_when_md"].append(val)
            current_field = "done_when_md"
            continue

        if line.startswith("- **Notes:**"):
            val = line.split("- **Notes:**", 1)[1].strip()
            if val:
                current_ticket["notes_raw"].append(val)
            current_field = "notes_raw"
            continue

        # Top-level agent comment before/after Notes (e.g. `- bg-200fdbe0 (2026-10-23): ...`)
        if line.startswith("- ") and current_field != "notes_raw":
            current_ticket["notes_raw"].append(line)
            current_field = "notes_raw"
            continue

        if current_field is not None:
            # Strip 2-space indentation for Do / Done when / Files, keep structure for Notes
            if current_field in ("do_md", "done_when_md", "files_md"):
                cleaned = line[2:] if line.startswith("  ") else line
                current_ticket[current_field].append(cleaned)
            else:
                cleaned = line[2:] if line.startswith("  ") else line
                current_ticket["notes_raw"].append(cleaned)

    flush_ticket()

    for s in sections:
        s["description_md"] = "\n".join(s.pop("desc_lines")).strip()

    return {"sections": sections, "tickets": tickets}


def split_notes_into_entries(notes_raw: str, default_author: str) -> list[dict[str, str]]:
    if not notes_raw.strip():
        return []
    lines = notes_raw.splitlines()
    blocks: list[list[str]] = []
    for line in lines:
        if line.startswith("- ") and blocks:
            blocks.append([line[2:]])
        elif line.startswith("- ") and not blocks:
            blocks.append([line[2:]])
        else:
            if not blocks:
                blocks.append([line])
            else:
                blocks[-1].append(line)

    entries: list[dict[str, str]] = []
    author_prefix_re = re.compile(
        r"^([a-zA-Z0-9_-]{2,25})(?:\s*\([^)]+\))?(?:,\s*review[^:]*)?:\s*(.*)$"
    )
    date_author_re = re.compile(r"^(\d{4}-\d{2}-\d{2})\s+([a-zA-Z0-9_-]{2,25}):\s*(.*)$")

    for b in blocks:
        text = "\n".join(b).strip()
        if not text:
            continue
        first_line = b[0].strip()
        author = default_author or "board-import"
        kind = "note"

        m1 = author_prefix_re.match(first_line)
        m2 = date_author_re.match(first_line)
        if m1 and m1.group(1).lower() not in ("result", "method", "results", "branch", "open", "fix", "done", "measured", "tests", "pr", "handoff", "checked", "merge", "not", "superseded"):
            author = m1.group(1)
            if "review" in first_line.lower():
                kind = "review"
        elif m2:
            author = m2.group(2)
        elif first_line.lower().startswith("**handoff"):
            kind = "handoff"

        entries.append({"author": author, "kind": kind, "content_md": text})
    return entries


def parse_gpu_lock_md(gpu_text: str) -> list[dict[str, Any]]:
    locks: list[dict[str, Any]] = []
    line_re = re.compile(r"^-\s+([a-zA-Z0-9_-]+):\s+(.*)$")
    claim_re = re.compile(
        r"held by\s+([^\s]+)\s+since\s+([0-9-]+\s+[0-9:]+)\s+for\s+(.*?)(?:,\s*expected until\s+([0-9:]+))?$"
    )
    for line in gpu_text.splitlines():
        m = line_re.match(line.strip())
        if not m:
            continue
        machine = m.group(1).strip()
        state_str = m.group(2).strip()
        lock_info: dict[str, Any] = {
            "name": f"gpu:{machine}",
            "machine": machine,
            "description": f"GPU benchmark & model execution lock for {machine}",
            "held_by": None,
            "reason": "",
        }
        if state_str.lower() != "free":
            cm = claim_re.search(state_str)
            if cm:
                lock_info["held_by"] = cm.group(1)
                lock_info["reason"] = cm.group(3)
            else:
                lock_info["held_by"] = "unknown-agent"
                lock_info["reason"] = state_str
        locks.append(lock_info)
    return locks


def import_current_state_into_db(
    db: Database,
    docs_dir: str | Path,
    project_slug: str = "default",
    preset: dict[str, Any] | None = None,
) -> dict[str, Any]:
    docs_path = Path(docs_dir)
    board_file = docs_path / "BOARD.md"
    gpu_file = docs_path / "GPU_LOCK.md"
    skill_file = docs_path / "SKILL.md"

    if preset is None:
        preset = load_project_preset(project_slug)

    board_text = board_file.read_text(encoding="utf-8") if board_file.exists() else ""
    gpu_text = gpu_file.read_text(encoding="utf-8") if gpu_file.exists() else ""
    skill_text = skill_file.read_text(encoding="utf-8") if skill_file.exists() else ""

    skill_cfg = parse_skill_md(skill_text, project_slug, preset) if skill_text else (
        SkillConfig(**preset["skill_config"]) if (preset and preset.get("skill_config")) else SkillConfig(skill_name=f"{project_slug}-board")
    )
    parsed_board = parse_board_md(board_text) if board_text else {"sections": [], "tickets": []}
    parsed_locks = parse_gpu_lock_md(gpu_text) if gpu_text else []

    existing_proj = db.get_project(project_slug)
    if not existing_proj:
        proj_name = (preset.get("name") if preset else None) or f"{project_slug.capitalize()} Engineering Board"
        proj_desc = (preset.get("description") if preset else None) or f"Shared multi-agent engineering board for {project_slug}."
        proj_repo = (preset.get("repo_path") if preset else None) or ""
        proj_bg = (preset.get("board_background_md") if preset else None) or ""

        proj = db.create_project(
            ProjectCreate(
                slug=project_slug,
                name=proj_name,
                description=proj_desc,
                repo_path=proj_repo,
                board_background_md=proj_bg,
                skill_config=skill_cfg,
            )
        )
    else:
        proj = existing_proj

    pid = proj["id"]

    # Upsert sections: from board.md or preset
    sec_id_by_code: dict[str, str] = {}
    sections_to_upsert = parsed_board["sections"]
    if not sections_to_upsert and preset and preset.get("sections"):
        sections_to_upsert = preset["sections"]

    for s in sections_to_upsert:
        sec_obj = db.upsert_section(
            project_slug,
            SectionCreate(
                code=s["code"],
                title=s["title"],
                description_md=s.get("description_md", ""),
                position=s.get("position", 0),
            ),
        )
        sec_id_by_code[s["code"]] = sec_obj["id"]

    # Upsert tickets & notes in a single transaction for speed
    imported_tickets = 0
    discovered_agents: dict[str, dict[str, Any]] = {}

    with db.connect(immediate=True) as conn:
        for t in parsed_board["tickets"]:
            sec_id = sec_id_by_code.get(t["section_code"])
            notes_raw = t["notes_raw"]

            branch_m = BRANCH_RE.search(notes_raw)
            branch_name = branch_m.group(1) if branch_m else ""
            pr_m = PR_URL_RE.search(notes_raw)
            pr_url = pr_m.group(1) if pr_m else ""

            commit_sha = ""
            for cm in COMMIT_RE.finditer(notes_raw):
                cand = cm.group(1)
                if any(c.isdigit() for c in cand) and any(c.isalpha() for c in cand):
                    commit_sha = cand
                    break

            upd_ts = (
                f"{t['updated']}T12:00:00Z"
                if t.get("updated") and re.match(r"^\d{4}-\d{2}-\d{2}$", t["updated"])
                else now_iso()
            )

            existing_t = conn.execute(
                "SELECT id FROM tickets WHERE project_id = ? AND UPPER(code) = UPPER(?)",
                (pid, t["code"]),
            ).fetchone()

            if existing_t:
                tid = existing_t["id"]
                conn.execute(
                    """
                    UPDATE tickets SET
                        section_id = ?, title = ?, status = ?, owner = ?,
                        depends_on_json = ?, files_md = ?, do_md = ?, done_when_md = ?,
                        branch_name = ?, pr_url = ?, commit_sha = ?, position = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        sec_id,
                        t["title"],
                        t["status"],
                        t["owner"],
                        json.dumps(t["depends_on"]),
                        t["files_md"],
                        t["do_md"],
                        t["done_when_md"],
                        branch_name,
                        pr_url,
                        commit_sha,
                        t["position"],
                        upd_ts,
                        tid,
                    ),
                )
                conn.execute("DELETE FROM ticket_notes WHERE ticket_id = ?", (tid,))
            else:
                tid = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO tickets (
                        id, project_id, section_id, code, title, status, triage_state, owner,
                        depends_on_json, files_md, do_md, done_when_md,
                        branch_name, pr_url, commit_sha, position, updated_at, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tid,
                        pid,
                        sec_id,
                        t["code"],
                        t["title"],
                        t["status"],
                        t["owner"],
                        json.dumps(t["depends_on"]),
                        t["files_md"],
                        t["do_md"],
                        t["done_when_md"],
                        branch_name,
                        pr_url,
                        commit_sha,
                        t["position"],
                        upd_ts,
                        upd_ts,
                    ),
                )

            note_entries = split_notes_into_entries(notes_raw, t["owner"] or "board-import")
            for idx, ne in enumerate(note_entries):
                conn.execute(
                    """
                    INSERT INTO ticket_notes (id, ticket_id, author, kind, content_md, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), tid, ne["author"], ne["kind"], ne["content_md"], upd_ts),
                )

            if t["owner"]:
                ag_id = t["owner"]
                discovered_agents[ag_id] = {
                    "id": ag_id,
                    "status": "active" if t["status"] == "in-progress" else "idle",
                    "current_ticket_code": t["code"] if t["status"] in ("in-progress", "blocked") else None,
                    "branch_name": branch_name,
                    "last_seen_at": upd_ts,
                }

            imported_tickets += 1

        # Seed discovered agents
        for ag in discovered_agents.values():
            conn.execute(
                """
                INSERT INTO agents (id, project_id, status, current_ticket_code, branch_name, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id, project_id) DO UPDATE SET
                    status = excluded.status,
                    current_ticket_code = COALESCE(excluded.current_ticket_code, agents.current_ticket_code),
                    branch_name = CASE WHEN excluded.branch_name != '' THEN excluded.branch_name ELSE agents.branch_name END
                """,
                (
                    ag["id"],
                    pid,
                    ag["status"],
                    ag["current_ticket_code"],
                    ag["branch_name"],
                    ag["last_seen_at"],
                ),
            )

    # Upsert GPU / resource locks: from GPU_LOCK.md or preset
    locks_to_upsert = parsed_locks
    if not locks_to_upsert and preset and preset.get("locks"):
        locks_to_upsert = [
            {
                "name": l["name"],
                "description": l.get("description", f"Resource lock for {l['name']}"),
                "max_slots": l.get("max_slots", 1),
                "held_by": None,
                "reason": "",
            }
            for l in preset["locks"]
        ]

    for lk in locks_to_upsert:
        db.upsert_lock(
            LockCreate(
                name=lk["name"],
                project_slug=project_slug,
                max_slots=lk.get("max_slots", 1),
                description=lk["description"],
            )
        )
        if lk.get("held_by"):
            db.acquire_lock(
                lk["name"],
                LockAcquireRequest(
                    agent_id=lk["held_by"],
                    reason=lk["reason"] or "Imported from lock configuration",
                    expected_minutes=60,
                ),
            )

    # Seed messages from preset if none exist yet
    existing_msgs = db.list_messages(project_slug, limit=5)
    if not existing_msgs:
        seed_messages = preset.get("seed_messages", []) if preset else []
        if seed_messages:
            for sm in seed_messages:
                db.post_message(
                    project_slug,
                    MessageCreate(
                        author=sm.get("author", "system"),
                        channel=sm.get("channel", "general"),
                        title=sm.get("title", ""),
                        body_md=sm.get("body_md", ""),
                        ticket_code=sm.get("ticket_code") or "",
                        pinned=sm.get("pinned", False),
                    ),
                )
        else:
            db.post_message(
                project_slug,
                MessageCreate(
                    author="system",
                    channel="general",
                    title=f"Welcome to {project_slug} Board",
                    body_md=f"Imported {imported_tickets} tickets. Use `claim_ticket` or `pick_next_todo` over MCP/A2A.",
                    pinned=True,
                ),
            )

    return {
        "project_slug": project_slug,
        "sections_imported": len(sections_to_upsert),
        "tickets_imported": imported_tickets,
        "locks_imported": len(locks_to_upsert),
        "agents_imported": len(discovered_agents),
    }


def import_project_config(db: Database, config: dict[str, Any]) -> dict[str, Any]:
    slug = config.get("slug")
    if not slug:
        raise ValueError("Project configuration must include a 'slug' field")

    skill_cfg_raw = config.get("skill_config", {})
    skill_cfg = SkillConfig(**skill_cfg_raw) if skill_cfg_raw else SkillConfig(skill_name=f"{slug}-board")
    proj_settings_raw = config.get("project_settings")
    proj_settings = (
        ProjectSettings(**normalize_project_settings(proj_settings_raw))
        if isinstance(proj_settings_raw, dict)
        else None
    )

    existing_proj = db.get_project(slug)
    if not existing_proj:
        db.create_project(
            ProjectCreate(
                slug=slug,
                name=config.get("name", slug.capitalize()),
                description=config.get("description", f"Board for {slug}"),
                repo_path=config.get("repo_path", ""),
                worktrees_dir=config.get("worktrees_dir", ""),
                board_background_md=config.get("board_background_md", ""),
                skill_config=skill_cfg,
                project_settings=proj_settings,
            )
        )
    else:
        db.update_project(
            slug,
            ProjectUpdate(
                name=config.get("name", existing_proj["name"]),
                description=config.get("description", existing_proj["description"]),
                repo_path=config.get("repo_path", existing_proj.get("repo_path", "")),
                worktrees_dir=config.get("worktrees_dir", existing_proj.get("worktrees_dir", "")),
                board_background_md=config.get("board_background_md", existing_proj.get("board_background_md", "")),
                skill_config=skill_cfg,
                project_settings=proj_settings,
            ),
        )

    sections_imported = 0
    for s in config.get("sections", []):
        db.upsert_section(
            slug,
            SectionCreate(
                code=s["code"],
                title=s["title"],
                description_md=s.get("description_md", ""),
                position=s.get("position", sections_imported),
            ),
        )
        sections_imported += 1

    locks_imported = 0
    for l in config.get("locks", []):
        db.upsert_lock(
            LockCreate(
                name=l["name"],
                project_slug=slug,
                max_slots=l.get("max_slots", 1),
                description=l.get("description", f"Lock {l['name']}"),
            )
        )
        locks_imported += 1

    messages_imported = 0
    for sm in config.get("seed_messages", []):
        db.post_message(
            slug,
            MessageCreate(
                author=sm.get("author", "system"),
                channel=sm.get("channel", "general"),
                title=sm.get("title", ""),
                body_md=sm.get("body_md", ""),
                ticket_code=sm.get("ticket_code") or "",
                pinned=sm.get("pinned", False),
            ),
        )
        messages_imported += 1

    docs_import_dir = config.get("docs_import_dir")
    tickets_imported = 0
    if docs_import_dir:
        docs_p = Path(docs_import_dir)
        if not docs_p.is_absolute():
            docs_p = Path(__file__).resolve().parent.parent.parent / docs_import_dir
        if docs_p.exists():
            res = import_current_state_into_db(db, docs_p, project_slug=slug, preset=config)
            tickets_imported = res.get("tickets_imported", 0)

    return {
        "slug": slug,
        "name": config.get("name", slug),
        "sections_imported": sections_imported,
        "locks_imported": locks_imported,
        "messages_imported": messages_imported,
        "tickets_imported": tickets_imported,
    }


def export_project_config(db: Database, project_slug: str) -> dict[str, Any]:
    proj = db.get_project(project_slug)
    if not proj:
        raise ValueError(f"Project '{project_slug}' not found")

    sections = db.list_sections(project_slug)
    locks = db.list_locks(project_slug=project_slug)
    messages = db.list_messages(project_slug=project_slug, limit=50)

    return {
        "slug": proj["slug"],
        "name": proj["name"],
        "description": proj["description"],
        "repo_path": proj.get("repo_path", ""),
        "worktrees_dir": proj.get("worktrees_dir", ""),
        "board_background_md": proj.get("board_background_md", ""),
        "skill_config": proj.get("skill_config", {}),
        "project_settings": proj.get("project_settings", {}),
        "sections": [
            {
                "code": s["code"],
                "title": s["title"],
                "description_md": s["description_md"],
                "position": s["position"],
            }
            for s in sections
        ],
        "locks": [
            {
                "name": l["name"],
                "max_slots": l["max_slots"],
                "description": l["description"],
            }
            for l in locks
        ],
        "seed_messages": [
            {
                "author": m["author"],
                "channel": m["channel"],
                "title": m["title"],
                "body_md": m["body_md"],
                "ticket_code": m.get("ticket_code") or "",
                "pinned": bool(m["pinned"]),
            }
            for m in messages
            if m.get("pinned") or m["channel"] in ("general", "gbs", "benchmark-baselines")
        ],
    }
