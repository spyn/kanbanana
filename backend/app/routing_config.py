from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Optional

from .models import (
    AgentLaneRule,
    GlobalSettings,
    LaneConfig,
    ManagedSkillSpec,
    ProjectSettings,
)

CONFIGURABLE_LANES: tuple[str, ...] = (
    "triage",
    "todo",
    "in-progress",
    "review",
    "blocked",
)

PROVIDER_ALIASES: dict[str, tuple[str, ...]] = {
    "antigravity": ("antigravity", "agy", "gemini"),
    "claude": ("claude", "claude-code", "anthropic"),
    "grok": ("grok", "grok-cli", "xai"),
    "codex": ("codex", "codex-cli", "openai"),
    "kimi": ("kimi", "kimi-code", "moonshot"),
    "minimax": ("minimax", "minimax-code"),
    "cursor": ("cursor", "cursor-agent"),
    "opencode": ("opencode",),
}


def canonical_provider_for_agent(agent_ref: str, provider_hint: str = "") -> str:
    """Maps an agent ID or profile ID (e.g. 'claude-code', 'grok-reviewer') to a canonical provider key."""
    hint = (provider_hint or "").strip().lower()
    if hint in PROVIDER_ALIASES:
        return hint
    cleaned = (agent_ref or "").strip().lower()
    if not cleaned:
        return ""
    for prov, aliases in PROVIDER_ALIASES.items():
        for alias in aliases:
            if cleaned == alias or cleaned.startswith(f"{alias}-") or cleaned.startswith(f"{alias}_"):
                return prov
    return cleaned


def agents_match_identity(agent_a: str, agent_b: str, profiles: Optional[list[dict[str, Any]]] = None) -> bool:
    """Checks whether two agent identifiers refer to the same underlying agent/provider (for self-review guard)."""
    a = (agent_a or "").strip().lower()
    b = (agent_b or "").strip().lower()
    if not a or not b or a in ("—", "none", "unassigned", "user"):
        return False
    if a == b:
        return True

    prof_map: dict[str, dict[str, Any]] = {}
    for p in profiles or []:
        pid = str(p.get("id") or "").lower()
        if pid:
            prof_map[pid] = p

    prov_a = canonical_provider_for_agent(a, str((prof_map.get(a) or {}).get("provider") or ""))
    prov_b = canonical_provider_for_agent(b, str((prof_map.get(b) or {}).get("provider") or ""))
    return bool(prov_a and prov_b and prov_a == prov_b)


