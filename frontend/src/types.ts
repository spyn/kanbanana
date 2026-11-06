export type TicketStatus = 'triage' | 'todo' | 'in-progress' | 'review' | 'blocked' | 'done'
export type ConfigurableLane = 'triage' | 'todo' | 'in-progress' | 'review' | 'blocked'
export type TriageBreakdownPolicy = 'stage-for-approval' | 'auto-promote-todo'
export type ReviewMergePolicy = 'auto-merge-clean' | 'human-gate'
export type TriageState = 'new' | 'researching' | 'needs-info' | 'proposed' | 'approved'
export type NoteKind = 'note' | 'review' | 'question' | 'answer' | 'handoff' | 'system'

export interface CustomModelSpec {
  id: string
  name: string
  tier: string
  supports_effort: boolean
  effort_levels: string[]
  default_effort?: string | null
}

export interface ManagedSkillSpec {
  id: string
  name: string
  description: string
  lane_tags: string[]
  content_md: string
  built_in?: boolean
}

export interface SkillCatalogItem {
  id: string
  name: string
  description: string
  source: 'built-in' | 'global-custom' | 'project-custom' | 'project-generated' | 'repo' | 'agent-config' | 'a2a-card' | string
  lane_tags: string[]
  uri: string
  http_url?: string
  editable: boolean
  built_in: boolean
  installed_on_agents: string[]
  content_md: string
}

export interface SystemOneConfig {
  enabled: boolean
  url: string
  api_key?: string | null
  model: string
  timeout_seconds?: number
}

export interface AgentLaneRule {
  agent_key: string
  agent_label: string
  model: string
  effort: string
  skills: string[]
  custom_instructions: string
  enabled: boolean
  use_systemone?: boolean
  source?: 'global' | 'project'
}

export interface LaneConfig {
  inherit_global: boolean
  auto_dispatch: boolean
  preferred_agent: string
  fallback_agent: string
  prevent_self_review: boolean
  triage_breakdown_policy: TriageBreakdownPolicy
  review_merge_policy: ReviewMergePolicy
  default_skills: string[]
  agent_rules: Record<string, AgentLaneRule>
  lane_source?: 'global' | 'project'
}

export interface GiteaWebhookConfig {
  secret: string
  auto_transition_on_fixes: boolean
  auto_done_on_pr_merge: boolean
  dispatch_reviewer_on_pr?: boolean
}

export interface WatchdogConfig {
  enabled: boolean
  interval_seconds: number
  stall_threshold_minutes: number
  action: 'block' | 'reset-to-todo' | 'alert-only'
  auto_release_locks: boolean
}

export interface AutoRunnerConfig {
  enabled: boolean
  project_slug: string
  interval_seconds: number
  max_concurrent_workers: number
  auto_merge_clean_reviews: boolean
  token_ceiling: number
  circuit_breaker_tripped: boolean
  tripped_reason: string
  tokens_spent_session: number
  consecutive_failures: number
}

export interface AutoRunnerStatus {
  running: boolean
  project_slug: string
  last_run?: string | null
  last_result?: any
  tokens_spent_session: number
  consecutive_failures: number
  circuit_breaker_tripped: boolean
  tripped_reason: string
  config: AutoRunnerConfig
}

export interface GrillChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface GrillChatResponse {
  reply: string
  messages: GrillChatMessage[]
  suggested_quick_replies: string[]
  can_generate_proposals: boolean
  draft_proposals: TicketProposal[]
}

export interface ProjectSettings {
  branch_prefix: string
  token_ceiling_override?: number | null
  require_verification_cmd: string
  auto_create_worktree?: boolean | null
  dispatch_via_a2a?: boolean | null
  lane_configs: Record<string, LaneConfig>
  custom_skills: ManagedSkillSpec[]
  systemone_config?: SystemOneConfig | null
  gitea_webhook?: GiteaWebhookConfig
  watchdog?: WatchdogConfig
  autorunner?: AutoRunnerConfig
}

