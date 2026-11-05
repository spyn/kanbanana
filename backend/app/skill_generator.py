from __future__ import annotations

from typing import Any
from .models import SkillConfig


def render_skill_md(project: dict[str, Any], mcp_url: str = "http://localhost:8765/mcp") -> str:
    slug = project["slug"]
    name = project["name"]
    raw_cfg = project.get("skill_config") or {}
    cfg = SkillConfig(**raw_cfg) if isinstance(raw_cfg, dict) else raw_cfg

    skill_name = cfg.skill_name or f"{slug}-board"
    desc = cfg.description or (
        f"How to pick up, work, triage, and hand back a task from the shared {name} Kanbanana MCP board "
        f"(project slug: `{slug}`) without clashing with other agents."
    )

    lines: list[str] = [
        "---",
        f"name: {skill_name}",
        f"description: {desc}",
        "---",
        "",
        f"# {name} — Agent-First MCP Task Board",
        "",
        f"This project uses the **Kanbanana MCP server** (`{mcp_url}`, project slug: `{slug}`).",
        "Instead of editing flat files by hand, all task claiming, triage refinement, shared resource coordination in `#agents`, and story handoffs directly from `blocked` happen atomically through the `kanbanana` MCP tools.",
        "",
    ]

    if cfg.background_report_path or cfg.research_notes_path:
        lines.append("## Background & Research References")
        if cfg.background_report_path:
            lines.append(f"- **Primary Report:** `{cfg.background_report_path}`")
        if cfg.research_notes_path:
            lines.append(f"- **Research Notes:** `{cfg.research_notes_path}`")
        lines.append("")

    lines.extend(
        [
            "## 1. Onboarding, Picking & Claiming a Task",
            "",
            f"1. **Onboard first:** Call `get_project_onboarding(project_slug=\"{slug}\", compact=True)` (or read `board://{slug}/summary.md`) to inspect pinned messages in `#agents`, review queue, and unblocked `todo` or `blocked` tickets awaiting handover.",
            f"2. **Search prior art before starting:** Call `search_board(project_slug=\"{slug}\", query=\"<topic/file/kernel>\")` to check prior notes and the 'Measured & Rejected — Do Not Redo' log (`board://{slug}/background.md`).",
            "3. **Choose your owner id:** Use your worktree name if you have one, otherwise a short session label (e.g. `bg-200fdbe0`, `cursor-q10`). It must distinguish you from other agents.",
            "4. **Claim atomically (with optional auto-worktree):**",
            f"   - If the user named a specific task (e.g. `Q1`), call `claim_ticket(project_slug=\"{slug}\", code=\"Q1\", agent_id=\"<your-id>\", auto_create_worktree=True)`. This works for both new `todo` tickets and `blocked` tickets awaiting handover.",
            f"   - If the user asked you to take the next available task, call `pick_next_todo(project_slug=\"{slug}\", agent_id=\"<your-id>\", auto_create_worktree=True)`.",
            "   - The MCP server verifies in a single SQLite transaction that the ticket is in `todo` or `blocked` and its `depends_on` tickets are `done` (or `review`), provisions an isolated git worktree when `auto_create_worktree=True`, and returns `concurrent_file_overlap_warnings` if any other in-progress ticket touches the same files.",
            "",
            "## 2. Triage, Research Scans & \"Grill\" Refinement Workflow",
            "",
            "Users drop research investigations into the **Triage** column (`status = 'triage'`), typically framed as:",
            "- **External / Competitor Scan**: *\"X is using Y to do Z — let's look into that\"* (e.g. upstream PRs, competing libraries, or reference repos).",
            "- **Feature / Bottleneck Research**: *\"Research into this feature\"* to determine feasibility, performance gain, and architectural impact before writing code.",
            "",
            "When asked to triage or research an idea:",
            f"1. Call `claim_triage_ticket(project_slug=\"{slug}\", code=\"<T-code>\", agent_id=\"<your-id>\")`.",
            "2. Research the external source (if any), project codebase, and context tools.",
            "3. **If requirements are ambiguous or need a design decision:**",
            f"   - Call `ask_triage_questions(project_slug=\"{slug}\", code=\"<T-code>\", agent_id=\"<your-id>\", questions_md=\"...\")`. This sets `triage_state = 'needs-info'` and surfaces your questions in the WebUI.",
            "4. **When you have findings or a breakdown:**",
            f"   - Call `submit_triage_research_findings(project_slug=\"{slug}\", triage_code=\"<T-code>\", agent_id=\"<your-id>\", findings_md=\"...\", estimated_gain=\"...\", exactness_impact=\"exact\", recommendation=\"...\", attach_to_ticket_codes=[...], proposals=[...])`.",
            "   - `recommendation` options:",
            "     - `'propose-todos'`: Propose 1 or more actionable TODO sub-tickets (can also call `propose_todo_tickets`).",
            "     - `'attach-to-existing'`: Cross-post your external scan / research notes directly onto existing board tickets and close the triage ticket.",
            "     - `'not-worth-it'`: Record why the idea does not pay off on this project/architecture and close it so future agents do not redo it.",
            "",
            "## 3. Isolate in a Worktree",
            "",
            "- Work in an isolated git worktree on a branch named `board/<id>-<slug>` (for example `board/q1-feature`). Background sessions must create/enter a worktree before the first code edit.",
            "- Never commit directly to `main`, force-push, or merge without instruction. Commit in your worktree and push when a remote exists.",
            "- Keep your ticket's `branch_name`, `worktree_path`, `commit_sha`, and `pr_url` updated via `update_ticket_progress`.",
            "",
        ]
    )

    has_context_tools = bool(cfg.hindsight_url or cfg.local_memory_dir or cfg.memory_table or cfg.graphify_graph_path)
    if has_context_tools:
        lines.extend(
            [
                "## 4. Load Context Before Writing Code",
                "",
                "Do these in order, and keep each step short.",
                "",
            ]
        )
        if cfg.hindsight_url:
            lines.extend(
                [
                    "**a. Hindsight** (decisions and the reasons behind them; the code doesn't show these):",
                    f"- Remote Hindsight MCP server (`{cfg.hindsight_url}`). First stop: search knowledge pages for the task topic, then read matching pages.",
                    "- For WHY questions and exact decided values, use `reflect` deliberately.",
                    "- For a medium project or big bet, record the plan once agreed before writing code.",
                    "- If anything Hindsight returned reaches your reply, credit it visibly: start that part with `🧠 From Hindsight memory: ...`.",
                    "",
                ]
            )

        if cfg.local_memory_dir or cfg.memory_table:
            lines.append(
                f"**b. Local memory notes** in `{cfg.local_memory_dir or 'local memory directory'}`. "
                "A session started from a worktree may not load these automatically, so read them by absolute path:"
            )
            lines.append("")
            if cfg.memory_table:
                lines.append("| Task area | Board IDs | Read |")
                lines.append("|---|---|---|")
                for row in cfg.memory_table:
                    lines.append(f"| {row.task_area} | {row.board_ids} | {row.read_files} |")
                lines.append("")

        if cfg.graphify_graph_path:
            lines.extend(
                [
                    "**c. graphify** (structure and cross-file relationships). Query by absolute path:",
                    "```bash",
                    f'graphify query "<question>" --graph "{cfg.graphify_graph_path}"',
                    f'graphify explain "<symbol>" --graph "{cfg.graphify_graph_path}"',
                    f'graphify path "<A>" "<B>" --graph "{cfg.graphify_graph_path}"',
                    "```",
                    "- Query before grepping widely. After changing code in your worktree, run `graphify update .` **in the worktree** (never on the main checkout from a worktree).",
                    "",
                ]
            )

    sec_num = 5 if has_context_tools else 4
    lines.extend(
        [
            f"## {sec_num}. Shared Resources Coordination (#agents) & Quota Handoffs",
            "",
            "- **Coordinate shared resources via `#agents` channel:**",
            "  - Before taking exclusive hardware, GPUs, or heavy test environments, post a message or thread reply to `#agents` (e.g. `[GPU Request] Taking GPU for benchmark on T-102`).",
            "  - Coordinate with peers in the thread. When your run completes or fails, post an update releasing the resource (e.g. `[GPU Released] Benchmark complete`).",
            "- **Running out of usage / quota handoff:**",
            "  - If your session is approaching usage limits or you must stop mid-task:",
            f"  - Commit your work-in-progress to your worktree branch and call `report_agent_usage_exhausted(project_slug=\"{slug}\", agent_id=\"<your-id>\", usage_reset_at=\"...\", handoff_summary_md=\"...\", release_ticket=True)`.",
            "  - This transitions the ticket to **`blocked`** (with reason indicating quota exhaustion awaiting handover), records your branch/worktree/commit handoff note on the ticket, and announces it in `#agents`.",
            f"  - Another agent can pick up and resume this story directly from `blocked` by calling `claim_ticket(project_slug=\"{slug}\", code=\"<ID>\", agent_id=\"<new-id>\")`.",
            "",
        ]
    )

    sec_num += 1
    if cfg.custom_rules_md:
        lines.extend(
            [
                f"## {sec_num}. Project-Specific Rules while Working",
                "",
                cfg.custom_rules_md.strip(),
                "",
            ]
        )
        sec_num += 1

    ps = project.get("project_settings") or {}
    verify_cmd = str(ps.get("require_verification_cmd") or "").strip()
    effective_lanes = project.get("effective_lanes") or {}

    if verify_cmd:
        lines.extend(
            [
                f"## {sec_num}. Required Verification Gate Before `review`",
                "",
                f"Always run and pass `{verify_cmd}` inside your worktree before transitioning any ticket to `review`.",
                "",
            ]
        )
        sec_num += 1

    if effective_lanes:
        lines.extend(
            [
                f"## {sec_num}. Configured Agent × Lane Routing Matrix",
                "",
                "| Lane | Preferred Agent | Auto-Dispatch | Default Skills | Agent Model & Skill Overrides |",
                "|---|---|---|---|---|",
            ]
        )
        for lane_key in ("triage", "todo", "in-progress", "review", "blocked"):
            lcfg = effective_lanes.get(lane_key)
            if not isinstance(lcfg, dict):
                continue
            pref_ag = lcfg.get("preferred_agent") or "—"
            auto_str = "Yes" if lcfg.get("auto_dispatch") else "Manual/Poll"
            def_sk = ", ".join(f"`{s}`" for s in (lcfg.get("default_skills") or [])) or "—"
            rule_bits: list[str] = []
            for ak, ar in (lcfg.get("agent_rules") or {}).items():
                if not isinstance(ar, dict) or not ar.get("enabled", True):
                    continue
                m_str = ar.get("model") or "default"
                ef_str = f" ({ar['effort']})" if ar.get("effort") else ""
                sk_str = ", ".join(ar.get("skills") or [])
                rule_bits.append(f"**{ak}**: `{m_str}`{ef_str}" + (f" [{sk_str}]" if sk_str else ""))
            lines.append(
                f"| `{lane_key}` | `{pref_ag}` | {auto_str} | {def_sk} | {'; '.join(rule_bits) or '—'} |"
            )
        lines.append("")
        sec_num += 1

    lines.extend(
        [
            f"## {sec_num}. Finish, Peer-Review, or Hand Back",
            "",
            f"Use `update_ticket_progress(project_slug=\"{slug}\", code=\"<ID>\", agent_id=\"<your-id>\", status=\"...\", note_md=\"...\", release_locks=True)`: ",
            "- **`review`**: work committed and pushed. Include `branch_name`, `pr_url`, `commit_sha`, and a measured results summary in `note_md`. Set `release_locks=True` to automatically release any held locks; the response also lists `newly_unblocked_tickets`.",
            "- **`done`**: only after the user merges or a peer reviewer approves it.",
            "- **`blocked`**: set `blocked_reason` and explain what would unblock it in `note_md`. Keep your owner id on it.",
            "- **giving up**: set `status=\"todo\"`, and document what you learned in `note_md`.",
            f"- **Picking up a `review` ticket (Code & Security Review Skill)**: Load the `{slug}-code-review` skill (`skill://{slug}/CODE_REVIEW_SKILL.md`), use a **mid-tier model** (`claude-sonnet-4-5`, `gemini-2.5-flash`, `o4-mini`, or subagent `Model=\"flash\"`), call `inspect_review_ticket(project_slug=\"{slug}\", code=\"<ID>\")`, and submit `review_ticket(project_slug=\"{slug}\", code=\"<ID>\", reviewer_agent_id=\"<your-id>\", reviewer_model=\"...\", verdict=\"approve\" | \"request-changes\", code_issues=[...], security_issues=[...], review_md=\"...\", merge_if_clean=True)`. If zero code or security issues are found, it automatically merges the MR/PR and marks the ticket `done`.",
            f"- **Creating a follow-up TODO task**: call `create_todo_ticket(project_slug=\"{slug}\", code=\"<ID>\", title=\"...\", section_code=\"1\", depends_on=[...], files_md=\"...\", do_md=\"...\", done_when_md=\"...\")`.",
            f"- **Co-worker watercooler (`#gbs`)**: Feel free to post casual observations, funny bugs, war stories, or co-worker banter to the `#gbs` channel via `post_message(project_slug=\"{slug}\", author=\"<your-id>\", channel=\"gbs\", title=\"...\", body_md=\"...\")`!",
            "",
            "End by telling the user: the task ID, its new status, the branch, the measured result, and the next task that is now unblocked (`newly_unblocked_tickets`).",
        ]
    )
    return "\n".join(lines) + "\n"


