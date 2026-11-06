from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


TicketStatus = Literal["triage", "todo", "in-progress", "review", "blocked", "done"]
TriageState = Literal["new", "researching", "needs-info", "proposed", "approved"]
NoteKind = Literal["note", "review", "question", "answer", "handoff", "system"]
ProposalStatus = Literal["pending", "approved", "rejected"]
AgentStatus = Literal["active", "idle", "out-of-usage", "offline"]
LockClaimStatus = Literal["held", "queued", "released", "expired"]


class SkillContextRow(BaseModel):
    task_area: str
    board_ids: str
    read_files: str


class SkillConfig(BaseModel):
    skill_name: str = "project-board"
    description: str = "How to pick up, work and hand back a task from the shared project board via MCP without clashing with other agents."
    board_path_note: str = ""
    background_report_path: str = ""
    research_notes_path: str = ""
    hindsight_url: str = "http://10.1.1.4:8888/mcp"
    local_memory_dir: str = ""
    memory_table: list[SkillContextRow] = Field(default_factory=list)
    graphify_graph_path: str = ""
    custom_rules_md: str = ""
    skill_output_path: str = ""


ConfigurableLane = Literal["triage", "todo", "in-progress", "review", "blocked"]
TriageBreakdownPolicy = Literal["stage-for-approval", "auto-promote-todo"]
ReviewMergePolicy = Literal["auto-merge-clean", "human-gate"]


class CustomModelSpec(BaseModel):
    id: str
    name: str
    tier: str = "custom"
    supports_effort: bool = True
    effort_levels: list[str] = Field(default_factory=lambda: ["low", "medium", "high"])
    default_effort: Optional[str] = "medium"


class ManagedSkillSpec(BaseModel):
    id: str
    name: str
    description: str = ""
    lane_tags: list[str] = Field(default_factory=list)
    content_md: str = ""
    built_in: bool = False


class SystemOneConfig(BaseModel):
    enabled: bool = False
    url: str = "https://api.typesafe.ai"
    api_key: Optional[str] = None
    model: str = "jev-latest"
    timeout_seconds: float = 5.0


class AgentLaneRule(BaseModel):
    agent_key: str
    agent_label: str = ""
    model: str = ""
    effort: str = ""
    skills: list[str] = Field(default_factory=list)
    custom_instructions: str = ""
    enabled: bool = True
    use_systemone: bool = False


class LaneConfig(BaseModel):
    inherit_global: bool = True
    auto_dispatch: bool = False
    preferred_agent: str = ""
    fallback_agent: str = ""
    prevent_self_review: bool = True
    triage_breakdown_policy: TriageBreakdownPolicy = "stage-for-approval"
    review_merge_policy: ReviewMergePolicy = "auto-merge-clean"
    default_skills: list[str] = Field(default_factory=list)
    agent_rules: dict[str, AgentLaneRule] = Field(default_factory=dict)


class ProjectSettings(BaseModel):
    branch_prefix: str = "board/"
    token_ceiling_override: Optional[int] = None
    require_verification_cmd: str = ""
    auto_create_worktree: Optional[bool] = None
    dispatch_via_a2a: Optional[bool] = None
    lane_configs: dict[str, LaneConfig] = Field(default_factory=dict)
    custom_skills: list[ManagedSkillSpec] = Field(default_factory=list)
    systemone_config: Optional[SystemOneConfig] = None


class GlobalSettings(BaseModel):
    mcp_url: str = "http://localhost:8765/mcp"
    a2a_scan_endpoints: list[str] = Field(
        default_factory=lambda: ["http://localhost:8901", "http://localhost:8902"]
    )
    auto_scan_a2a: bool = True
    default_dispatch_via_a2a: bool = True
    default_auto_create_worktree: bool = True
    default_launch_subprocess: bool = False
    default_token_ceiling: int = 1_500_000
    hud_neuro_audio_armed_default: bool = False
    hud_neuro_volume: float = 0.78
    hud_pr_drop_enabled: bool = True
    fighter_avatars_enabled: Optional[bool] = None
    custom_models: dict[str, list[CustomModelSpec]] = Field(default_factory=dict)
    managed_skills: list[ManagedSkillSpec] = Field(default_factory=list)
    lane_configs: dict[str, LaneConfig] = Field(default_factory=dict)
    systemone_config: SystemOneConfig = Field(default_factory=SystemOneConfig)


class GlobalSettingsUpdate(BaseModel):
    mcp_url: Optional[str] = None
    a2a_scan_endpoints: Optional[list[str]] = None
    auto_scan_a2a: Optional[bool] = None
    default_dispatch_via_a2a: Optional[bool] = None
    default_auto_create_worktree: Optional[bool] = None
    default_launch_subprocess: Optional[bool] = None
    default_token_ceiling: Optional[int] = None
    hud_neuro_audio_armed_default: Optional[bool] = None
    hud_neuro_volume: Optional[float] = None
    hud_pr_drop_enabled: Optional[bool] = None
    fighter_avatars_enabled: Optional[bool] = None
    custom_models: Optional[dict[str, list[CustomModelSpec]]] = None
    managed_skills: Optional[list[ManagedSkillSpec]] = None
    lane_configs: Optional[dict[str, LaneConfig]] = None
    systemone_config: Optional[SystemOneConfig] = None


class ProjectCreate(BaseModel):
    slug: str
    name: str
    description: str = ""
    repo_path: str = ""
    worktrees_dir: str = ""
    board_background_md: str = ""
    skill_config: Optional[SkillConfig] = None
    project_settings: Optional[ProjectSettings] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    repo_path: Optional[str] = None
    worktrees_dir: Optional[str] = None
    board_background_md: Optional[str] = None
    skill_config: Optional[SkillConfig] = None
    project_settings: Optional[ProjectSettings] = None