export interface GlobalSettings {
  mcp_url: string
  a2a_scan_endpoints: string[]
  auto_scan_a2a: boolean
  default_dispatch_via_a2a: boolean
  default_auto_create_worktree: boolean
  default_launch_subprocess: boolean
  default_token_ceiling: number
  hud_neuro_audio_armed_default: boolean
  hud_neuro_volume: number
  hud_pr_drop_enabled: boolean
  fighter_avatars_enabled?: boolean
  custom_models: Record<string, CustomModelSpec[]>
  managed_skills: ManagedSkillSpec[]
  lane_configs: Record<string, LaneConfig>
  systemone_config?: SystemOneConfig
  watchdog?: WatchdogConfig
  autorunner?: AutoRunnerConfig
  provider_model_catalog?: Record<string, A2AModelSpec[]>
  updated_at?: string | null
}

export interface ResolvedLaneRoutingPlan {
  lane: ConfigurableLane
  lane_source: 'global' | 'project'
  rule_matched: boolean
  rule_source?: 'global' | 'project' | null
  agent_id: string
  profile_id?: string | null
  agent_name: string
  model: string
  effort: string
  skill_ids: string[]
  skills: Array<{
    id: string
    name: string
    description: string
    source: string
    uri: string
    content_md: string
  }>
  custom_instructions: string
  auto_dispatch: boolean
  preferred_agent: string
  fallback_agent: string
  prevent_self_review: boolean
  self_review_prevented: boolean
  blocked_self_review_agent?: string | null
  triage_breakdown_policy: TriageBreakdownPolicy
  review_merge_policy: ReviewMergePolicy
  branch_prefix: string
  require_verification_cmd: string
  auto_create_worktree: boolean
  dispatch_via_a2a: boolean
  launch_subprocess: boolean
  effective_token_ceiling: number
  mcp_url: string
}

export interface SkillContextRow {
  task_area: string
  board_ids: string
  read_files: string
}

export interface SkillConfig {
  skill_name: string
  description: string
  board_path_note: string
  background_report_path: string
  research_notes_path: string
  hindsight_url: string
  local_memory_dir: string
  memory_table: SkillContextRow[]
  graphify_graph_path: string
  custom_rules_md: string
  skill_output_path: string
}

export interface Section {
  id: string
  project_id: string
  code: string
  title: string
  description_md: string
  position: number
}

export interface Project {
  id: string
  slug: string
  name: string
  description: string
  repo_path: string
  worktrees_dir?: string
  board_background_md: string
  skill_config: SkillConfig
  project_settings?: ProjectSettings
  effective_lanes?: Record<ConfigurableLane, LaneConfig>
  sections?: Section[]
  ticket_counts?: Record<string, number>
  created_at: string
}

export interface TicketNote {
  id: string
  ticket_id: string
  author: string
  kind: NoteKind
  content_md: string
  created_at: string
}

export interface TicketProposal {
  id: string
  triage_ticket_id: string
  proposed_by: string
  code: string
  title: string
  section_code: string
  depends_on: string[]
  files_md: string
  do_md: string
  done_when_md: string
  rationale_md: string
  status: 'pending' | 'approved' | 'rejected'
  created_ticket_id?: string | null
  created_at: string
}

export interface Ticket {
  id: string
  project_id: string
  section_id?: string | null
  section_code: string
  section_title: string
  code: string
  title: string
  status: TicketStatus
  triage_state: TriageState
  owner?: string | null
  depends_on: string[]
  dependency_statuses: Record<string, string>
  dependencies_satisfied: boolean
  dependencies_strictly_done: boolean
  files_md: string
  do_md: string
  done_when_md: string
  blocked_reason: string
  branch_name: string
  worktree_path: string
  pr_url: string
  commit_sha: string
  exactness_level: string
  parent_ticket_id?: string | null
  is_held?: boolean
  position: number
  updated_at: string
  created_at: string
  notes?: TicketNote[]
  note_count?: number
  proposals?: TicketProposal[]
}

export interface LockClaim {
  id: string
  lock_id: string
  agent_id: string
  ticket_code: string
  status: 'held' | 'queued' | 'released' | 'expired'
  reason: string
  acquired_at: string
  expires_at: string
  released_at?: string | null
}

export interface FeatureLock {
  id: string
  project_id?: string | null
  name: string
  max_slots: number
  available_slots: number
  status: 'free' | 'held'
  description: string
  active_claims: LockClaim[]
  wait_queue: LockClaim[]
  created_at: string
}