def build_default_managed_skills() -> list[ManagedSkillSpec]:
    """Built-in editable role skills served via Kanbanana MCP & HTTP."""
    return [
        ManagedSkillSpec(
            id="business-analysis",
            name="Business Analysis & Story Breakdown",
            description=(
                "Analyze raw feature ideas or epics in `triage`, clarify ambiguities, map affected modules, "
                "and decompose work into atomic, dependency-ordered sub-stories (`todo` proposals)."
            ),
            lane_tags=["triage"],
            built_in=True,
            content_md=(
                "---\n"
                "name: business-analysis\n"
                "description: Analyze triage ideas and break epics into small, dependency-ordered sub-stories.\n"
                "---\n\n"
                "# Business Analysis & Story Breakdown Skill (`triage`)\n\n"
                "1. **Context & Prior Art**: Call `get_project_onboarding` and `search_board` before proposing work so duplicate or previously rejected ideas are caught early.\n"
                "2. **Clarify Ambiguities**: If core acceptance criteria or product trade-offs are unclear, call `ask_triage_questions` to surface crisp options to the human operator.\n"
                "3. **Vertical Story Slicing**: Break large epics into 2–6 small, independently testable stories with:\n"
                "   - Explicit `code`, `title`, and `section_code`\n"
                "   - Minimal file blast radius in `files_md` (to avoid multi-agent merge conflicts)\n"
                "   - Concrete implementation steps in `do_md` and measurable acceptance checks in `done_when_md`\n"
                "   - Explicit `depends_on` ordering where foundational schema/API work precedes UI/integration stories\n"
                "4. **Submit Structured Breakdown**: Call `submit_triage_research_findings(..., recommendation='propose-todos', proposals=[...])` honoring the lane's `auto_promote` policy.\n"
            ),
        ),
        ManagedSkillSpec(
            id="triage-research-scan",
            name="Technical Spike & Architecture Scan",
            description=(
                "Evaluate technical feasibility, performance trade-offs, external references, and file overlap risks "
                "during `triage` investigations."
            ),
            lane_tags=["triage"],
            built_in=True,
            content_md=(
                "---\n"
                "name: triage-research-scan\n"
                "description: Perform technical feasibility spikes and codebase architecture scans on triage items.\n"
                "---\n\n"
                "# Technical Spike & Architecture Scan (`triage`)\n\n"
                "1. Inspect affected modules, data models, and existing tests before estimating scope.\n"
                "2. Check `check_file_conflicts` against active `in-progress` worktrees.\n"
                "3. Record concrete architectural trade-offs, performance impact, and risk notes via `submit_triage_research_findings`.\n"
            ),
        ),
        ManagedSkillSpec(
            id="implementation-worker",
            name="Isolated Worktree Implementation",
            description=(
                "Execute scoped software engineering tasks inside an isolated git worktree (`board/<code>`), "
                "respecting FIFO resource locks and running verification suites before moving to `review`."
            ),
            lane_tags=["todo", "in-progress"],
            built_in=True,
            content_md=(
                "---\n"
                "name: implementation-worker\n"
                "description: Implement scoped board tickets cleanly inside an isolated git worktree.\n"
                "---\n\n"
                "# Isolated Worktree Implementation (`todo` / `in-progress`)\n\n"
                "1. Always work inside the ticket's dedicated git worktree (`board/<code>`); never commit directly to `main`.\n"
                "2. Check `check_file_conflicts` and acquire any required shared environment/GPU locks via `acquire_lock` before running exclusive suites.\n"
                "3. Implement the specification in `do_md`, satisfy every check in `done_when_md`, run the project verification command, commit cleanly, and call `update_ticket_progress(..., status='review', release_locks=True)`.\n"
            ),
        ),
        ManagedSkillSpec(
            id="qa-verification",
            name="QA & Acceptance Criteria Verification",
            description=(
                "Verify every `done_when_md` requirement, run unit/build checks, test boundary conditions, "
                "and catch regressions on `review` tickets."
            ),
            lane_tags=["review"],
            built_in=True,
            content_md=(
                "---\n"
                "name: qa-verification\n"
                "description: Run QA, acceptance criteria checks, and regression verification on review tickets.\n"
                "---\n\n"
                "# QA & Acceptance Criteria Verification (`review`)\n\n"
                "1. Compare every bullet in the ticket's `done_when_md` against the actual git diff in `inspect_review_ticket`.\n"
                "2. Execute the project's test/typecheck/build verification commands in the ticket worktree.\n"
                "3. Check edge cases, null/empty states, error handling, and backwards compatibility; report any gap in `code_issues`.\n"
            ),
        ),
        ManagedSkillSpec(
            id="security-code-review",
            name="Security & Exactness Code Audit",
            description=(
                "Audit `review` diffs for injection, SSRF, auth bypass, path traversal, race conditions, "
                "and exactness invariants; gate merge on zero issues."
            ),
            lane_tags=["review"],
            built_in=True,
            content_md=(
                "---\n"
                "name: security-code-review\n"
                "description: Security and exactness audit gate for review tickets.\n"
                "---\n\n"
                "# Security & Exactness Code Audit (`review`)\n\n"
                "1. Call `inspect_review_ticket` to inspect the full branch diff and static pre-scan warnings.\n"
                "2. Audit for command/shell injection, path traversal, SSRF, missing auth checks, secret leakage, SQLite transaction races, and resource leaks.\n"
                "3. Submit `review_ticket` with `verdict='approve'` ONLY when both `code_issues` and `security_issues` are empty (`0` issues).\n"
            ),
        ),
        ManagedSkillSpec(
            id="root-cause-unblocker",
            name="Blocked Ticket Root-Cause Diagnostics",
            description=(
                "Diagnose failing tests, dependency deadlocks, or ambiguous specs on `blocked` tickets "
                "and produce a concrete unblocking fix or escalation note."
            ),
            lane_tags=["blocked"],
            built_in=True,
            content_md=(
                "---\n"
                "name: root-cause-unblocker\n"
                "description: Diagnose blocked tickets, reproduce root causes, and unblock execution.\n"
                "---\n\n"
                "# Blocked Ticket Root-Cause Diagnostics (`blocked`)\n\n"
                "1. Read `blocked_reason` and recent `ticket_notes` via `get_ticket`.\n"
                "2. Reproduce the build/test failure or dependency conflict inside the ticket worktree.\n"
                "3. Apply a minimal fix (moving back to `in-progress`/`review`) or post a crisp root-cause options note on the ticket.\n"
            ),
        ),
    ]


