import type {
  AgentInfo,
  AgentProfile,
  BoardMessage,
  FeatureLock,
  GlobalSettings,
  Project,
  ProjectWorktreesOverview,
  ResolvedLaneRoutingPlan,
  Section,
  SkillCatalogItem,
  Ticket,
} from './types'

export interface ProjectPreset {
  slug: string
  name: string
  description: string
  repo_path: string
  file_path: string
}

export function getClientApiToken(): string {
  try {
    return localStorage.getItem('kanbanana_api_token') || ''
  } catch {
    return ''
  }
}

export function setClientApiToken(token: string): void {
  try {
    const trimmed = token.trim()
    if (trimmed) {
      localStorage.setItem('kanbanana_api_token', trimmed)
    } else {
      localStorage.removeItem('kanbanana_api_token')
    }
  } catch {
    // ignore storage errors
  }
}

function buildAuthHeaders(extra?: HeadersInit): HeadersInit {
  const token = getClientApiToken()
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    base.Authorization = `Bearer ${token}`
  }
  if (extra) {
    const entries =
      extra instanceof Headers
        ? Array.from(extra.entries())
        : Array.isArray(extra)
          ? extra
          : Object.entries(extra)
    for (const [k, v] of entries) {
      base[k] = v
    }
  }
  return base
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(options?.headers),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data.detail) msg = data.detail
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return res.json()
}