export interface AgentInfo {
  id: string
  project_id: string
  status: 'active' | 'idle' | 'out-of-usage' | 'offline'
  current_ticket_code?: string | null
  worktree_path: string
  branch_name: string
  usage_reset_at?: string | null
  handoff_note: string
  held_locks: string[]
  last_seen_at: string
}

export interface BoardMessage {
  id: string
  project_id: string
  author: string
  channel: string
  title: string
  body_md: string
  ticket_code: string
  pinned: number
  parent_id?: string | null
  reply_count?: number
  replies?: BoardMessage[]
  created_at: string
}

export interface AgentTranscriptEvent {
  timestamp: string
  kind: string
  status: string
  action?: 'read' | 'write' | 'exec' | 'mcp' | 'lock' | 'error' | 'step' | string
  tools: string[]
  files?: string[]
  commands?: string[]
  summary: string
}

export interface AgentTelemetryPoint {
  bucket: string
  tokens_per_min: number
  loc_per_min: number
}

export interface AgentUsageTelemetry {
  total_tokens: number
  total_loc: number
  tokens_per_min: number
  loc_per_min: number
  peak_tokens_per_min: number
  peak_loc_per_min: number
  token_budget: number
  quota_used_pct: number
  series: AgentTelemetryPoint[]
}

export interface A2ASkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
}

export interface A2AModelSpec {
  id: string
  name: string
  tier: 'frontier' | 'mid-tier' | 'fast' | 'configured' | string
  supports_effort: boolean
  effort_levels: string[]
  default_effort?: string | null
}

export interface A2AAgentCard {
  name: string
  description: string
  url: string
  well_known_url: string
  provider: {
    organization: string
    url?: string
  }
  version: string
  protocolVersion: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  defaultInputModes: string[]
  defaultOutputModes: string[]
  supported_models?: A2AModelSpec[]
  default_model?: string
  supports_effort?: boolean
  default_effort?: string | null
  effort_levels?: string[]
  skills: A2ASkill[]
  status?: {
    reachable: boolean
    activity_state: string
    last_active_at?: string | null
  }
}

export interface A2AStreamEvent {
  id: string
  timestamp: string
  profile_id: string
  event_type: 'TaskStatusUpdateEvent' | 'TaskArtifactUpdateEvent' | string
  task_id: string
  state: string
  summary: string
  final: boolean
}

export interface AgentProfile {
  id: string
  name: string
  provider: string
  config_path: string
  mounted: boolean
  source: 'docker-mount' | 'host-autodetect' | 'custom' | 'a2a-discovery' | string
  cli_command: string
  default_args: string
  activity_state: 'active' | 'recent' | 'idle' | 'unmounted'
  process_running: boolean
  process_pid?: number | null
  last_active_at?: string | null
  active_log_file?: string | null
  recent_events: AgentTranscriptEvent[]
  usage_telemetry?: AgentUsageTelemetry
  config_files: string[]
  mcp_configured: boolean
  skills_count: number
  skills_sample: string[]
  a2a_supported?: boolean
  a2a_connected?: boolean
  a2a_transport?: 'remote-http-sse' | 'local-jsonrpc-sse' | string
  a2a_streaming_enabled?: boolean
  a2a_stream_active?: boolean
  a2a_latency_ms?: number | null
  a2a_stream_url?: string
  a2a_recent_stream_events?: A2AStreamEvent[]
  supported_models?: A2AModelSpec[]
  default_model?: string
  supports_effort?: boolean
  default_effort?: string | null
  effort_levels?: string[]
  a2a_card?: A2AAgentCard
}

export interface WorktreeGitStatus {
  exists: boolean
  path?: string
  is_git?: boolean
  branch?: string
  dirty_count?: number
  dirty_files?: string[]
  last_commit?: string
  agent_log_tail?: AgentTranscriptEvent[]
}

export interface ProjectWorktreeItem {
  ticket_code: string
  ticket_title: string
  status: string
  owner?: string | null
  branch_name: string
  worktree_path: string
  git_status: WorktreeGitStatus
}

export interface ProjectWorktreesOverview {
  workspace_path: string
  workspace_exists: boolean
  worktrees_dir: string
  worktrees_dir_exists: boolean
  worktrees: ProjectWorktreeItem[]
}