def build_default_lane_configs() -> dict[str, LaneConfig]:
    """Sensible out-of-the-box Global Agent × Lane defaults."""
    return {
        "triage": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="claude-code",
            fallback_agent="antigravity",
            prevent_self_review=False,
            triage_breakdown_policy="stage-for-approval",
            review_merge_policy="auto-merge-clean",
            default_skills=["business-analysis"],
            agent_rules={
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-sonnet-4-6",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                    custom_instructions="Decompose epics into small, dependency-ordered sub-stories with minimal file overlap.",
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.1-pro",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                ),
            },
        ),
        "todo": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="antigravity",
            fallback_agent="claude-code",
            prevent_self_review=False,
            default_skills=["implementation-worker"],
            agent_rules={
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.1-pro",
                    effort="high",
                    skills=["implementation-worker"],
                ),
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-opus-4-6",
                    effort="high",
                    skills=["implementation-worker"],
                ),
                "codex-cli": AgentLaneRule(
                    agent_key="codex-cli",
                    agent_label="OpenAI Codex CLI",
                    model="gpt-5.2-codex",
                    effort="high",
                    skills=["implementation-worker"],
                ),
            },
        ),
        "in-progress": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="antigravity",
            fallback_agent="claude-code",
            prevent_self_review=False,
            default_skills=["implementation-worker"],
            agent_rules={
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.1-pro",
                    effort="high",
                    skills=["implementation-worker"],
                ),
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-sonnet-4-6",
                    effort="high",
                    skills=["implementation-worker"],
                ),
            },
        ),
        "review": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="grok-cli",
            fallback_agent="claude-code",
            prevent_self_review=True,
            review_merge_policy="auto-merge-clean",
            default_skills=["qa-verification", "security-code-review"],
            agent_rules={
                "grok-cli": AgentLaneRule(
                    agent_key="grok-cli",
                    agent_label="Grok CLI",
                    model="grok-4-reasoning",
                    effort="high",
                    skills=["qa-verification", "security-code-review"],
                    custom_instructions="Run QA acceptance checks and strict security audit; approve & merge only when 0 issues remain.",
                ),
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-sonnet-4-6",
                    effort="medium",
                    skills=["qa-verification", "security-code-review"],
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.8-flash",
                    effort="medium",
                    skills=["qa-verification", "security-code-review"],
                ),
            },
        ),
        "blocked": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="claude-code",
            fallback_agent="kimi-code",
            prevent_self_review=False,
            default_skills=["root-cause-unblocker"],
            agent_rules={
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-opus-4-6",
                    effort="high",
                    skills=["root-cause-unblocker"],
                ),
                "kimi-code": AgentLaneRule(
                    agent_key="kimi-code",
                    agent_label="Kimi Code",
                    model="kimi-k2.5-thinking",
                    effort="high",
                    skills=["root-cause-unblocker"],
                ),
            },
        ),
    }


def build_default_global_settings() -> GlobalSettings:
    return GlobalSettings(
        managed_skills=build_default_managed_skills(),
        lane_configs=build_default_lane_configs(),
    )