export const api = {
  issueWsTicket: () =>
    request<{ ticket: string; expires_in: number }>('/api/auth/ws-ticket', {
      method: 'POST',
    }),
  getGlobalSettings: () => request<GlobalSettings>('/api/settings/global'),
  updateGlobalSettings: (body: Partial<GlobalSettings> | Record<string, unknown>) =>
    request<GlobalSettings>('/api/settings/global', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  resetGlobalSettings: () =>
    request<GlobalSettings>('/api/settings/global/reset', {
      method: 'POST',
    }),
  getUnifiedSkillsCatalog: (projectSlug?: string) =>
    request<SkillCatalogItem[]>(
      `/api/skills/catalog${projectSlug ? `?project_slug=${encodeURIComponent(projectSlug)}` : ''}`,
    ),
  resolveProjectLaneRouting: (
    slug: string,
    params: {
      lane: string
      agent_id?: string
      profile_id?: string
      ticket_owner?: string
    },
  ) => {
    const qs = new URLSearchParams()
    qs.set('lane', params.lane)
    if (params.agent_id) qs.set('agent_id', params.agent_id)
    if (params.profile_id) qs.set('profile_id', params.profile_id)
    if (params.ticket_owner) qs.set('ticket_owner', params.ticket_owner)
    return request<ResolvedLaneRoutingPlan>(
      `/api/projects/${slug}/routing-resolve?${qs.toString()}`,
    )
  },

  listProjects: () => request<Project[]>('/api/projects'),
  getProject: (slug: string) => request<Project>(`/api/projects/${slug}`),
  createProject: (body: {
    slug: string
    name: string
    description?: string
    repo_path?: string
    worktrees_dir?: string
    board_background_md?: string
  }) =>
    request<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProject: (slug: string, body: Record<string, unknown>) =>
    request<Project>(`/api/projects/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProject: (slug: string) =>
    request<{ deleted: string; name: string }>(`/api/projects/${slug}`, {
      method: 'DELETE',
    }),
  listSections: (slug: string) => request<Section[]>(`/api/projects/${slug}/sections`),
  upsertSection: (
    slug: string,
    body: { code: string; title: string; description_md?: string; position?: number },
  ) =>
    request<Section>(`/api/projects/${slug}/sections`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteSection: (slug: string, sectionCode: string) =>
    request<{ deleted: string; title: string }>(
      `/api/projects/${slug}/sections/${encodeURIComponent(sectionCode)}`,
      { method: 'DELETE' },
    ),

  listTickets: (slug: string) =>
    request<Ticket[]>(`/api/projects/${slug}/tickets?include_notes=true`),
  getTicket: (slug: string, code: string) =>
    request<Ticket>(`/api/projects/${slug}/tickets/${code}`),
  createTicket: (slug: string, body: Record<string, unknown>) =>
    request<Ticket>(`/api/projects/${slug}/tickets`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTicket: (slug: string, code: string, body: Record<string, unknown>) =>
    request<Ticket>(`/api/projects/${slug}/tickets/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  claimTicket: (
    slug: string,
    code: string,
    agentId: string,
    branchName = '',
    worktreePath = '',
  ) =>
    request<Ticket>(
      `/api/projects/${slug}/tickets/${code}/claim?agent_id=${encodeURIComponent(
        agentId,
      )}&branch_name=${encodeURIComponent(branchName)}&worktree_path=${encodeURIComponent(
        worktreePath,
      )}`,
      { method: 'POST' },
    ),
  addNote: (
    slug: string,
    code: string,
    body: { author: string; kind: string; content_md: string },
  ) =>
    request<Ticket>(`/api/projects/${slug}/tickets/${code}/notes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  proposeTickets: (
    slug: string,
    code: string,
    body: {
      proposed_by: string
      proposals: Array<{
        code: string
        title: string
        section_code: string
        depends_on: string[]
        files_md: string
        do_md: string
        done_when_md: string
        rationale_md: string
      }>
      auto_promote?: boolean
    },
  ) =>
    request<Ticket>(`/api/projects/${slug}/tickets/${code}/proposals`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveProposals: (slug: string, code: string, proposalIds?: string[]) =>
    request<Ticket & { promoted_todo_codes?: string[] }>(
      `/api/projects/${slug}/tickets/${code}/proposals/approve`,
      {
        method: 'POST',
        body: proposalIds ? JSON.stringify(proposalIds) : undefined,
      },
    ),
  rejectProposal: (slug: string, code: string, proposalId: string) =>
    request<Ticket>(
      `/api/projects/${slug}/tickets/${code}/proposals/${proposalId}/reject`,
      { method: 'POST' },
    ),
  submitResearchFindings: (
    slug: string,
    code: string,
    body: {
      agent_id: string
      findings_md: string
      estimated_gain?: string
      exactness_impact?: string
      recommendation: 'propose-todos' | 'attach-to-existing' | 'not-worth-it' | 'needs-decision'
      attach_to_ticket_codes?: string[]
    },
  ) =>
    request<Ticket & { cross_posted_to?: string[] }>(
      `/api/projects/${slug}/tickets/${code}/research-findings`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listLocks: (projectSlug?: string) =>
    request<FeatureLock[]>(
      `/api/locks${projectSlug ? `?project_slug=${encodeURIComponent(projectSlug)}` : ''}`,
    ),
  createOrUpdateLock: (body: {
    name: string
    project_slug?: string
    max_slots: number
    description: string
  }) =>
    request<FeatureLock>('/api/locks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  acquireLock: (
    lockName: string,
    body: {
      agent_id: string
      reason: string
      expected_minutes: number
      ticket_code?: string
      enqueue_if_busy?: boolean
    },
  ) =>
    request<{ acquired: boolean; claim_status: string; queue_position?: number; lock: FeatureLock }>(
      `/api/locks/${encodeURIComponent(lockName)}/acquire`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  releaseLock: (lockName: string, agentId: string) =>
    request<{ released: boolean; promoted_agents: string[]; lock: FeatureLock }>(
      `/api/locks/${encodeURIComponent(lockName)}/release`,
      { method: 'POST', body: JSON.stringify({ agent_id: agentId }) },
    ),
  heartbeatLock: (lockName: string, agentId: string, extendMinutes = 15) =>
    request<FeatureLock>(
      `/api/locks/${encodeURIComponent(lockName)}/heartbeat`,
      {
        method: 'POST',
        body: JSON.stringify({ agent_id: agentId, extend_minutes: extendMinutes }),
      },
    ),

  listAgents: (slug: string) => request<AgentInfo[]>(`/api/projects/${slug}/agents`),
  reportUsageExhausted: (body: {
    project_slug: string
    agent_id: string
    usage_reset_at?: string
    handoff_summary_md: string
    release_ticket: boolean
    branch_name?: string
    worktree_path?: string
    commit_sha?: string
  }) =>
    request<Record<string, unknown>>('/api/agents/usage-exhausted', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listMessages: (slug: string, channel?: string) =>
    request<BoardMessage[]>(
      `/api/projects/${slug}/messages${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`,
    ),
  postMessage: (
    slug: string,
    body: {
      author: string
      channel: string
      title: string
      body_md: string
      ticket_code?: string
      pinned?: boolean
      parent_id?: string | null
    },
  ) =>
    request<BoardMessage>(`/api/projects/${slug}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSkillMd: async (slug: string): Promise<string> => {
    const res = await fetch(`/api/projects/${slug}/skill.md`, {
      headers: buildAuthHeaders(),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  },
  getCodeReviewSkillMd: async (slug: string): Promise<string> => {
    const res = await fetch(`/api/projects/${slug}/code-review-skill.md`, {
      headers: buildAuthHeaders(),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  },
  exportSkillMd: (slug: string, targetPath: string) =>
    request<{ written_to: string; bytes: number }>(
      `/api/projects/${slug}/export-skill?target_path=${encodeURIComponent(targetPath)}`,
      { method: 'POST' },
    ),

  inspectReviewTicket: (slug: string, code: string) =>
    request<{
      ticket_code: string
      title: string
      status: string
      owner?: string | null
      branch_name: string
      worktree_path: string
      pr_url: string
      commit_sha: string
      recommended_mid_tier_models: string[]
      commit_log: string
      diff_stat: string
      diff_patch: string
      static_prescan: {
        code_warnings: string[]
        security_warnings: string[]
      }
      review_skill_uri: string
    }>(`/api/projects/${slug}/tickets/${code}/review-inspect`),

  submitTicketReview: (
    slug: string,
    code: string,
    body: {
      reviewer_agent_id: string
      reviewer_model: string
      verdict: 'approve' | 'request-changes' | 'comment'
      code_issues: string[]
      security_issues: string[]
      review_md: string
      exactness_level?: string
      commit_sha?: string
      merge_if_clean: boolean
    },
  ) =>
    request<
      Ticket & {
        review_summary?: {
          effective_verdict: string
          reviewer_model: string
          code_issues_count: number
          security_issues_count: number
          merged: boolean
          merge_info?: {
            merged: boolean
            method: string
            target: string
            merge_commit_sha: string
            message: string
          } | null
        }
        newly_unblocked_tickets?: Array<{ code: string; title: string }>
      }
    >(`/api/projects/${slug}/tickets/${code}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listAgentProfiles: () => request<AgentProfile[]>('/api/agent-profiles'),
  listProjectPresets: () => request<ProjectPreset[]>('/api/project-presets'),
  exportProjectConfig: (slug: string) =>
    request<Record<string, unknown>>(`/api/projects/${slug}/config.json`),
  importProjectConfig: (body: { preset_name?: string; config?: Record<string, unknown> }) =>
    request<{
      slug: string
      name: string
      sections_imported: number
      locks_imported: number
      messages_imported: number
      tickets_imported: number
    }>('/api/projects/import-config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  scanA2AAgents: (endpoints: string[] = [], projectSlug?: string) =>
    request<{
      scanned_at: string
      protocol_version: string
      total_count: number
      active_count: number
      newly_discovered: string[]
      agents: AgentProfile[]
    }>('/api/a2a/scan', {
      method: 'POST',
      body: JSON.stringify({ endpoints, project_slug: projectSlug || '' }),
    }),
  createAgentProfile: (body: {
    name: string
    provider: string
    config_path: string
    cli_command?: string
    default_args?: string
  }) =>
    request<AgentProfile>('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteAgentProfile: (profileId: string) =>
    request<{ deleted: string }>(
      `/api/agent-profiles/${encodeURIComponent(profileId)}`,
      { method: 'DELETE' },
    ),
  injectMcpIntoProfile: (
    profileId: string,
    body: { project_slug: string; mcp_url: string; inject_skill: boolean },
  ) =>
    request<{
      profile_id: string
      mcp_config_written_to: string
      skill_written_to?: string | null
      mcp_url: string
    }>(`/api/agent-profiles/${encodeURIComponent(profileId)}/inject-mcp`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getProjectWorktrees: (slug: string) =>
    request<ProjectWorktreesOverview>(`/api/projects/${slug}/worktrees`),

  claimTicketWithAgent: (
    slug: string,
    code: string,
    body: {
      agent_id: string
      profile_id?: string
      branch_name?: string
      worktree_path?: string
      model?: string
      effort?: string
      skills?: string[]
      auto_create_worktree: boolean
      launch_agent: boolean
      dispatch_via_a2a?: boolean
    },
  ) =>
    request<{
      ticket: Ticket
      worktree: {
        created?: boolean
        is_git_worktree?: boolean
        worktree_path?: string
        branch_name?: string
        message?: string
      }
      launch?: {
        spawned: boolean
        pid?: number | null
        cli_command: string
        model?: string | null
        effort?: string | null
        skills?: string[]
        prompt: string
        shell_command: string
        log_file?: string
      } | null
      a2a_dispatch?: {
        dispatched: boolean
        protocol: string
        method: string
        task_id: string
        session_id: string
        agent_endpoint: string
        agent_card_url: string
        model?: string | null
        effort?: string | null
        skills?: string[]
        supports_effort?: boolean
        jsonrpc_request: Record<string, unknown>
        jsonrpc_response: Record<string, unknown>
      } | null
      routing_plan?: ResolvedLaneRoutingPlan
    }>(`/api/projects/${slug}/tickets/${code}/claim-with-agent`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