class SectionCreate(BaseModel):
    code: str
    title: str
    description_md: str = ""
    position: Optional[int] = None


class TicketCreate(BaseModel):
    code: Optional[str] = None
    title: str
    section_code: Optional[str] = None
    status: TicketStatus = "triage"
    triage_state: Optional[TriageState] = "new"
    owner: Optional[str] = None
    depends_on: list[str] = Field(default_factory=list)
    files_md: str = ""
    do_md: str = ""
    done_when_md: str = ""
    blocked_reason: str = ""
    branch_name: str = ""
    worktree_path: str = ""
    pr_url: str = ""
    commit_sha: str = ""
    exactness_level: str = ""
    parent_ticket_id: Optional[str] = None
    is_held: bool = False
    initial_note_md: Optional[str] = None
    initial_note_author: str = "user"


class TicketUpdate(BaseModel):
    code: Optional[str] = None
    title: Optional[str] = None
    section_code: Optional[str] = None
    status: Optional[TicketStatus] = None
    triage_state: Optional[TriageState] = None
    owner: Optional[str] = None
    depends_on: Optional[list[str]] = None
    files_md: Optional[str] = None
    do_md: Optional[str] = None
    done_when_md: Optional[str] = None
    blocked_reason: Optional[str] = None
    branch_name: Optional[str] = None
    worktree_path: Optional[str] = None
    pr_url: Optional[str] = None
    commit_sha: Optional[str] = None
    exactness_level: Optional[str] = None
    is_held: Optional[bool] = None
    position: Optional[int] = None


class NoteCreate(BaseModel):
    author: str
    kind: NoteKind = "note"
    content_md: str


class ProposalItemCreate(BaseModel):
    code: str
    title: str
    section_code: str = "1"
    depends_on: list[str] = Field(default_factory=list)
    files_md: str = ""
    do_md: str = ""
    done_when_md: str = ""
    rationale_md: str = ""


class ProposeTicketsRequest(BaseModel):
    proposed_by: str
    proposals: list[ProposalItemCreate]
    auto_promote: Optional[bool] = None


class TriageResearchFindingsRequest(BaseModel):
    agent_id: str = "research-agent"
    findings_md: str
    estimated_gain: str = ""
    exactness_impact: str = "exact"
    recommendation: Literal[
        "propose-todos",
        "propose-new-todos",
        "attach-to-existing",
        "not-worth-it",
        "needs-decision",
    ] = "attach-to-existing"
    attach_to_ticket_codes: list[str] = Field(default_factory=list)
    proposals: list[ProposalItemCreate] = Field(default_factory=list)
    auto_promote: Optional[bool] = None
    close_triage: bool = True


class LockCreate(BaseModel):
    name: str
    project_slug: Optional[str] = None
    max_slots: int = 1
    description: str = ""


class LockAcquireRequest(BaseModel):
    agent_id: str
    reason: str
    expected_minutes: int = 30
    ticket_code: str = ""
    enqueue_if_busy: bool = True


class LockReleaseRequest(BaseModel):
    agent_id: str


class LockHeartbeatRequest(BaseModel):
    agent_id: str
    extend_minutes: int = 15


class AgentUpsertRequest(BaseModel):
    agent_id: str
    project_slug: str
    status: AgentStatus = "active"
    current_ticket_code: Optional[str] = None
    worktree_path: Optional[str] = None
    branch_name: Optional[str] = None
    usage_reset_at: Optional[str] = None
    handoff_note: Optional[str] = None


class AgentUsageExhaustedRequest(BaseModel):
    project_slug: str
    agent_id: str
    usage_reset_at: Optional[str] = None
    handoff_summary_md: str
    release_ticket: bool = True
    branch_name: Optional[str] = None
    worktree_path: Optional[str] = None
    commit_sha: Optional[str] = None


class MessageCreate(BaseModel):
    author: str
    channel: str = "agents"
    title: str
    body_md: str
    ticket_code: str = ""
    pinned: bool = False
    parent_id: Optional[str] = None


class AgentProfileCreate(BaseModel):
    id: Optional[str] = None
    name: str
    provider: str = "custom"
    config_path: str
    cli_command: str = ""
    default_args: str = ""


class ClaimWithAgentRequest(BaseModel):
    agent_id: str
    profile_id: Optional[str] = None
    branch_name: str = ""
    worktree_path: str = ""
    model: Optional[str] = None
    effort: Optional[str] = None
    skills: Optional[list[str]] = None
    auto_create_worktree: bool = True
    launch_agent: bool = False
    dispatch_via_a2a: bool = True
    allow_review_deps: bool = True


class A2AScanRequest(BaseModel):
    endpoints: list[str] = Field(default_factory=list)
    project_slug: str = "default"


class InjectMcpConfigRequest(BaseModel):
    project_slug: str = "default"
    mcp_url: str = "http://localhost:8765/mcp"
    inject_skill: bool = True


class ReviewTicketRequest(BaseModel):
    reviewer_agent_id: str
    reviewer_model: str = "claude-sonnet-4-5"
    verdict: Literal["approve", "request-changes", "comment"] = "approve"
    code_issues: list[str] = Field(default_factory=list)
    security_issues: list[str] = Field(default_factory=list)
    review_md: str = ""
    exactness_level: Optional[str] = None
    commit_sha: Optional[str] = None
    merge_if_clean: bool = True