def normalize_global_settings(raw: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Ensures all built-in lanes and built-in skills exist even on older/partial JSON payloads."""
    defaults = build_default_global_settings()
    if not raw:
        return defaults.model_dump()

    merged_data = {**defaults.model_dump(), **raw}
    # Ensure every configurable lane exists
    raw_lanes = raw.get("lane_configs") or {}
    lane_map: dict[str, Any] = {}
    for lane, def_cfg in defaults.lane_configs.items():
        if lane in raw_lanes and isinstance(raw_lanes[lane], dict):
            lane_map[lane] = LaneConfig(**{**def_cfg.model_dump(), **raw_lanes[lane]}).model_dump()
        else:
            lane_map[lane] = def_cfg.model_dump()
    merged_data["lane_configs"] = lane_map

    # Ensure built-in skills exist (preserving user edits to built-in skills if present)
    raw_skills = raw.get("managed_skills")
    if isinstance(raw_skills, list) and len(raw_skills) > 0:
        by_id: dict[str, dict[str, Any]] = {}
        for sk in defaults.managed_skills:
            by_id[sk.id] = sk.model_dump()
        ordered_ids: list[str] = [sk.id for sk in defaults.managed_skills]
        for item in raw_skills:
            if isinstance(item, dict) and item.get("id"):
                sid = str(item["id"]).strip()
                by_id[sid] = ManagedSkillSpec(**{**(by_id.get(sid) or {}), **item}).model_dump()
                if sid not in ordered_ids:
                    ordered_ids.append(sid)
        merged_data["managed_skills"] = [by_id[sid] for sid in ordered_ids if sid in by_id]
    else:
        merged_data["managed_skills"] = [sk.model_dump() for sk in defaults.managed_skills]

    return GlobalSettings(**merged_data).model_dump()


def normalize_project_settings(raw: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Normalizes a project's `project_settings` JSON with safe defaults for all 5 lanes."""
    base = ProjectSettings().model_dump()
    if not raw:
        raw = {}
    merged = {**base, **raw}
    raw_lanes = raw.get("lane_configs") or {}
    lane_map: dict[str, Any] = {}
    for lane in CONFIGURABLE_LANES:
        if lane in raw_lanes and isinstance(raw_lanes[lane], dict):
            lane_map[lane] = LaneConfig(**raw_lanes[lane]).model_dump()
        else:
            lane_map[lane] = LaneConfig(inherit_global=True).model_dump()
    merged["lane_configs"] = lane_map
    return ProjectSettings(**merged).model_dump()


def parse_skill_frontmatter(md_text: str, fallback_id: str) -> tuple[str, str]:
    """Extracts YAML frontmatter `name` and `description` from a `SKILL.md` file."""
    name = fallback_id
    desc = ""
    stripped = (md_text or "").lstrip()
    if stripped.startswith("---"):
        parts = stripped.split("---", 2)
        if len(parts) >= 3:
            fm = parts[1]
            for line in fm.splitlines():
                m_name = re.match(r"^\s*name\s*:\s*(.+)$", line)
                if m_name:
                    name = m_name.group(1).strip().strip("'\"")
                m_desc = re.match(r"^\s*description\s*:\s*(.+)$", line)
                if m_desc:
                    desc = m_desc.group(1).strip().strip("'\"")
    if not desc:
        for line in stripped.splitlines():
            s = line.strip()
            if s and not s.startswith(("---", "#")):
                desc = s[:200]
                break
    return name or fallback_id, desc


def _scan_skills_in_directory(
    skills_root: Path,
    source_label: str,
    agent_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if not skills_root.exists() or not skills_root.is_dir():
        return found
    try:
        for child in sorted(skills_root.iterdir()):
            if not child.is_dir():
                continue
            skill_file = child / "SKILL.md"
            if not skill_file.exists() or not skill_file.is_file():
                continue
            try:
                raw_md = skill_file.read_text(encoding="utf-8", errors="replace")[:16384]
            except OSError:
                continue
            sid = child.name.strip()
            sname, sdesc = parse_skill_frontmatter(raw_md, sid)
            found.append(
                {
                    "id": sid,
                    "name": sname,
                    "description": sdesc or f"Discovered skill in {skills_root}",
                    "source": source_label,
                    "lane_tags": [],
                    "uri": str(skill_file),
                    "editable": False,
                    "built_in": False,
                    "installed_on_agents": [agent_id] if agent_id else [],
                    "content_md": raw_md,
                }
            )
    except OSError:
        pass
    return found


def discover_unified_skills(
    global_settings: dict[str, Any],
    project: Optional[dict[str, Any]] = None,
    profiles: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """
    Builds a deduplicated Unified Skill Catalog combining:
    1. Kanbanana Global Managed Skills (built-in role skills + global custom skills)
    2. Project-scoped Custom Skills + Project Board / Code Review generated skills
    3. Repository `.agents/skills/*/SKILL.md` and `.claude/skills/*/SKILL.md`
    4. Discovered Agent Profile `skills/` directories on host or Docker mounts
    5. A2A Agent Card advertised skills
    """
    catalog_by_id: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    def register_item(item: dict[str, Any]) -> None:
        sid = str(item.get("id") or "").strip()
        if not sid:
            return
        if sid not in catalog_by_id:
            catalog_by_id[sid] = item
            order.append(sid)
        else:
            existing = catalog_by_id[sid]
            existing_agents = list(existing.get("installed_on_agents") or [])
            for ag in item.get("installed_on_agents") or []:
                if ag and ag not in existing_agents:
                    existing_agents.append(ag)
            existing["installed_on_agents"] = existing_agents

    norm_global = normalize_global_settings(global_settings)
    for sk in norm_global.get("managed_skills") or []:
        sid = sk["id"]
        register_item(
            {
                "id": sid,
                "name": sk.get("name") or sid,
                "description": sk.get("description") or "",
                "source": "built-in" if sk.get("built_in") else "global-custom",
                "lane_tags": list(sk.get("lane_tags") or []),
                "uri": f"skill://global/{sid}/SKILL.md",
                "http_url": f"/api/skills/{sid}/SKILL.md",
                "editable": True,
                "built_in": bool(sk.get("built_in")),
                "installed_on_agents": [],
                "content_md": sk.get("content_md") or "",
            }
        )

    if project:
        slug = project["slug"]
        raw_skill_cfg = project.get("skill_config") or {}
        board_skill_id = raw_skill_cfg.get("skill_name") or f"{slug}-board"
        register_item(
            {
                "id": board_skill_id,
                "name": f"{project['name']} Board Skill",
                "description": raw_skill_cfg.get("description")
                or f"Generated project board onboarding & workflow skill for {slug}.",
                "source": "project-generated",
                "lane_tags": ["triage", "todo", "in-progress", "blocked"],
                "uri": f"skill://{slug}/SKILL.md",
                "http_url": f"/api/projects/{slug}/skill.md",
                "editable": False,
                "built_in": True,
                "installed_on_agents": [],
                "content_md": "",
            }
        )
        review_skill_id = f"{slug}-code-review"
        register_item(
            {
                "id": review_skill_id,
                "name": f"{project['name']} Code Review Gate",
                "description": f"Generated review & security merge gate skill for {slug}.",
                "source": "project-generated",
                "lane_tags": ["review"],
                "uri": f"skill://{slug}/CODE_REVIEW_SKILL.md",
                "http_url": f"/api/projects/{slug}/code-review-skill.md",
                "editable": False,
                "built_in": True,
                "installed_on_agents": [],
                "content_md": "",
            }
        )

        proj_settings = normalize_project_settings(project.get("project_settings"))
        for csk in proj_settings.get("custom_skills") or []:
            csid = csk["id"]
            catalog_by_id[csid] = {
                "id": csid,
                "name": csk.get("name") or csid,
                "description": csk.get("description") or "",
                "source": "project-custom",
                "lane_tags": list(csk.get("lane_tags") or []),
                "uri": f"skill://{slug}/skills/{csid}/SKILL.md",
                "http_url": f"/api/projects/{slug}/skills/{csid}/SKILL.md",
                "editable": True,
                "built_in": False,
                "installed_on_agents": [],
                "content_md": csk.get("content_md") or "",
            }
            if csid not in order:
                order.append(csid)

        # Scan repository `.agents/skills` and `.claude/skills` if present
        repo_candidates: list[Path] = []
        raw_repo = (project.get("repo_path") or "").strip()
        if raw_repo:
            repo_candidates.append(Path(os.path.expandvars(os.path.expanduser(raw_repo))))
        env_ws = os.environ.get("KANBANANA_WORKSPACE_DIR", "").strip()
        if env_ws:
            repo_candidates.append(Path(env_ws))

        seen_repo_dirs: set[str] = set()
        for rc in repo_candidates:
            if not rc.exists() or not rc.is_dir():
                continue
            norm_rc = str(rc.resolve()).lower()
            if norm_rc in seen_repo_dirs:
                continue
            seen_repo_dirs.add(norm_rc)
            for rel_sdir in (".agents/skills", ".claude/skills"):
                for item in _scan_skills_in_directory(rc / rel_sdir, "repo"):
                    register_item(item)

    # Scan discovered agent profile directories + A2A cards
    for prof in profiles or []:
        pid = str(prof.get("id") or "")
        cfg_path_str = str(prof.get("config_path") or "").strip()
        if cfg_path_str and not cfg_path_str.startswith(("http://", "https://")):
            cfg_dir = Path(os.path.expandvars(os.path.expanduser(cfg_path_str)))
            if cfg_dir.exists() and cfg_dir.is_dir():
                for sdir_rel in ("skills", "config/skills", "builtin/skills"):
                    for item in _scan_skills_in_directory(cfg_dir / sdir_rel, "agent-config", agent_id=pid):
                        register_item(item)

        card = prof.get("a2a_card") or {}
        for cskill in card.get("skills") or []:
            if not isinstance(cskill, dict):
                continue
            cs_id = str(cskill.get("id") or "").strip()
            if not cs_id:
                continue
            register_item(
                {
                    "id": cs_id,
                    "name": str(cskill.get("name") or cs_id),
                    "description": str(cskill.get("description") or ""),
                    "source": "a2a-card",
                    "lane_tags": list(cskill.get("tags") or []),
                    "uri": f"a2a://{pid}/skills/{cs_id}",
                    "editable": False,
                    "built_in": False,
                    "installed_on_agents": [pid] if pid else [],
                    "content_md": "",
                }
            )

    return [catalog_by_id[sid] for sid in order if sid in catalog_by_id]


def resolve_effective_project_lanes(
    global_settings: Optional[dict[str, Any]],
    project_settings: Optional[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    Merges Global baseline `lane_configs` with Project-level `lane_configs` overrides.
    Each returned lane dict includes `inherited_from` metadata per lane and per agent rule.
    """
    g_norm = normalize_global_settings(global_settings)
    p_norm = normalize_project_settings(project_settings)

    effective: dict[str, dict[str, Any]] = {}
    for lane in CONFIGURABLE_LANES:
        g_lane = g_norm["lane_configs"].get(lane) or LaneConfig().model_dump()
        p_lane = p_norm["lane_configs"].get(lane) or LaneConfig(inherit_global=True).model_dump()
        inherit_global = bool(p_lane.get("inherit_global", True))

        merged_rules: dict[str, dict[str, Any]] = {}
        for akey, arule in (g_lane.get("agent_rules") or {}).items():
            merged_rules[akey] = {
                **arule,
                "source": "global",
            }

        for akey, prule in (p_lane.get("agent_rules") or {}).items():
            merged_rules[akey] = {
                **prule,
                "source": "project",
            }

        if inherit_global:
            effective[lane] = {
                **g_lane,
                "inherit_global": True,
                "lane_source": "global",
                "agent_rules": merged_rules,
            }
        else:
            effective[lane] = {
                **p_lane,
                "inherit_global": False,
                "lane_source": "project",
                "agent_rules": merged_rules,
            }

    return effective


def _find_matching_agent_rule(
    agent_rules: dict[str, dict[str, Any]],
    agent_id: str,
    profile: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Matches an agent rule by exact profile_id, exact agent_id, or canonical provider."""
    candidates: list[str] = []
    if profile and profile.get("id"):
        candidates.append(str(profile["id"]).strip())
    if agent_id:
        candidates.append(agent_id.strip())
    if profile and profile.get("provider"):
        candidates.append(str(profile["provider"]).strip())

    canon = canonical_provider_for_agent(
        agent_id or str((profile or {}).get("id") or ""),
        str((profile or {}).get("provider") or ""),
    )
    if canon:
        candidates.append(canon)

    lower_map = {k.lower(): v for k, v in agent_rules.items()}
    # 1. Direct key match
    for cand in candidates:
        if not cand:
            continue
        hit = lower_map.get(cand.lower())
        if hit and hit.get("enabled", True):
            return hit

    # 2. Canonical provider match against rule keys
    if canon:
        for rkey, rval in agent_rules.items():
            if not rval.get("enabled", True):
                continue
            if canonical_provider_for_agent(rkey) == canon:
                return rval
    return None


def resolve_agent_lane_plan(
    global_settings: Optional[dict[str, Any]],
    project: Optional[dict[str, Any]],
    lane: str,
    agent_id: str = "",
    profile: Optional[dict[str, Any]] = None,
    profiles: Optional[list[dict[str, Any]]] = None,
    ticket_owner: Optional[str] = None,
    explicit_model: Optional[str] = None,
    explicit_effort: Optional[str] = None,
    explicit_skills: Optional[list[str]] = None,
) -> dict[str, Any]:
    """
    Computes the concrete execution plan (agent, model, effort, skills, policies, self-review check)
    when `agent_id` picks up or is auto-dispatched on a ticket in `lane`.
    """
    g_norm = normalize_global_settings(global_settings)
    p_norm = normalize_project_settings((project or {}).get("project_settings"))
    effective_lanes = resolve_effective_project_lanes(g_norm, p_norm)

    norm_lane = lane if lane in CONFIGURABLE_LANES else "todo"
    lane_cfg = effective_lanes.get(norm_lane) or LaneConfig().model_dump()

    target_agent = (agent_id or "").strip() or str((profile or {}).get("id") or "")
    if not target_agent:
        target_agent = str(lane_cfg.get("preferred_agent") or "")

    self_review_prevented = False
    original_blocked_agent: Optional[str] = None
    if (
        norm_lane == "review"
        and bool(lane_cfg.get("prevent_self_review", True))
        and ticket_owner
        and target_agent
        and agents_match_identity(target_agent, ticket_owner, profiles=profiles)
    ):
        self_review_prevented = True
        original_blocked_agent = target_agent
        fallback_ag = str(lane_cfg.get("fallback_agent") or "").strip()
        if fallback_ag and not agents_match_identity(fallback_ag, ticket_owner, profiles=profiles):
            target_agent = fallback_ag
            if profiles:
                profile = next(
                    (
                        p
                        for p in profiles
                        if p["id"] == fallback_ag
                        or canonical_provider_for_agent(p["id"], p.get("provider", ""))
                        == canonical_provider_for_agent(fallback_ag)
                    ),
                    None,
                )
        else:
            target_agent = ""
            profile = None

    if profile is None and target_agent and profiles:
        profile = next(
            (
                p
                for p in profiles
                if p["id"] == target_agent
                or p.get("provider") == target_agent
                or canonical_provider_for_agent(p["id"], p.get("provider", ""))
                == canonical_provider_for_agent(target_agent)
            ),
            None,
        )

    matched_rule = _find_matching_agent_rule(
        lane_cfg.get("agent_rules") or {},
        target_agent,
        profile=profile,
    )

    chosen_model = (explicit_model or "").strip()
    if not chosen_model and matched_rule:
        chosen_model = str(matched_rule.get("model") or "").strip()
    if not chosen_model and profile:
        chosen_model = str(profile.get("default_model") or "").strip()

    chosen_effort = (explicit_effort or "").strip()
    if not chosen_effort and matched_rule:
        chosen_effort = str(matched_rule.get("effort") or "").strip()
    if not chosen_effort and profile and profile.get("supports_effort"):
        chosen_effort = str(profile.get("default_effort") or "").strip()

    if explicit_skills is not None:
        skill_ids = [s.strip() for s in explicit_skills if s and s.strip()]
    elif matched_rule and matched_rule.get("skills"):
        skill_ids = list(matched_rule.get("skills") or [])
    else:
        skill_ids = list(lane_cfg.get("default_skills") or [])

    unified_catalog = discover_unified_skills(g_norm, project=project, profiles=profiles)
    catalog_map = {item["id"]: item for item in unified_catalog}

    resolved_skills: list[dict[str, Any]] = []
    for sid in skill_ids:
        if sid in catalog_map:
            sk_obj = catalog_map[sid]
            resolved_skills.append(
                {
                    "id": sk_obj["id"],
                    "name": sk_obj["name"],
                    "description": sk_obj["description"],
                    "source": sk_obj["source"],
                    "uri": sk_obj["uri"],
                    "content_md": sk_obj.get("content_md") or "",
                }
            )
        else:
            resolved_skills.append(
                {
                    "id": sid,
                    "name": sid,
                    "description": "Assigned lane skill",
                    "source": "custom-ref",
                    "uri": f"skill://global/{sid}/SKILL.md",
                    "content_md": "",
                }
            )

    auto_wt = p_norm.get("auto_create_worktree")
    if auto_wt is None:
        auto_wt = bool(g_norm.get("default_auto_create_worktree", True))

    disp_a2a = p_norm.get("dispatch_via_a2a")
    if disp_a2a is None:
        disp_a2a = bool(g_norm.get("default_dispatch_via_a2a", True))

    token_ceiling = p_norm.get("token_ceiling_override") or int(
        g_norm.get("default_token_ceiling", 1_200_000)
    )

    return {
        "lane": norm_lane,
        "lane_source": lane_cfg.get("lane_source", "global"),
        "rule_matched": bool(matched_rule),
        "rule_source": (matched_rule or {}).get("source") if matched_rule else None,
        "agent_id": target_agent,
        "profile_id": (profile or {}).get("id") or (target_agent or None),
        "agent_name": (profile or {}).get("name") or (matched_rule or {}).get("agent_label") or target_agent,
        "model": chosen_model,
        "effort": chosen_effort,
        "skill_ids": skill_ids,
        "skills": resolved_skills,
        "custom_instructions": str((matched_rule or {}).get("custom_instructions") or "").strip(),
        "auto_dispatch": bool(lane_cfg.get("auto_dispatch", False)),
        "preferred_agent": str(lane_cfg.get("preferred_agent") or ""),
        "fallback_agent": str(lane_cfg.get("fallback_agent") or ""),
        "prevent_self_review": bool(lane_cfg.get("prevent_self_review", True)),
        "self_review_prevented": self_review_prevented,
        "blocked_self_review_agent": original_blocked_agent,
        "triage_breakdown_policy": lane_cfg.get("triage_breakdown_policy", "stage-for-approval"),
        "review_merge_policy": lane_cfg.get("review_merge_policy", "auto-merge-clean"),
        "branch_prefix": p_norm.get("branch_prefix") or "board/",
        "require_verification_cmd": p_norm.get("require_verification_cmd") or "",
        "auto_create_worktree": bool(auto_wt),
        "dispatch_via_a2a": bool(disp_a2a),
        "launch_subprocess": bool(g_norm.get("default_launch_subprocess", False)),
        "effective_token_ceiling": token_ceiling,
        "mcp_url": g_norm.get("mcp_url") or "http://localhost:8765/mcp",
    }
