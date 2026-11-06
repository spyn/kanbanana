from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

import httpx

from .models import (
    AgentLaneRule,
    AutoRunnerConfig,
    GiteaWebhookConfig,
    GlobalSettings,
    LaneConfig,
    ManagedSkillSpec,
    ProjectSettings,
    SystemOneConfig,
    WatchdogConfig,
)

logger = logging.getLogger("kanbanana.systemone")

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
    """Built-in editable Orchestrator -> Worker -> Cross-Vendor Review -> Escalation role skills."""
    return [
        ManagedSkillSpec(
            id="business-analysis",
            name="Orchestrator Architecture & Worker-Ready Breakdown",
            description=(
                "Frontier orchestrator skill for `triage`: resolve architectural trade-offs, avoid over-decomposition, "
                "and emit crystal-clear, bounded `todo` specifications sized for mid-range or local worker models."
            ),
            lane_tags=["triage"],
            built_in=True,
            content_md=(
                "---\n"
                "name: business-analysis\n"
                "description: Frontier orchestrator skill that decomposes triage items into unambiguous, bounded specs for mid-range worker models.\n"
                "recommended_model_tier: frontier (claude-opus-5-5 | grok-4.7 | gemini-3.1-pro | gpt-5.2-codex | kimi-k3)\n"
                "---\n\n"
                "# Orchestrator Architecture & Worker-Ready Story Breakdown (`triage`)\n\n"
                "You are the **Frontier Orchestrator / Architect**. Downstream `todo` tickets will be executed by **mid-range or local worker models** (`claude-sonnet-5-5`, `gemini-3.8-flash`, `kimi-k2.6`, `grok-code-fast-1`, `o4-mini`, `qwen3-coder-30b-a3b`). Planning errors cascade; ambiguous delegation causes cheap workers to guess wrong and burn tokens twice.\n\n"
                "## 1. Context, Prior Art & Clarifying Questions\n"
                "1. Call `get_project_onboarding` and `search_board` first to catch duplicate tickets or ideas already logged in *Measured & Rejected*.\n"
                "2. Offload high-volume file search/navigation to cheap/fast subagents (`haiku` / `flash_lite`, <100K prompt tokens) if available; keep architectural synthesis in your main context.\n"
                "3. **Zero Unresolved Trade-Offs**: Never hand an open product or architectural question to a worker. If requirements are ambiguous, call `ask_triage_questions` (`triage_state='needs-info'`) so the human operator decides before sub-tickets are created.\n\n"
                "## 2. Anti-Over-Decomposition Rule (Right-Sizing)\n"
                "- **More subtasks ≠ higher accuracy**: Over-splitting simple changes multiplies context/orchestration overhead ~3.4× and hurts accuracy.\n"
                "- **1 Ticket Rule**: If the change fits cleanly in 1–2 files (< ~150 LOC) with one cohesive concern, propose **1 single well-specified `todo` ticket**.\n"
                "- **2–5 Ticket Split**: Split into multiple dependency-ordered `todo` stories ONLY when work spans distinct layers (e.g., DB/API contract first $\\rightarrow$ UI/consumer second) or enables parallel execution across **strictly disjoint file sets**.\n\n"
                "## 3. Mandatory Mid-Range Worker Specification Contract\n"
                "Every item in `proposals` MUST be self-contained so a mid-range coder can execute it without repo-wide exploration:\n"
                "1. **`files_md` (Exact File Blast Radius)**:\n"
                "   - List exact relative file paths to **Modify** / **Create**, plus 1–2 **Reference** files whose patterns/types the worker should mirror.\n"
                "   - Check `check_file_conflicts` so parallel unblocked stories never write to the same file.\n"
                "2. **`do_md` (Architect $\\rightarrow$ Editor Blueprint)**:\n"
                "   - **Exact Symbols & Signatures**: Name the exact functions, classes, endpoints, SQL columns, or React props to add/change, including parameter and return types.\n"
                "   - **Ordered Edit Plan**: Numbered step-by-step changes anchored to existing symbols/sections.\n"
                "   - **Pre-Decided Edge Cases & Invariants**: Explicitly state error codes, empty/null handling, lock rules, and backwards-compatibility constraints.\n"
                "   - **Explicit Out-of-Scope (`Do NOT Touch`)**: State what the worker must NOT refactor, rename, or add.\n"
                "3. **`done_when_md` (Deterministic Verification Gate)**:\n"
                "   - Exact runnable command(s) (`uv run pytest -k ...`, `tsc --noEmit`, `npm run build`, `cargo test ...`) and concrete input $\\rightarrow$ expected output assertions.\n"
                "4. **`depends_on` & `rationale_md`**:\n"
                "   - Explicit upstream ticket codes and a 1–2 sentence architectural rationale.\n\n"
                "## 4. Submit Structured Breakdown\n"
                "- Call `submit_triage_research_findings(..., recommendation='propose-todos', proposals=[...])` (or `'not-worth-it'` / `'attach-to-existing'` when new code shouldn't be built), honoring the lane's `auto_promote` policy.\n"
            ),
        ),
        ManagedSkillSpec(
            id="triage-research-scan",
            name="Orchestrator Technical Spike & Scope Gate",
            description=(
                "Evaluate architectural feasibility, know what NOT to build (`not-worth-it`), check concurrent file "
                "overlaps, and ground specifications in exact codebase types during `triage`."
            ),
            lane_tags=["triage"],
            built_in=True,
            content_md=(
                "---\n"
                "name: triage-research-scan\n"
                "description: Frontier technical feasibility spike, scope gate, and symbol mapping for triage items.\n"
                "recommended_model_tier: frontier\n"
                "---\n\n"
                "# Orchestrator Technical Spike & Scope Gate (`triage`)\n\n"
                "1. **Know What NOT to Build**: Verify whether the proposed idea actually solves a measured bottleneck or user need on this architecture. If ROI is negative or superseded, close with `submit_triage_research_findings(..., recommendation='not-worth-it')` so workers never waste tokens on it.\n"
                "2. **Cheap Navigation, Frontier Judgment**: Use targeted search (or `<100K` token fast navigator subagents) to locate exact file paths, struct/interface definitions, and existing test harnesses.\n"
                "3. **Conflict & Blast-Radius Check**: Call `check_file_conflicts` against active `in-progress` worktrees and record exact symbols, performance trade-offs, and invariants so downstream worker specs require zero guesswork.\n"
            ),
        ),
        ManagedSkillSpec(
            id="implementation-worker",
            name="Bounded-Scope Implementation & Escalation Worker",
            description=(
                "Mid-range / local worker skill (`todo` & `in-progress`): execute well-specified tasks at high/max care "
                "inside an isolated git worktree, and escalate to `blocked` instead of looping on deep failures."
            ),
            lane_tags=["todo", "in-progress"],
            built_in=True,
            content_md=(
                "---\n"
                "name: implementation-worker\n"
                "description: Execute bounded-scope tickets cleanly at high care and escalate rather than looping on hard failures.\n"
                "recommended_model_tier: mid-tier (claude-sonnet-5-5 | gemini-3.8-flash | kimi-k2.6 | grok-code-fast-1 | o4-mini | qwen3-coder-30b-a3b)\n"
                "---\n\n"
                "# Bounded-Scope Implementation & Escalation Worker (`todo` / `in-progress`)\n\n"
                "You are the **Bounded Execution Worker** executing an Orchestrator-authored specification with maximum precision and care.\n\n"
                "1. **Worktree & Lock Discipline**:\n"
                "   - Always work inside your ticket's dedicated git worktree (`board/<code>`); never commit directly to `main`.\n"
                "   - Check `check_file_conflicts` and acquire any required shared environment/GPU locks via `acquire_lock` before running exclusive suites.\n"
                "2. **Strict Scope Adherence (No Unrequested Refactoring)**:\n"
                "   - Read ONLY the target and reference files listed in `files_md` plus direct imports — do not dump half the repo into context.\n"
                "   - Implement the exact signatures, steps, and invariants in `do_md`, and obey all **Out-of-Scope / Do NOT Touch** boundaries.\n"
                "3. **Run Deterministic Verification**:\n"
                "   - Run every test, typecheck, and build command specified in `done_when_md`.\n"
                "   - When green, commit cleanly and call `update_ticket_progress(..., status='review', release_locks=True)` with commit SHA and measured test output.\n"
                "4. **2-Strike Anti-Loop Escalation Rule (`todo`/`in-progress` $\\rightarrow$ `blocked`)**:\n"
                "   - Writing code and tests is mid-tier work; diagnosing complex failing runs or architectural mismatches is orchestrator-tier work.\n"
                "   - If verification fails **twice** after targeted fixes, OR if `do_md` contradicts actual repository types/APIs, **STOP LOOPING IMMEDIATELY**.\n"
                "   - Commit your work-in-progress branch, release held locks, and call `update_ticket_progress(..., status='blocked', blocked_reason='Escalated to Frontier Diagnostician: <concise failure>', note_md='<exact command, traceback, and hypotheses tried>', release_locks=True)`.\n"
            ),
        ),
        ManagedSkillSpec(
            id="qa-verification",
            name="Cross-Vendor QA & Scope Verification",
            description=(
                "Adversarial cross-vendor QA on `review` tickets: verify every `done_when_md` check, catch same-family "
                "blind spots and scope creep outside `files_md`, and run regression suites."
            ),
            lane_tags=["review"],
            built_in=True,
            content_md=(
                "---\n"
                "name: qa-verification\n"
                "description: Adversarial cross-vendor QA, scope check, and acceptance criteria verification on review tickets.\n"
                "recommended_model_tier: mid-to-frontier cross-vendor (grok-4.7 | claude-sonnet-5-5 | gemini-3.8-flash | o4-mini | kimi-k2.6)\n"
                "---\n\n"
                "# Cross-Vendor QA & Acceptance Criteria Verification (`review`)\n\n"
                "1. **Adversarial Reading**: Assume the implementer model had blind spots. Compare every bullet in `do_md` and `done_when_md` against the actual git diff from `inspect_review_ticket`.\n"
                "2. **Blast-Radius & Scope Check**: Flag unrequested edits outside `files_md`, missing edge-case guards, or silently skipped requirements in `code_issues`.\n"
                "3. **Independent Verification**: Execute the project's test/typecheck/build commands inside the ticket worktree and verify zero regressions.\n"
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
            name="Frontier Failure-Diagnostician & Escalation Resolver",
            description=(
                "Orchestrator-tier diagnostics on `blocked` tickets: interpret why tests failed when a mid-tier worker "
                "escalated, fix the root cause or repair flawed specs, and unblock execution."
            ),
            lane_tags=["blocked"],
            built_in=True,
            content_md=(
                "---\n"
                "name: root-cause-unblocker\n"
                "description: Frontier failure-diagnostician skill for escalated blocked tickets.\n"
                "recommended_model_tier: frontier (claude-opus-5-5 | grok-4.7 | gemini-3.1-pro | gpt-5.2-codex | kimi-k3)\n"
                "---\n\n"
                "# Frontier Failure-Diagnostician & Escalation Resolver (`blocked`)\n\n"
                "Mid-tier workers escalate to `blocked` when tests fail repeatedly or when a ticket specification conflicts with repository reality. Your job is high-reasoning root-cause diagnosis.\n\n"
                "1. **Inspect Escalation Context**: Call `get_ticket` to read `blocked_reason`, worker `notes`, and `files_md`, then inspect `git status` / `git diff` in the ticket worktree.\n"
                "2. **Diagnose Root Cause (Don't Repeat Worker Loops)**: Reproduce the exact failing test or build error and identify the underlying invariant, type, concurrency, or architecture mismatch.\n"
                "3. **Resolve or Re-Specify**:\n"
                "   - If the fix is localized, land the surgical root-cause fix in the worktree, pass all `done_when_md` checks, and move the ticket to `review`.\n"
                "   - If the original specification was flawed, update `do_md` / `files_md` / `done_when_md` with accurate signatures and concrete steps, post an architectural note, and transition the ticket back to `todo` for a mid-range worker.\n"
            ),
        ),
    ]


def build_default_lane_configs() -> dict[str, LaneConfig]:
    """
    Out-of-the-box Orchestrator -> Worker -> Cross-Vendor Reviewer -> Frontier Escalation defaults:
      - `triage`: Frontier Orchestrators (`high` effort) for breadth, repo judgment & worker-ready specs
      - `todo` / `in-progress`: Mid-range / local Workers (`max`/`high` effort) for cost-efficient bounded execution
      - `review`: Cross-vendor Reviewers (`prevent_self_review=True`) to catch model-family blind spots
      - `blocked`: Frontier Failure-Diagnosticians (`high` effort) for escalated test/architecture failures
    """
    worker_instructions = (
        "Follow files_md and do_md strictly with high care; do not refactor out-of-scope files. "
        "If verification fails twice, stop looping and escalate to 'blocked' with the exact traceback."
    )
    orchestrator_instructions = (
        "Avoid over-decomposing simple tasks (1 ticket if 1-2 files / <150 LOC). "
        "Write mid-range-worker-ready specs: exact paths in files_md, exact signatures + ordered steps + Out-of-Scope in do_md, "
        "and runnable verification commands in done_when_md."
    )
    return {
        "triage": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="claude-code",
            fallback_agent="grok-cli",
            prevent_self_review=False,
            triage_breakdown_policy="stage-for-approval",
            review_merge_policy="auto-merge-clean",
            default_skills=["business-analysis", "triage-research-scan"],
            agent_rules={
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-opus-5-5",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                    custom_instructions=orchestrator_instructions,
                ),
                "grok-cli": AgentLaneRule(
                    agent_key="grok-cli",
                    agent_label="Grok CLI",
                    model="grok-4.7",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                    custom_instructions=orchestrator_instructions,
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.1-pro",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                    custom_instructions=orchestrator_instructions,
                ),
                "codex-cli": AgentLaneRule(
                    agent_key="codex-cli",
                    agent_label="OpenAI Codex CLI",
                    model="gpt-5.2-codex",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                    custom_instructions=orchestrator_instructions,
                ),
                "kimi-code": AgentLaneRule(
                    agent_key="kimi-code",
                    agent_label="Kimi Code",
                    model="kimi-k3",
                    effort="high",
                    skills=["business-analysis", "triage-research-scan"],
                    custom_instructions=orchestrator_instructions,
                ),
            },
        ),
        "todo": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="kimi-code",
            fallback_agent="antigravity",
            prevent_self_review=False,
            default_skills=["implementation-worker"],
            agent_rules={
                "kimi-code": AgentLaneRule(
                    agent_key="kimi-code",
                    agent_label="Kimi Code",
                    model="kimi-k2.6",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.8-flash",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-sonnet-5-5",
                    effort="max",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "grok-cli": AgentLaneRule(
                    agent_key="grok-cli",
                    agent_label="Grok CLI",
                    model="grok-code-fast-1",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "codex-cli": AgentLaneRule(
                    agent_key="codex-cli",
                    agent_label="OpenAI Codex CLI",
                    model="o4-mini",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "opencode": AgentLaneRule(
                    agent_key="opencode",
                    agent_label="OpenCode (Local Worker)",
                    model="qwen3-coder-30b-a3b",
                    effort="",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
            },
        ),
        "in-progress": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="kimi-code",
            fallback_agent="antigravity",
            prevent_self_review=False,
            default_skills=["implementation-worker"],
            agent_rules={
                "kimi-code": AgentLaneRule(
                    agent_key="kimi-code",
                    agent_label="Kimi Code",
                    model="kimi-k2.6",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.8-flash",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-sonnet-5-5",
                    effort="max",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "grok-cli": AgentLaneRule(
                    agent_key="grok-cli",
                    agent_label="Grok CLI",
                    model="grok-code-fast-1",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "codex-cli": AgentLaneRule(
                    agent_key="codex-cli",
                    agent_label="OpenAI Codex CLI",
                    model="o4-mini",
                    effort="high",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
                ),
                "opencode": AgentLaneRule(
                    agent_key="opencode",
                    agent_label="OpenCode (Local Worker)",
                    model="qwen3-coder-30b-a3b",
                    effort="",
                    skills=["implementation-worker"],
                    custom_instructions=worker_instructions,
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
                    model="grok-4.7",
                    effort="high",
                    skills=["qa-verification", "security-code-review"],
                    custom_instructions="Cross-vendor adversarial review: verify done_when_md, scope adherence, and security invariants; merge only on 0 issues.",
                ),
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-sonnet-5-5",
                    effort="high",
                    skills=["qa-verification", "security-code-review"],
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.8-flash",
                    effort="high",
                    skills=["qa-verification", "security-code-review"],
                ),
                "codex-cli": AgentLaneRule(
                    agent_key="codex-cli",
                    agent_label="OpenAI Codex CLI",
                    model="o4-mini",
                    effort="high",
                    skills=["qa-verification", "security-code-review"],
                ),
                "kimi-code": AgentLaneRule(
                    agent_key="kimi-code",
                    agent_label="Kimi Code",
                    model="kimi-k2.6",
                    effort="high",
                    skills=["qa-verification", "security-code-review"],
                ),
            },
        ),
        "blocked": LaneConfig(
            inherit_global=True,
            auto_dispatch=False,
            preferred_agent="claude-code",
            fallback_agent="grok-cli",
            prevent_self_review=False,
            default_skills=["root-cause-unblocker"],
            agent_rules={
                "claude-code": AgentLaneRule(
                    agent_key="claude-code",
                    agent_label="Claude Code",
                    model="claude-opus-5-5",
                    effort="high",
                    skills=["root-cause-unblocker"],
                    custom_instructions="Frontier Failure-Diagnostician: diagnose root cause of escalated worker failures without looping; fix or rewrite spec.",
                ),
                "grok-cli": AgentLaneRule(
                    agent_key="grok-cli",
                    agent_label="Grok CLI",
                    model="grok-4.7",
                    effort="high",
                    skills=["root-cause-unblocker"],
                ),
                "antigravity": AgentLaneRule(
                    agent_key="antigravity",
                    agent_label="Google Antigravity (agy)",
                    model="gemini-3.1-pro",
                    effort="high",
                    skills=["root-cause-unblocker"],
                ),
                "codex-cli": AgentLaneRule(
                    agent_key="codex-cli",
                    agent_label="OpenAI Codex CLI",
                    model="gpt-5.2-codex",
                    effort="high",
                    skills=["root-cause-unblocker"],
                ),
                "kimi-code": AgentLaneRule(
                    agent_key="kimi-code",
                    agent_label="Kimi Code",
                    model="kimi-k3",
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
    """Ensures all built-in lanes, built-in skills, and SystemOne settings exist even on older/partial JSON payloads."""
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

    # Normalize systemone_config
    raw_s1 = raw.get("systemone_config")
    if isinstance(raw_s1, dict):
        merged_data["systemone_config"] = SystemOneConfig(**raw_s1).model_dump()
    else:
        merged_data["systemone_config"] = defaults.systemone_config.model_dump()

    # Normalize watchdog and autorunner
    raw_wd = raw.get("watchdog")
    if isinstance(raw_wd, dict):
        merged_data["watchdog"] = WatchdogConfig(**raw_wd).model_dump()
    else:
        merged_data["watchdog"] = defaults.watchdog.model_dump()

    raw_ar = raw.get("autorunner")
    if isinstance(raw_ar, dict):
        merged_data["autorunner"] = AutoRunnerConfig(**raw_ar).model_dump()
    else:
        merged_data["autorunner"] = defaults.autorunner.model_dump()

    return GlobalSettings(**merged_data).model_dump()


def normalize_project_settings(raw: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Normalizes a project's `project_settings` JSON with safe defaults for all 5 lanes and SystemOne."""
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

    raw_s1 = raw.get("systemone_config")
    if isinstance(raw_s1, dict):
        merged["systemone_config"] = SystemOneConfig(**raw_s1).model_dump()
    else:
        merged["systemone_config"] = None

    raw_wh = raw.get("gitea_webhook")
    if isinstance(raw_wh, dict):
        merged["gitea_webhook"] = GiteaWebhookConfig(**raw_wh).model_dump()
    else:
        merged["gitea_webhook"] = GiteaWebhookConfig().model_dump()

    raw_pwd = raw.get("watchdog")
    if isinstance(raw_pwd, dict):
        merged["watchdog"] = WatchdogConfig(**raw_pwd).model_dump()
    else:
        merged["watchdog"] = WatchdogConfig().model_dump()

    raw_par = raw.get("autorunner")
    if isinstance(raw_par, dict):
        merged["autorunner"] = AutoRunnerConfig(**raw_par).model_dump()
    else:
        merged["autorunner"] = AutoRunnerConfig().model_dump()

    return ProjectSettings(**merged).model_dump()


def format_systemone_endpoint_url(raw_url: str) -> str:
    cleaned = (raw_url or "").strip().rstrip("/")
    if not cleaned:
        return "https://api.typesafe.ai/v1/systemone"
    if cleaned.endswith("/v1/systemone"):
        return cleaned
    return f"{cleaned}/v1/systemone"


def resolve_effective_systemone_config(
    global_settings: Optional[dict[str, Any]],
    project_settings: Optional[dict[str, Any]],
) -> dict[str, Any]:
    g_norm = global_settings or {}
    p_norm = project_settings or {}
    g_s1 = g_norm.get("systemone_config") or SystemOneConfig().model_dump()
    p_s1 = p_norm.get("systemone_config")
    if p_s1 and isinstance(p_s1, dict) and p_s1.get("enabled") is not None:
        return {
            "enabled": bool(p_s1.get("enabled", False)),
            "url": str(p_s1.get("url") or g_s1.get("url") or "https://api.typesafe.ai"),
            "api_key": p_s1.get("api_key") if p_s1.get("api_key") is not None else g_s1.get("api_key"),
            "model": str(p_s1.get("model") or g_s1.get("model") or "jev-latest"),
            "timeout_seconds": float(p_s1.get("timeout_seconds") or g_s1.get("timeout_seconds") or 5.0),
            "source": "project",
        }
    return {
        "enabled": bool(g_s1.get("enabled", False)),
        "url": str(g_s1.get("url") or "https://api.typesafe.ai"),
        "api_key": g_s1.get("api_key"),
        "model": str(g_s1.get("model") or "jev-latest"),
        "timeout_seconds": float(g_s1.get("timeout_seconds") or 5.0),
        "source": "global",
    }


def query_systemone_routing(
    systemone_config: dict[str, Any],
    task_state: dict[str, Any],
    candidate_models: list[dict[str, Any]],
    supported_efforts: Optional[list[str]] = None,
) -> dict[str, Any]:
    """
    Calls the TypeSafe AI System One HTTP API (POST /v1/systemone) with choice questions
    to decide the optimal model and effort for a task while respecting token budget.
    """
    endpoint = format_systemone_endpoint_url(str(systemone_config.get("url") or ""))
    api_key = (systemone_config.get("api_key") or "").strip()
    model_name = str(systemone_config.get("model") or "jev-latest").strip()
    timeout = float(systemone_config.get("timeout_seconds") or 5.0)

    # 1. Build Model Criteria map
    model_criteria: dict[str, str] = {}
    for m in candidate_models:
        mid = str(m.get("id") or "").strip()
        if not mid:
            continue
        mname = str(m.get("name") or mid)
        tier = str(m.get("tier") or "mid-tier")
        desc = str(m.get("description") or f"{tier} execution model")
        model_criteria[mid] = f"{mname} [{tier} tier] - {desc}"

    if not model_criteria:
        raise ValueError("No candidate models provided to SystemOne")

    # 2. Build Effort Criteria map
    effort_choices = supported_efforts or ["low", "medium", "high", "max"]
    effort_descriptions = {
        "low": "Fast, economical execution for simple, bounded, or low-risk tasks",
        "medium": "Balanced reasoning and standard test execution",
        "high": "Deep architectural reasoning, technical spikes, and hard debugging",
        "max": "Exhaustive verification, highest precision, and extended thinking",
    }
    effort_criteria = {eff: effort_descriptions.get(eff, f"{eff} reasoning effort") for eff in effort_choices}

    # 3. Construct TypeSafe System One question payload
    questions = {
        "recommended_model": {
            "type": "choice",
            "instructions": "Select the best model for this task considering complexity, risk, and token budget ceiling",
            "criteria": model_criteria,
        },
        "recommended_effort": {
            "type": "choice",
            "instructions": "Select the optimal reasoning effort level for this task",
            "criteria": effort_criteria,
        },
    }

    state_str = json.dumps(task_state, indent=2)
    payload = {
        "model": model_name,
        "state": state_str,
        "questions": questions,
    }

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Kanbanana-SystemOne/1.0",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    t0 = time.perf_counter()
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(endpoint, json=payload, headers=headers)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        resp.raise_for_status()
        data = resp.json()

    raw_answers = data.get("answers")
    answers_map: dict[str, Any] = {}
    if isinstance(raw_answers, dict):
        answers_map = raw_answers
    elif isinstance(raw_answers, list):
        for item in raw_answers:
            if isinstance(item, dict):
                qid = item.get("question_id") or item.get("id") or item.get("name")
                ans_body = item.get("answer") if "answer" in item else item
                if qid:
                    answers_map[str(qid)] = ans_body

    model_ans = answers_map.get("recommended_model") or {}
    if isinstance(model_ans, dict) and "choice" not in model_ans and "answer" in model_ans:
        if isinstance(model_ans["answer"], dict):
            model_ans = model_ans["answer"]
        elif isinstance(model_ans["answer"], str):
            model_ans = {"choice": model_ans["answer"]}

    effort_ans = answers_map.get("recommended_effort") or {}
    if isinstance(effort_ans, dict) and "choice" not in effort_ans and "answer" in effort_ans:
        if isinstance(effort_ans["answer"], dict):
            effort_ans = effort_ans["answer"]
        elif isinstance(effort_ans["answer"], str):
            effort_ans = {"choice": effort_ans["answer"]}

    chosen_model = str(model_ans.get("choice") or "").strip()
    if chosen_model not in model_criteria:
        chosen_model = list(model_criteria.keys())[0]

    chosen_effort = str(effort_ans.get("choice") or "").strip()
    if chosen_effort not in effort_criteria:
        chosen_effort = effort_choices[0] if effort_choices else "medium"

    return {
        "success": True,
        "model": chosen_model,
        "effort": chosen_effort,
        "confidence": model_ans.get("confidence") if isinstance(model_ans, dict) else None,
        "model_confidence": model_ans.get("confidence") if isinstance(model_ans, dict) else None,
        "effort_confidence": effort_ans.get("confidence") if isinstance(effort_ans, dict) else None,
        "model_probabilities": model_ans.get("probabilities") if isinstance(model_ans, dict) else None,
        "effort_probabilities": effort_ans.get("probabilities") if isinstance(effort_ans, dict) else None,
        "model_used": data.get("model") or model_name,
        "latency_ms": latency_ms,
        "usage": data.get("usage"),
        "fallback": False,
    }


def test_systemone_connection(
    url: str,
    api_key: Optional[str] = None,
    model: str = "jev-latest",
    timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    """Lightweight probe to verify connectivity to a SystemOne endpoint."""
    endpoint = format_systemone_endpoint_url(url)
    payload = {
        "model": model or "jev-latest",
        "state": "Kanbanana SystemOne connection verification probe.",
        "questions": {
            "probe": {
                "type": "choice",
                "instructions": "Verify connectivity",
                "criteria": {"ok": "Connection is functional"},
            }
        },
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Kanbanana-SystemOne/1.0",
    }
    if api_key and api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"

    t0 = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            resp.raise_for_status()
            data = resp.json()
            return {
                "success": True,
                "latency_ms": latency_ms,
                "model": data.get("model") or model,
                "status": "connected",
                "answers": data.get("answers"),
            }
    except Exception as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "success": False,
            "latency_ms": latency_ms,
            "error": str(e),
            "status": "error",
        }


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
    ticket: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Computes the concrete execution plan (agent, model, effort, skills, policies, self-review check)
    when `agent_id` picks up or is auto-dispatched on a ticket in `lane`.
    Evaluates SystemOne (/v1/systemone) if enabled on the matched Agent x Lane rule.
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

    use_systemone = bool(matched_rule and matched_rule.get("use_systemone"))
    systemone_decision: Optional[dict[str, Any]] = None

    chosen_model = (explicit_model or "").strip()
    chosen_effort = (explicit_effort or "").strip()

    # SystemOne Evaluation Branch (if enabled on rule and not explicitly overridden)
    if use_systemone and not chosen_model:
        s1_cfg = resolve_effective_systemone_config(g_norm, p_norm)
        if s1_cfg.get("enabled") and s1_cfg.get("url"):
            # Gather candidates from profile
            candidate_models: list[dict[str, Any]] = []
            if profile:
                sup_models = list(
                    profile.get("supported_models")
                    or ((profile.get("a2a_card") or {}).get("supported_models"))
                    or []
                )
                for sm in sup_models:
                    if isinstance(sm, dict) and sm.get("id"):
                        candidate_models.append(sm)

            if not candidate_models:
                canon_prov = canonical_provider_for_agent(
                    target_agent, str((profile or {}).get("provider") or "")
                )
                from .a2a_protocol import PROVIDER_MODEL_CATALOG

                for pm in PROVIDER_MODEL_CATALOG.get(canon_prov, []):
                    candidate_models.append(pm.model_dump())

            token_ceiling = p_norm.get("token_ceiling_override") or int(
                g_norm.get("default_token_ceiling", 1_200_000)
            )

            task_state = {
                "lane": norm_lane,
                "target_agent": target_agent,
                "token_ceiling": token_ceiling,
            }
            if ticket:
                task_state.update(
                    {
                        "ticket_code": ticket.get("code"),
                        "title": ticket.get("title"),
                        "files_md": ticket.get("files_md") or "",
                        "do_md": ticket.get("do_md") or "",
                        "done_when_md": ticket.get("done_when_md") or "",
                        "depends_on": ticket.get("depends_on") or [],
                        "exactness_level": ticket.get("exactness_level") or "exact",
                    }
                )

            supported_efforts = ["low", "medium", "high", "max"]
            if profile and profile.get("effort_levels"):
                supported_efforts = list(profile["effort_levels"])

            try:
                s1_decision = query_systemone_routing(
                    s1_cfg,
                    task_state=task_state,
                    candidate_models=candidate_models,
                    supported_efforts=supported_efforts,
                )
                chosen_model = s1_decision["model"]
                if not chosen_effort:
                    chosen_effort = s1_decision["effort"]
                systemone_decision = s1_decision
            except Exception as e:
                logger.warning(
                    f"SystemOne evaluation failed, falling back gracefully to tier defaults: {e}"
                )
                systemone_decision = {
                    "fallback": True,
                    "error": str(e),
                    "model_used": s1_cfg.get("model", "jev-latest"),
                }
        else:
            systemone_decision = {
                "fallback": True,
                "reason": "SystemOne is disabled or URL not configured",
            }

    # Manual rule model / effort fallback
    if not chosen_model and matched_rule and not use_systemone:
        chosen_model = str(matched_rule.get("model") or "").strip()

    if not chosen_effort and matched_rule and not use_systemone:
        chosen_effort = str(matched_rule.get("effort") or "").strip()

    # Tier-aware Orchestrator -> Worker fallback when profile has no explicit agent_rule or SystemOne fallback
    if profile and not chosen_model:
        sup_models = list(
            profile.get("supported_models")
            or ((profile.get("a2a_card") or {}).get("supported_models"))
            or []
        )
        preferred_tiers = (
            ("frontier", "mid-tier")
            if norm_lane in ("triage", "blocked")
            else ("mid-tier", "fast", "frontier")
        )
        picked_spec: Optional[dict[str, Any]] = None
        for tier_name in preferred_tiers:
            picked_spec = next(
                (m for m in sup_models if isinstance(m, dict) and m.get("tier") == tier_name),
                None,
            )
            if picked_spec:
                break
        if picked_spec and picked_spec.get("id"):
            chosen_model = str(picked_spec["id"]).strip()
            if not chosen_effort and picked_spec.get("supports_effort"):
                eff_levels = list(picked_spec.get("effort_levels") or [])
                if norm_lane in ("todo", "in-progress") and "max" in eff_levels:
                    chosen_effort = "max"
                elif "high" in eff_levels:
                    chosen_effort = "high"
                else:
                    chosen_effort = str(picked_spec.get("default_effort") or "").strip()
        if not chosen_model:
            chosen_model = str(profile.get("default_model") or "").strip()

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
        "use_systemone": use_systemone,
        "systemone_decision": systemone_decision,
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
