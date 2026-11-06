from __future__ import annotations

import os
from typing import Any, Optional
from fastmcp import FastMCP

from .agent_manager import (
    discover_agent_profiles,
    ensure_ticket_worktree,
    inspect_review_branch_and_static_scan,
    merge_ticket_branch_or_pr,
    resolve_or_virtual_profile,
    run_auto_runner_cycle,
    run_watchdog_cycle,
    trigger_lane_auto_dispatch,
)
from .db import Database
from .events import event_hub
from .models import (
    AgentUpsertRequest,
    AgentUsageExhaustedRequest,
    LockAcquireRequest,
    LockCreate,
    MessageCreate,
    NoteCreate,
    ProposalItemCreate,
    ProposeTicketsRequest,
    TicketCreate,
    TicketUpdate,
)
from .routing_config import (
    discover_unified_skills,
    resolve_agent_lane_plan,
)
from .skill_generator import render_code_review_skill_md, render_skill_md


def create_mcp_server(db: Database) -> FastMCP:
    mcp = FastMCP(
        name="Kanbanana",
        instructions=(
            "Agent-first Kanban board & coordination server. "
            "Use `get_project_onboarding` first to see active GPU/feature locks, pinned messages, "
            "in-progress tasks, review queue, and claimable `todo` or `triage` tickets. "
            "Use `search_board` before proposing or starting work to check prior notes and 'Measured & Rejected' items."
        ),
    )

    def resolve_slug(project_slug: Optional[str] = None) -> str:
        return (
            project_slug
            or os.environ.get("KANBANANA_DEFAULT_PROJECT")
            or db.get_default_project_slug()
        )

    def _compute_lane_plan(
        project_slug: str,
        lane: str,
        agent_id: str = "",
        ticket_owner: Optional[str] = None,
        ticket_code: Optional[str] = None,
    ) -> dict[str, Any]:
        proj = db.get_project(project_slug)
        gs = db.get_global_settings()
        profiles = discover_agent_profiles(db)
        prof = resolve_or_virtual_profile(profiles, agent_id)
        tick = db.get_ticket(project_slug, ticket_code) if ticket_code else None
        return resolve_agent_lane_plan(
            gs,
            proj,
            lane=lane,
            agent_id=agent_id,
            profile=prof,
            profiles=profiles,
            ticket_owner=ticket_owner,
            ticket=tick,
        )

    @mcp.tool()
    def get_lane_routing_plan(
        project_slug: str,
        lane: str = "todo",
        agent_id: str = "",
    ) -> dict[str, Any]:
        """
        Resolve the configured model, effort, assigned skills (`skill://` URIs & markdown),
        verification command, and lane exit policies for `(project_slug, lane, agent_id)`.
        """
        return _compute_lane_plan(project_slug, lane=lane, agent_id=agent_id)

    @mcp.tool()
    def get_project_onboarding(
        project_slug: Optional[str] = None,
        compact: bool = False,
    ) -> dict[str, Any]:
        """
        First tool every agent should call on startup.
        Executes a single-connection batched query returning project info, skill context table,
        active locks, recent messages, claimable `todo` tickets (where dependencies are satisfied),
        `review` tickets awaiting verification, `in-progress` tickets, and open `triage` tickets.
        Set `compact=True` to omit verbose `do_md`/`done_when_md` fields and truncate background text
        when conserving context window tokens.
        """
        slug = resolve_slug(project_slug)
        return db.get_onboarding_bundle(project_slug=slug, compact=compact)

    @mcp.tool()
    def search_board(
        project_slug: Optional[str] = None,
        query: str = "",
        scope: str = "all",
        limit: int = 20,
    ) -> dict[str, Any]:
        """
        Full-text search across the board before starting work or investigating a triage ticket.
        Searches tickets (code, title, files, do, done_when), ticket notes, messages,
        and `board_background_md` (including 'Measured & Rejected — Do Not Redo').
        `scope` can be 'all', 'tickets', 'notes', 'messages', or 'background'.
        """
        slug = resolve_slug(project_slug)
        return db.search_board(project_slug=slug, query=query, scope=scope, limit=limit)

    @mcp.tool()
    def check_file_conflicts(
        project_slug: Optional[str] = None,
        ticket_code: str = "",
        files_md: str = "",
    ) -> list[dict[str, Any]]:
        """
        Check whether a ticket's files (or an explicit `files_md` list like '`src/engine.rs`, `hip/src/kernels.cpp`')
        overlap with any currently `in-progress` tickets owned by other agents.
        """
        slug = resolve_slug(project_slug)
        return db.check_file_conflicts(project_slug=slug, code=ticket_code, files_md=files_md)

    @mcp.tool()
    def list_tickets(
        project_slug: Optional[str] = None,
        status: Optional[str] = None,
        section_code: Optional[str] = None,
        owner: Optional[str] = None,
        include_notes: bool = False,
    ) -> list[dict[str, Any]]:
        """List tickets on the board with optional status, section, or owner filters."""
        slug = resolve_slug(project_slug)
        return db.list_tickets(
            project_slug=slug,
            status=status,
            section_code=section_code,
            owner=owner,
            include_notes=include_notes,
        )

    @mcp.tool()
    def get_ticket(project_slug: str, code: str) -> dict[str, Any]:
        """Fetch full details of a ticket, including dependency statuses, git worktree/branch, notes, and proposals."""
        t = db.get_ticket(project_slug, code)
        if not t:
            raise ValueError(f"Ticket '{code}' not found in project '{project_slug}'")
        return t

    @mcp.tool()
    def claim_ticket(
        project_slug: str,
        code: str,
        agent_id: str,
        branch_name: str = "",
        worktree_path: str = "",
        allow_review_deps: bool = True,
        auto_create_worktree: bool = False,
    ) -> dict[str, Any]:
        """
        Atomically claim a 'todo' or 'blocked' ticket for `agent_id` (handover or resumption).
        Fails if another agent claimed it first or if its `depends_on` tickets are not 'done' (or 'review').
        If `auto_create_worktree=True`, automatically provisions an isolated git worktree in the project's
        worktrees directory (`git worktree add -b board/<code> ...`) and records its path on the ticket.
        Also returns `concurrent_file_overlap_warnings` if any other in-progress ticket touches the same files.
        """
        t = db.claim_ticket(
            project_slug=project_slug,
            code=code,
            agent_id=agent_id,
            branch_name=branch_name,
            worktree_path=worktree_path,
            allow_review_deps=allow_review_deps,
        )
        if auto_create_worktree and not worktree_path:
            proj = db.get_project(project_slug)
            if proj:
                wt_info = ensure_ticket_worktree(proj, t["code"], t.get("branch_name") or "")
                t = db.update_ticket(
                    project_slug,
                    t["code"],
                    TicketUpdate(
                        worktree_path=wt_info["worktree_path"],
                        branch_name=wt_info["branch_name"],
                    ),
                )
                t["worktree_provisioned"] = wt_info
        t["lane_routing_plan"] = _compute_lane_plan(project_slug, lane="in-progress", agent_id=agent_id)
        event_hub.notify_sync("ticket_claimed", {"project_slug": project_slug, "code": t["code"], "owner": agent_id})
        return t

    @mcp.tool()
    def pick_next_todo(
        project_slug: str,
        agent_id: str,
        branch_name: str = "",
        worktree_path: str = "",
        allow_review_deps: bool = True,
        auto_create_worktree: bool = False,
    ) -> dict[str, Any]:
        """
        Atomically pick and claim the first unblocked 'todo' ticket in board order.
        Set `auto_create_worktree=True` to automatically create an isolated git worktree for the claimed ticket.
        """
        t = db.pick_next_todo(
            project_slug=project_slug,
            agent_id=agent_id,
            branch_name=branch_name,
            worktree_path=worktree_path,
            allow_review_deps=allow_review_deps,
        )
        if auto_create_worktree and not worktree_path:
            proj = db.get_project(project_slug)
            if proj:
                wt_info = ensure_ticket_worktree(proj, t["code"], t.get("branch_name") or "")
                t = db.update_ticket(
                    project_slug,
                    t["code"],
                    TicketUpdate(
                        worktree_path=wt_info["worktree_path"],
                        branch_name=wt_info["branch_name"],
                    ),
                )
                t["worktree_provisioned"] = wt_info
        t["lane_routing_plan"] = _compute_lane_plan(project_slug, lane="in-progress", agent_id=agent_id)
        event_hub.notify_sync("ticket_claimed", {"project_slug": project_slug, "code": t["code"], "owner": agent_id})
        return t

    @mcp.tool()
    def hold_ticket(
        project_slug: str,
        code: str,
        agent_id: str = "user",
        reason: str = "",
    ) -> dict[str, Any]:
        """
        Puts a ticket on hold (`is_held=True`) to pause execution and prevent autonomous agents from claiming or auto-dispatching it.
        Optionally records a system/hold note explaining why the ticket was paused.
        """
        t = db.update_ticket(project_slug, code, TicketUpdate(is_held=True))
        if reason:
            db.add_ticket_note(
                project_slug,
                code,
                NoteCreate(
                    author=agent_id,
                    kind="system",
                    content_md=f"⏸️ **Ticket Placed on Hold** by `{agent_id}`: {reason}",
                ),
            )
            t = db.get_ticket(project_slug, code) or t
        event_hub.notify_sync("ticket_updated", {"project_slug": project_slug, "code": code})
        return t

    @mcp.tool()
    def resume_ticket(
        project_slug: str,
        code: str,
        agent_id: str = "user",
        note_md: str = "",
    ) -> dict[str, Any]:
        """
        Resumes a held ticket (`is_held=False`), allowing agents to claim or auto-dispatch it again.
        """
        t = db.update_ticket(project_slug, code, TicketUpdate(is_held=False))
        note_text = note_md or f"▶️ **Ticket Resumed from Hold** by `{agent_id}`."
        db.add_ticket_note(
            project_slug,
            code,
            NoteCreate(
                author=agent_id,
                kind="system",
                content_md=note_text,
            ),
        )
        t = db.get_ticket(project_slug, code) or t
        event_hub.notify_sync("ticket_updated", {"project_slug": project_slug, "code": code})
        return t

    @mcp.tool()
    def update_ticket_progress(
        project_slug: str,
        code: str,
        agent_id: str,
        status: Optional[str] = None,
        branch_name: Optional[str] = None,
        worktree_path: Optional[str] = None,
        pr_url: Optional[str] = None,
        commit_sha: Optional[str] = None,
        exactness_level: Optional[str] = None,
        blocked_reason: Optional[str] = None,
        note_md: Optional[str] = None,
        note_kind: str = "note",
        release_locks: bool = False,
        is_held: Optional[bool] = None,
    ) -> dict[str, Any]:
        """
        Update a ticket's status ('todo', 'in-progress', 'review', 'blocked', 'done'),
        git metadata (branch, worktree, PR, commit SHA), and optionally append a structured note.
        - If setting status back to 'todo' (giving up), owner is cleared automatically.
        - If setting status to 'review' or 'done', returns `newly_unblocked_tickets` and `held_locks_reminder`.
        - Set `release_locks=True` to automatically release any GPU/feature locks held by `agent_id`.
        - Set `is_held=True` or `is_held=False` to pause or resume work on the ticket.
        """
        prev_ticket = db.get_ticket(project_slug, code)
        prev_status = prev_ticket["status"] if prev_ticket else None

        new_owner: Optional[str] = None
        if status == "todo":
            new_owner = "—"
        elif status in ("in-progress", "review", "blocked"):
            new_owner = agent_id

        t = db.update_ticket(
            project_slug,
            code,
            TicketUpdate(
                status=status,  # type: ignore
                owner=new_owner,
                branch_name=branch_name,
                worktree_path=worktree_path,
                pr_url=pr_url,
                commit_sha=commit_sha,
                exactness_level=exactness_level,
                blocked_reason=blocked_reason,
                is_held=is_held,
            ),
        )
        unblocked = t.get("newly_unblocked_tickets")
        held_reminder = t.get("held_locks_reminder")

        if note_md:
            t = db.add_ticket_note(
                project_slug,
                code,
                NoteCreate(author=agent_id, kind=note_kind, content_md=note_md),  # type: ignore
            )
            if unblocked is not None:
                t["newly_unblocked_tickets"] = unblocked
            if held_reminder is not None:
                t["held_locks_reminder"] = held_reminder

        if release_locks and held_reminder:
            released: list[str] = []
            for lock_name in list(held_reminder):
                try:
                    db.release_lock(lock_name, agent_id)
                    released.append(lock_name)
                    event_hub.notify_sync("lock_updated", {"name": lock_name})
                except ValueError:
                    pass
            t["released_locks"] = released
            t.pop("held_locks_reminder", None)

        if status is not None and status != prev_status:
            auto_disp = trigger_lane_auto_dispatch(db, project_slug, t, previous_status=prev_status)
            if auto_disp:
                t["auto_dispatch"] = auto_disp
                event_hub.notify_sync("lane_auto_dispatched", {"project_slug": project_slug, "code": code, **auto_disp})

        event_hub.notify_sync("ticket_updated", {"project_slug": project_slug, "code": code})
        return t

    @mcp.tool()
    def inspect_review_ticket(
        project_slug: str,
        code: str,
        reviewer_agent_id: str = "",
    ) -> dict[str, Any]:
        """
        Call first when picking up a 'review' ticket under the Code Review Skill (`skill://{project_slug}/CODE_REVIEW_SKILL.md`).
        Returns the ticket metadata (`branch_name`, `worktree_path`, `pr_url`, `commit_sha`, `done_when_md`, notes),
        `git diff main...<branch_name>`, automated static pre-scan warnings (`code_warnings`, `security_warnings`),
        and the resolved `lane_routing_plan` (model, skills, and self-review check).
        """
        proj = db.get_project(project_slug)
        if not proj:
            raise ValueError(f"Project '{project_slug}' not found")
        t = db.get_ticket(project_slug, code)
        if not t:
            raise ValueError(f"Ticket '{code}' not found in project '{project_slug}'")
        scan = inspect_review_branch_and_static_scan(proj, t)
        scan["notes"] = t.get("notes", [])
        scan["lane_routing_plan"] = _compute_lane_plan(
            project_slug,
            lane="review",
            agent_id=reviewer_agent_id,
            ticket_owner=t.get("owner"),
        )
        return scan

    @mcp.tool()
    def review_ticket(
        project_slug: str,
        code: str,
        reviewer_agent_id: str,
        verdict: str = "approve",
        review_md: str = "",
        reviewer_model: str = "claude-sonnet-4-5",
        code_issues: Optional[list[str]] = None,
        security_issues: Optional[list[str]] = None,
        exactness_level: Optional[str] = None,
        commit_sha: Optional[str] = None,
        merge_if_clean: bool = True,
    ) -> dict[str, Any]:
        """
        Submit a Code & Security Review using a mid-tier model (`reviewer_model`: e.g. 'claude-sonnet-4-5', 'gemini-2.5-flash', 'o4-mini').
        - Pass any discovered code bugs/regressions in `code_issues` and security vulnerabilities in `security_issues`.
        - Strict Gate: If `code_issues` or `security_issues` is non-empty, merging is automatically blocked,
          `verdict` becomes `'request-changes'`, and the ticket returns to `'in-progress'`.
        - If ZERO `code_issues` and ZERO `security_issues` are found and `verdict == 'approve'`:
          automatically merges the MR/PR or git branch into `main` (when `merge_if_clean=True` and lane policy allows),
          marks the ticket `'done'`, posts to `#reviews`, and returns `newly_unblocked_tickets`.
        """
        if verdict not in ("approve", "request-changes", "comment"):
            raise ValueError("verdict must be 'approve', 'request-changes', or 'comment'")
        c_list = [i.strip() for i in (code_issues or []) if i and i.strip()]
        s_list = [i.strip() for i in (security_issues or []) if i and i.strip()]
        is_clean = len(c_list) == 0 and len(s_list) == 0

        proj = db.get_project(project_slug)
        rev_lane_cfg = ((proj or {}).get("effective_lanes") or {}).get("review") or {}
        human_gate = rev_lane_cfg.get("review_merge_policy") == "human-gate"
        should_merge = is_clean and verdict == "approve" and merge_if_clean and not human_gate

        merge_info: Optional[dict[str, Any]] = None
        if should_merge:
            t = db.get_ticket(project_slug, code)
            if proj and t:
                merge_info = merge_ticket_branch_or_pr(proj, t)

        res = db.review_ticket(
            project_slug=project_slug,
            code=code,
            reviewer_agent_id=reviewer_agent_id,
            verdict=verdict,
            review_md=review_md,
            reviewer_model=reviewer_model,
            code_issues=c_list,
            security_issues=s_list,
            exactness_level=exactness_level,
            commit_sha=commit_sha,
            merge_info=merge_info,
            hold_in_review=(is_clean and verdict == "approve" and human_gate),
        )
        event_hub.notify_sync("ticket_updated", {"project_slug": project_slug, "code": code})
        return res

    @mcp.tool()
    def create_todo_ticket(
        project_slug: str,
        code: str,
        title: str,
        section_code: str = "1",
        depends_on: Optional[list[str]] = None,
        files_md: str = "",
        do_md: str = "",
        done_when_md: str = "",
        author: str = "agent",
    ) -> dict[str, Any]:
        """
        Create a concrete follow-up 'todo' ticket directly in a board section (e.g. when splitting a task
        or adding a follow-up ticket discovered during implementation).
        """
        t = db.create_ticket(
            project_slug,
            TicketCreate(
                code=code,
                title=title,
                section_code=section_code,
                status="todo",
                triage_state="approved",
                depends_on=depends_on or [],
                files_md=files_md,
                do_md=do_md,
                done_when_md=done_when_md,
                initial_note_author=author,
            ),
        )
        event_hub.notify_sync("ticket_created", {"project_slug": project_slug, "code": t["code"]})
        return t

    @mcp.tool()
    def append_ticket_note(
        project_slug: str,
        code: str,
        author: str,
        content_md: str,
        kind: str = "note",
    ) -> dict[str, Any]:
        """
        Append a note, review, or flag to any ticket without altering its status or owner.
        `kind` can be 'note', 'review', 'question', 'answer', or 'handoff'.
        """
        t = db.add_ticket_note(
            project_slug,
            code,
            NoteCreate(author=author, kind=kind, content_md=content_md),  # type: ignore
        )
        event_hub.notify_sync("ticket_note_added", {"project_slug": project_slug, "code": code})
        return t

    # ------------------------------------------------------------------
    # Triage & Grill Refinement Tools
    # ------------------------------------------------------------------
    @mcp.tool()
    def create_triage_ticket(
        project_slug: str,
        title: str,
        do_md: str = "",
        files_md: str = "",
        research_type: str = "external-scan",
        external_ref: str = "",
        author: str = "user",
        code: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Create a new 'triage' ticket for an agent to research, grill, and break down.
        `research_type` can be:
          - 'external-scan': "X is using Y to do Z, let's look into that"
          - 'feature-research': "Research into this feature / bottleneck"
          - 'bug-investigation': "Unexpected behavior / root-cause investigation"
        """
        structured_do = do_md.strip()
        if external_ref.strip():
            structured_do = f"**External Source / Reference:** `{external_ref.strip()}`\n\n{structured_do}".strip()
        if not structured_do:
            if research_type == "external-scan":
                structured_do = (
                    "1. Inspect the external reference/implementation and compare against our codebase.\n"
                    "2. Check hardware/roofline applicability, exactness impact, and whether this is worth building (`not-worth-it` if negative ROI).\n"
                    "3. Right-size any proposed breakdown (1 ticket if 1-2 files / <150 LOC; split only across distinct layers or disjoint parallel files).\n"
                    "4. Write every proposed TODO with mid-range-worker-ready detail: exact Modify/Reference paths in `files_md`, exact signatures + step-by-step blueprint + Out-of-Scope guardrails in `do_md`, and runnable verification commands in `done_when_md`."
                )
            else:
                structured_do = (
                    "1. Research the feature/bottleneck in the codebase, Hindsight, and graphify.\n"
                    "2. Resolve all ambiguities via `ask_triage_questions` before proposing work — leave zero open design guesses for workers.\n"
                    "3. Right-size the breakdown (avoid over-decomposition: 1 ticket if <150 LOC / 1-2 files) and populate worker-ready `files_md` (exact paths), `do_md` (exact signatures, edit steps, Out-of-Scope boundaries), and `done_when_md` (runnable test commands)."
                )

        done_when = (
            "Research findings recorded (source analyzed, codebase mapping, estimated gain, exactness impact) "
            "and either promoted to TODO ticket(s), cross-posted to an existing ticket, or closed as not worth doing."
        )

        t = db.create_ticket(
            project_slug,
            TicketCreate(
                code=code,
                title=title,
                status="triage",
                triage_state="new",
                do_md=structured_do,
                done_when_md=done_when,
                files_md=files_md,
                initial_note_author=author,
            ),
        )
        event_hub.notify_sync("ticket_created", {"project_slug": project_slug, "code": t["code"]})
        return t

    @mcp.tool()
    def submit_triage_research_findings(
        project_slug: str,
        triage_code: str,
        agent_id: str,
        findings_md: str,
        estimated_gain: str = "",
        exactness_impact: str = "exact",
        recommendation: str = "propose-todos",
        attach_to_ticket_codes: Optional[list[str]] = None,
        proposals: Optional[list[dict[str, Any]]] = None,
        auto_promote: bool = False,
    ) -> dict[str, Any]:
        """
        Record structured research findings for a 'triage' ticket ("research into feature" or "X uses Y to do Z").
        `recommendation`:
          - 'propose-todos': Propose 1 or more actionable TODO sub-tickets in `proposals`.
          - 'attach-to-existing': Cross-post these findings onto existing board tickets in `attach_to_ticket_codes` (e.g. ['B1', 'B6']) and close the triage ticket.
          - 'not-worth-it': Close the triage ticket as investigated & rejected so future agents do not redo it.
          - 'needs-decision': Post findings and set `triage_state = 'needs-info'` for user decision.
        """
        report_lines = [
            f"### Research Findings (`{recommendation}`)",
        ]
        if estimated_gain:
            report_lines.append(f"- **Estimated Gain / Roofline Impact:** {estimated_gain}")
        if exactness_impact:
            report_lines.append(f"- **Exactness Rule Impact:** `{exactness_impact}`")
        if attach_to_ticket_codes:
            report_lines.append(
                f"- **Cross-Posted to Board Tickets:** {', '.join(f'`{c}`' for c in attach_to_ticket_codes)}"
            )
        report_lines.append("")
        report_lines.append(findings_md.strip())
        full_report = "\n".join(report_lines)

        db.add_ticket_note(
            project_slug,
            triage_code,
            NoteCreate(
                author=agent_id,
                kind="question" if recommendation == "needs-decision" else "note",
                content_md=full_report,
            ),
        )

        # Cross-post onto existing board tickets (just like kimi-ext-scan in BOARD.md)
        cross_posted: list[str] = []
        for target_code in attach_to_ticket_codes or []:
            try:
                db.add_ticket_note(
                    project_slug,
                    target_code,
                    NoteCreate(
                        author=agent_id,
                        kind="note",
                        content_md=f"**External Scan / Triage `{triage_code}` Findings:**\n{full_report}",
                    ),
                )
                cross_posted.append(target_code)
            except ValueError:
                pass

        if proposals:
            parsed_items = [
                ProposalItemCreate(
                    code=p["code"],
                    title=p["title"],
                    section_code=p.get("section_code", "1"),
                    depends_on=p.get("depends_on", []),
                    files_md=p.get("files_md", ""),
                    do_md=p.get("do_md", ""),
                    done_when_md=p.get("done_when_md", ""),
                    rationale_md=p.get("rationale_md", estimated_gain),
                )
                for p in proposals
            ]
            proj_for_triage = db.get_project(project_slug) or {}
            triage_lane_cfg = (proj_for_triage.get("effective_lanes") or {}).get("triage") or {}
            effective_auto_promote = bool(auto_promote) or (
                triage_lane_cfg.get("triage_breakdown_policy") == "auto-promote-todo"
            )
            res = db.propose_todo_tickets(
                project_slug,
                triage_code,
                ProposeTicketsRequest(
                    proposed_by=agent_id,
                    proposals=parsed_items,
                    auto_promote=effective_auto_promote,
                ),
            )
        elif recommendation in ("attach-to-existing", "not-worth-it"):
            res = db.update_ticket(
                project_slug,
                triage_code,
                TicketUpdate(status="done", triage_state="approved", owner=agent_id),
            )
            if recommendation == "not-worth-it":
                db.post_message(
                    project_slug,
                    MessageCreate(
                        author=agent_id,
                        channel="general",
                        title=f"Investigated & Rejected ({triage_code}): Do Not Redo",
                        body_md=full_report,
                        ticket_code=triage_code,
                    ),
                )
        elif recommendation == "needs-decision":
            res = db.update_ticket(
                project_slug,
                triage_code,
                TicketUpdate(triage_state="needs-info", owner=agent_id),
            )
        else:
            res = db.get_ticket(project_slug, triage_code)  # type: ignore

        event_hub.notify_sync("ticket_updated", {"project_slug": project_slug, "code": triage_code})
        res["cross_posted_to"] = cross_posted
        return res

    @mcp.tool()
    def claim_triage_ticket(project_slug: str, code: str, agent_id: str) -> dict[str, Any]:
        """Claim a 'triage' ticket to begin researching, refining, or grilling for more info."""
        t = db.claim_triage_ticket(project_slug, code, agent_id)
        t["lane_routing_plan"] = _compute_lane_plan(project_slug, lane="triage", agent_id=agent_id)
        event_hub.notify_sync("ticket_updated", {"project_slug": project_slug, "code": code})
        return t

    @mcp.tool()
    def ask_triage_questions(
        project_slug: str,
        code: str,
        agent_id: str,
        questions_md: str,
    ) -> dict[str, Any]:
        """
        Post clarifying questions on a 'triage' ticket and set `triage_state = 'needs-info'`
        so the user can answer in the WebUI before sub-tickets are finalized.
        """
        t = db.ask_triage_questions(project_slug, code, agent_id, questions_md)
        event_hub.notify_sync("ticket_note_added", {"project_slug": project_slug, "code": code})
        return t

    @mcp.tool()
    def propose_todo_tickets(
        project_slug: str,
        triage_code: str,
        agent_id: str,
        proposals: list[dict[str, Any]],
        auto_promote: bool = False,
    ) -> dict[str, Any]:
        """
        Break down a 'triage' ticket into 1 or more worker-ready TODO sub-ticket proposals sized for mid-range or local implementer models.
        Right-Sizing Guardrail: Emit 1 ticket for cohesive 1-2 file changes (<150 LOC); split into 2-5 dependency-ordered tickets ONLY across distinct layers or disjoint parallel file sets.
        Each item in `proposals` MUST be unambiguous for a mid-range coder:
          - `code` (str, e.g. 'Q16')
          - `title` (str)
          - `section_code` (str, default '1')
          - `depends_on` (list[str], optional upstream ticket codes)
          - `files_md` (str: exact Modify/Create file paths + Reference files to mirror; zero parallel write overlap)
          - `do_md` (str: exact function/type signatures, numbered step-by-step edit plan, pre-decided edge cases, and explicit 'Out-of-Scope / Do NOT Touch' boundaries)
          - `done_when_md` (str: exact runnable verification command(s) + concrete expected output assertions)
          - `rationale_md` (str: architectural reason & scope boundary justification)
        Set `auto_promote=True` to immediately create the TODO tickets on the board;
        otherwise `triage_state` becomes `'proposed'` for user approval in the WebUI.
        """
        parsed_items = [
            ProposalItemCreate(
                code=p["code"],
                title=p["title"],
                section_code=p.get("section_code", "1"),
                depends_on=p.get("depends_on", []),
                files_md=p.get("files_md", ""),
                do_md=p.get("do_md", ""),
                done_when_md=p.get("done_when_md", ""),
                rationale_md=p.get("rationale_md", ""),
            )
            for p in proposals
        ]
        res = db.propose_todo_tickets(
            project_slug,
            triage_code,
            ProposeTicketsRequest(
                proposed_by=agent_id,
                proposals=parsed_items,
                auto_promote=auto_promote,
            ),
        )
        event_hub.notify_sync("triage_proposals_updated", {"project_slug": project_slug, "code": triage_code})
        return res

    # ------------------------------------------------------------------
    # Flexible Feature Locks & Wait Queue Tools
    # ------------------------------------------------------------------
    @mcp.tool()
    def list_locks(project_slug: Optional[str] = None) -> list[dict[str, Any]]:
        """List all feature/GPU locks (e.g. 'gpu:xeres', 'gpu:sunny', 'gpu:shodan'), active holders, and wait queues."""
        return db.list_locks(project_slug=project_slug)

    @mcp.tool()
    def create_or_configure_lock(
        lock_name: str,
        max_slots: int = 1,
        description: str = "",
        project_slug: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create or configure a named feature mutex (`max_slots=1`) or multi-slot semaphore (`max_slots>1`)."""
        lk = db.upsert_lock(
            LockCreate(
                name=lock_name,
                project_slug=project_slug,
                max_slots=max_slots,
                description=description,
            )
        )
        event_hub.notify_sync("lock_updated", {"name": lock_name})
        return lk

    @mcp.tool()
    def acquire_lock(
        lock_name: str,
        agent_id: str,
        reason: str,
        expected_minutes: int = 30,
        ticket_code: str = "",
        enqueue_if_busy: bool = True,
    ) -> dict[str, Any]:
        """
        Atomically acquire a named lock (e.g. 'gpu:xeres').
        If all slots are busy and `enqueue_if_busy=True`, places `agent_id` in the FIFO wait queue
        and returns `acquired=False, claim_status='queued', queue_position=...`.
        """
        res = db.acquire_lock(
            lock_name,
            LockAcquireRequest(
                agent_id=agent_id,
                reason=reason,
                expected_minutes=expected_minutes,
                ticket_code=ticket_code,
                enqueue_if_busy=enqueue_if_busy,
            ),
        )
        event_hub.notify_sync("lock_updated", {"name": lock_name})
        return res

    @mcp.tool()
    def release_lock(lock_name: str, agent_id: str) -> dict[str, Any]:
        """Release a held or queued lock and automatically promote the next agent in the wait queue."""
        res = db.release_lock(lock_name, agent_id)
        event_hub.notify_sync("lock_updated", {"name": lock_name})
        return res

    @mcp.tool()
    def heartbeat_lock(lock_name: str, agent_id: str, extend_minutes: int = 15) -> dict[str, Any]:
        """Extend the lease TTL on a currently held lock."""
        res = db.heartbeat_lock(lock_name, agent_id, extend_minutes=extend_minutes)
        event_hub.notify_sync("lock_updated", {"name": lock_name})
        return res

    # ------------------------------------------------------------------
    # Agent Heartbeat, Co-Worker Roster, Quota Exhaustion & Message Board
    # ------------------------------------------------------------------
    @mcp.tool()
    def heartbeat_agent(
        project_slug: str,
        agent_id: str,
        status: str = "active",
        current_ticket_code: Optional[str] = None,
        worktree_path: str = "",
        branch_name: str = "",
        handoff_note: str = "",
    ) -> dict[str, Any]:
        """
        Register or update `agent_id`'s live presence, active ticket, and worktree/branch on the board.
        """
        ag = db.upsert_agent(
            AgentUpsertRequest(
                project_slug=project_slug,
                agent_id=agent_id,
                status=status,  # type: ignore
                current_ticket_code=current_ticket_code,
                worktree_path=worktree_path,
                branch_name=branch_name,
                handoff_note=handoff_note,
            )
        )
        event_hub.notify_sync("agent_updated", {"agent_id": agent_id})
        return ag

    @mcp.tool()
    def list_active_agents(project_slug: Optional[str] = None) -> list[dict[str, Any]]:
        """List all registered agents on the project, their active ticket, worktree, and held locks."""
        slug = resolve_slug(project_slug)
        return db.list_agents(project_slug=slug)

    @mcp.tool()
    def report_agent_usage_exhausted(
        project_slug: str,
        agent_id: str,
        handoff_summary_md: str,
        usage_reset_at: Optional[str] = None,
        release_ticket: bool = True,
        branch_name: Optional[str] = None,
        worktree_path: Optional[str] = None,
        commit_sha: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Call when an agent runs out of usage/quota or must pause mid-task.
        Automatically releases all locks held by `agent_id`, writes a structured handoff note
        with branch/worktree/commit SHA to its ticket, transitions the ticket to 'blocked'
        (with reason indicating quota exhaustion awaiting handover), and posts a handoff announcement to #agents.
        """
        res = db.report_agent_usage_exhausted(
            AgentUsageExhaustedRequest(
                project_slug=project_slug,
                agent_id=agent_id,
                usage_reset_at=usage_reset_at,
                handoff_summary_md=handoff_summary_md,
                release_ticket=release_ticket,
                branch_name=branch_name,
                worktree_path=worktree_path,
                commit_sha=commit_sha,
            )
        )
        event_hub.notify_sync("agent_usage_exhausted", res)
        return res

    @mcp.tool()
    def post_message(
        project_slug: str,
        author: str,
        title: str,
        body_md: str,
        channel: str = "agents",
        ticket_code: str = "",
        pinned: bool = False,
        parent_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Post a message or thread reply to the project's Agent Message Board.
        Channels: 'agents' (shared project coordination, coding, testing, GPU requests, handoffs),
        'reviews', 'gbs' (watercooler / co-worker banter & random thoughts).
        Set `parent_id` to start or reply to a specific message thread.
        """
        msg = db.post_message(
            project_slug,
            MessageCreate(
                author=author,
                channel=channel,
                title=title,
                body_md=body_md,
                ticket_code=ticket_code,
                pinned=pinned,
                parent_id=parent_id,
            ),
        )
        event_hub.notify_sync("message_posted", {"project_slug": project_slug, "message": msg})
        return msg

    @mcp.tool()
    def list_messages(
        project_slug: Optional[str] = None,
        channel: Optional[str] = None,
        limit: int = 25,
        parent_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Read messages from the project's Agent Message Board, including thread replies."""
        slug = resolve_slug(project_slug)
        return db.list_messages(project_slug=slug, channel=channel, limit=limit, parent_id=parent_id)

    @mcp.tool()
    def scan_a2a_agents(
        extra_endpoints: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        """
        Scan for active A2A-compatible agents and return their A2A Agent Cards (`/.well-known/agent.json`),
        endpoint URLs, capabilities, skills, and live activity state.
        """
        profiles = discover_agent_profiles(db, extra_a2a_endpoints=extra_endpoints)
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "provider": p["provider"],
                "activity_state": p["activity_state"],
                "mounted": p["mounted"],
                "a2a_card": p.get("a2a_card"),
            }
            for p in profiles
        ]

    @mcp.tool()
    def check_watchdog(
        project_slug: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Check for stalled agent tasks across the board.
        Releases held locks and marks silent tasks as `blocked` for peer recovery.
        """
        slug = resolve_slug(project_slug) if project_slug else None
        return run_watchdog_cycle(db, project_slug=slug)

    @mcp.tool()
    def trigger_autorunner_step(
        project_slug: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Execute one cycle of the Overnight Auto-Runner:
        Auto-merges clean approved reviews into `done`, auto-dispatches adversarial reviewers,
        and dispatches unblocked TODO tasks up to concurrency capacity.
        """
        slug = resolve_slug(project_slug)
        return run_auto_runner_cycle(db, project_slug=slug)

    # ------------------------------------------------------------------
    # MCP Resources & Prompt Templates
    # ------------------------------------------------------------------
    @mcp.resource("skill://{project_slug}/SKILL.md")
    def skill_resource(project_slug: str) -> str:
        """Dynamically generated SKILL.md for agents working on `project_slug`."""
        proj = db.get_project(project_slug)
        if not proj:
            return f"# Error: Project '{project_slug}' not found"
        return render_skill_md(proj)

    @mcp.resource("skill://{project_slug}/CODE_REVIEW_SKILL.md")
    def code_review_skill_resource(project_slug: str) -> str:
        """Dynamically generated Code & Security Review SKILL.md (mid-tier model review + merge gate)."""
        proj = db.get_project(project_slug)
        if not proj:
            return f"# Error: Project '{project_slug}' not found"
        return render_code_review_skill_md(proj)

    @mcp.resource("skill://global/{skill_id}/SKILL.md")
    def global_managed_skill_resource(skill_id: str) -> str:
        """Managed global role skill (e.g. business-analysis, qa-verification, security-code-review)."""
        gs = db.get_global_settings()
        catalog = discover_unified_skills(gs, project=None, profiles=discover_agent_profiles(db))
        hit = next((s for s in catalog if s["id"] == skill_id), None)
        if not hit or not hit.get("content_md"):
            return f"# Error: Skill '{skill_id}' not found"
        return str(hit["content_md"])

    @mcp.resource("skill://{project_slug}/skills/{skill_id}/SKILL.md")
    def project_custom_skill_resource(project_slug: str, skill_id: str) -> str:
        """Project-scoped custom or global role skill."""
        proj = db.get_project(project_slug)
        gs = db.get_global_settings()
        catalog = discover_unified_skills(gs, project=proj, profiles=discover_agent_profiles(db))
        hit = next((s for s in catalog if s["id"] == skill_id), None)
        if not hit or not hit.get("content_md"):
            return f"# Error: Skill '{skill_id}' not found in project '{project_slug}'"
        return str(hit["content_md"])

    @mcp.resource("board://{project_slug}/summary.md")
    def board_summary_resource(project_slug: str) -> str:
        """Compact Markdown summary of locks, in-progress tasks, review queue, and claimable TODOs."""
        bundle = db.get_onboarding_bundle(project_slug, compact=True)
        lines = [
            f"# {bundle['project']['name']} (`{project_slug}`) — Live Board Summary",
            "",
            "## Active Feature & GPU Locks",
        ]
        for lk in bundle["locks"]:
            holders = ", ".join(f"`{c['agent_id']}` ({c['ticket_code'] or c['reason']})" for c in lk["active_claims"]) or "FREE"
            q_cnt = len(lk["wait_queue"])
            lines.append(f"- **`{lk['name']}`** ({lk['status']}): {holders}" + (f" | Wait queue: {q_cnt}" if q_cnt else ""))
        lines.extend(["", "## In-Progress Tickets"])
        for t in bundle["in_progress_tickets"]:
            lines.append(f"- **`{t['code']}`** ({t['owner']} on `{t['branch_name']}`): {t['title']} — Files: {t['files_md']}")
        lines.extend(["", "## Review Queue"])
        for t in bundle["review_tickets"]:
            lines.append(f"- **`{t['code']}`** ({t['owner']}, commit `{t['commit_sha']}`): {t['title']}")
        lines.extend(["", "## Claimable TODO Tickets (Dependencies Satisfied)"])
        for t in bundle["claimable_todo_tickets"]:
            lines.append(f"- **`{t['code']}`** [Sec {t['section_code']}]: {t['title']} — Files: {t['files_md']}")
        return "\n".join(lines)

    @mcp.resource("board://{project_slug}/background.md")
    def board_background_resource(project_slug: str) -> str:
        """Hardware baselines, historical benchmarks, and 'Measured & Rejected — Do Not Redo' log."""
        proj = db.get_project(project_slug)
        if not proj:
            return f"# Error: Project '{project_slug}' not found"
        return proj.get("board_background_md") or "# No background notes recorded."

    @mcp.prompt()
    def start_next_task(project_slug: Optional[str] = None, agent_id: str = "agent-1") -> str:
        """Prompt workflow for an agent to onboard, claim the next unblocked TODO ticket with a worktree, and begin work."""
        slug = resolve_slug(project_slug)
        return (
            f"1. Call `get_project_onboarding(project_slug='{slug}', compact=True)` to inspect active locks and claimable tickets.\n"
            f"2. Call `pick_next_todo(project_slug='{slug}', agent_id='{agent_id}', auto_create_worktree=True)` (or `claim_ticket` for a specific code).\n"
            f"3. Check `concurrent_file_overlap_warnings` on the returned ticket and run `search_board` on key terms so you don't repeat a 'Measured & Rejected' idea.\n"
            f"4. Work inside the provisioned `worktree_path`, acquire any needed GPU lock (`acquire_lock`) only during actual benchmark/test execution, and call `update_ticket_progress(..., release_locks=True)` when moving to `review`."
        )

    @mcp.prompt()
    def triage_external_scan(
        project_slug: Optional[str] = None,
        triage_code: str = "T1",
        agent_id: str = "research-agent",
    ) -> str:
        """Prompt workflow for researching an 'X uses Y to do Z' or feature-research triage ticket."""
        slug = resolve_slug(project_slug)
        return (
            f"1. Call `claim_triage_ticket(project_slug='{slug}', code='{triage_code}', agent_id='{agent_id}')`.\n"
            f"2. Call `search_board(project_slug='{slug}', query=...)` to check if this technique or file area was already investigated or is part of an existing ticket.\n"
            f"3. Inspect the external reference and compare it against our codebase, hardware/roofline limits, and exactness rules.\n"
            f"4. Call `submit_triage_research_findings` with `recommendation` set to `'propose-todos'`, `'attach-to-existing'`, `'not-worth-it'`, or `'needs-decision'`."
        )

    @mcp.prompt()
    def peer_review_ticket(
        project_slug: Optional[str] = None,
        ticket_code: str = "R2",
        agent_id: str = "reviewer-agent",
        reviewer_model: str = "claude-sonnet-4-5",
    ) -> str:
        """Prompt workflow for picking up a 'review' ticket with a mid-tier model, checking code & security issues, and merging if clean."""
        slug = resolve_slug(project_slug)
        return (
            f"1. Read `skill://{slug}/CODE_REVIEW_SKILL.md` and use a mid-tier model (`{reviewer_model}`, `gemini-2.5-flash`, or `o4-mini`).\n"
            f"2. Call `inspect_review_ticket(project_slug='{slug}', code='{ticket_code}')` to inspect the branch diff (`git diff main...<branch>`), static pre-scan warnings, `done_when_md`, and notes.\n"
            f"3. Audit every changed file for `code_issues` (logic bugs, missing tests, exactness drift) and `security_issues` (secrets, unsafe memory/pointer bounds, command/path injection).\n"
            f"4. Call `review_ticket(project_slug='{slug}', code='{ticket_code}', reviewer_agent_id='{agent_id}', reviewer_model='{reviewer_model}', verdict='approve' | 'request-changes', code_issues=[...], security_issues=[...], review_md=..., merge_if_clean=True)`."
        )

    return mcp