def render_code_review_skill_md(project: dict[str, Any], mcp_url: str = "http://localhost:8765/mcp") -> str:
    slug = project["slug"]
    name = project["name"]
    raw_cfg = project.get("skill_config") or {}
    cfg = SkillConfig(**raw_cfg) if isinstance(raw_cfg, dict) else raw_cfg

    skill_name = f"{slug}-code-review"
    desc = (
        f"Code & security review skill for {name} (`{slug}`). Use when picking up a `review` ticket on the "
        "Kanbanana board: run a mid-tier model to audit code quality, exactness invariants, and security issues, "
        "and merge the MR/PR if and only if zero issues are found."
    )

    lines: list[str] = [
        "---",
        f"name: {skill_name}",
        f"description: {desc}",
        "recommended_model_tier: mid-tier (claude-sonnet-4-5 | gemini-2.5-flash | gpt-4.1-mini | o4-mini | kimi-k2)",
        "---",
        "",
        f"# {name} — Code & Security Review Skill (`review` Tickets)",
        "",
        f"Activate this skill whenever you pick up a ticket in the **`review`** column on the **{name}** Kanbanana MCP board (`{mcp_url}`, project slug: `{slug}`).",
        "",
        "## 1. Model Selection — Use a Mid-Tier Model",
        "",
        "- **Always run the review pass on a mid-tier model** rather than a heavyweight frontier reasoning model:",
        "  - **Anthropic**: `claude-sonnet-4-5` (`claude --model sonnet`)",
        "  - **Google Antigravity / Gemini**: `gemini-2.5-flash` (or invoke a subagent with `Model=\"flash\"`)",
        "  - **OpenAI / Codex**: `gpt-4.1-mini` or `o4-mini`",
        "  - **Kimi / Minimax**: `kimi-k2` / `minimax-m1`",
        "- Why: Mid-tier models provide fast, high-signal static analysis over branch diffs and security checklists at a fraction of the token cost and latency.",
        "",
        "## 2. Step-by-Step Review Workflow",
        "",
        "### Step 1: Inspect the Review Ticket & Branch Diff",
        f"1. Call `inspect_review_ticket(project_slug=\"{slug}\", code=\"<ID>\")` via MCP.",
        "   - This returns the ticket metadata (`branch_name`, `worktree_path`, `pr_url`, `commit_sha`, `done_when_md`, implementation notes), the `git diff main...<branch_name>` stat & patch, and automated static pre-scan warnings.",
        "2. If the diff is large, inspect the touched files directly in the ticket's `worktree_path` (or run `git diff main...<branch_name> -- <file>`).",
        "",
        "### Step 2: Audit for Code Issues (`code_issues`)",
        "Check every changed file against the following criteria and list any violations in `code_issues`:",
        "1. **`Done when` & Verification Completeness**: Did the author satisfy every requirement in `done_when_md` (unit tests, benchmark rounds, both single-GPU and distributed/RPC paths if applicable)?",
        "2. **Correctness & Edge Cases**: Off-by-one indexing, integer overflow in tensor/buffer offsets, unguarded `.unwrap()` / `.expect()` on fallible runtime paths, resource/VRAM leaks, or deadlocks.",
        "3. **Concurrency & Lock Discipline**: Did the author release all GPU/feature locks (`gpu:xeres`, `gpu:sunny`, `gpu:shodan`) and avoid mutating shared state without synchronization?",
    ]

    if cfg.custom_rules_md:
        lines.extend(
            [
                "4. **Project-Specific Invariants**:",
                cfg.custom_rules_md.strip(),
            ]
        )

    lines.extend(
        [
            "",
            "### Step 3: Audit for Security Issues (`security_issues`)",
            "Check the diff for security vulnerabilities and list any findings in `security_issues`:",
            "1. **Secrets & Credentials**: Hardcoded API keys, tokens, passwords, private URLs, or `.env` files accidentally staged.",
            "2. **Memory Safety & Unsafe Blocks (Rust / C++ / HIP)**:",
            "   - Unchecked pointer arithmetic, out-of-bounds device kernel indexing (`threadIdx` / `blockIdx` without bounds checks), unaligned memory accesses, or `unsafe` blocks missing safety invariants.",
            "3. **Command & Path Injection**:",
            "   - Shell execution with unsanitized inputs (`shell=True`, `os.system`, unescaped format strings), arbitrary path traversal (`..`) in file/model loaders, or unsafe deserialization (`pickle`, unvalidated RPC wire frames).",
            "4. **Network & RPC Boundaries**:",
            "   - Missing bounds checks on incoming RPC tensor headers, allocation sizes controlled by untrusted remote peers without caps, or exposed debug endpoints.",
            "",
            "### Step 4: Submit Review & Merge MR/PR if Clean",
            f"Call `review_ticket` on the MCP server with your structured findings:",
            "```python",
            "review_ticket(",
            f'    project_slug="{slug}",',
            '    code="<ID>",',
            '    reviewer_agent_id="<your-id>",',
            '    reviewer_model="claude-sonnet-4-5",  # or gemini-2.5-flash / o4-mini',
            '    verdict="approve",                   # "approve" ONLY if code_issues == [] and security_issues == []',
            "    code_issues=[],                      # list[str] of concrete code bugs/regressions",
            "    security_issues=[],                  # list[str] of concrete security vulnerabilities",
            '    review_md="Summary of files reviewed, invariants checked, and test/benchmark verification.",',
            "    merge_if_clean=True,                 # merges the MR/PR or git branch when 0 issues are found",
            ")",
            "```",
            "",
            "## 3. Merge Policy (Strict Gate)",
            "",
            "- **If ANY `code_issues` or `security_issues` are found (`len > 0`):**",
            "  - **DO NOT MERGE.** Set `verdict=\"request-changes\"` and pass the exact `file:line` descriptions in `code_issues` and/or `security_issues`.",
            "  - The MCP server automatically blocks the merge, appends a structured review report to the ticket, moves the ticket back to `in-progress`, and posts an alert in `#reviews`.",
            "- **If ZERO `code_issues` and ZERO `security_issues` are found:**",
            "  - Set `verdict=\"approve\"` and `merge_if_clean=True`.",
            "  - The MCP server (or you via `gh pr merge` / `glab mr merge` / `git merge --no-ff <branch_name>`) merges the MR/PR into `main`, records the merge commit SHA, transitions the ticket to **`done`**, and announces any newly unblocked downstream tickets!",
        ]
    )
    return "\n".join(lines) + "\n"

