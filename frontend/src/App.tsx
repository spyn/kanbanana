import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Cpu,
  FolderPlus,
  Kanban,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  Settings2,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react'
import { api, getClientApiToken } from './api'
import { AgentsTab } from './components/AgentsTab'
import { KanbanBoard, type SendItAnimationState } from './components/KanbanBoard'
import { MessageBoard } from './components/MessageBoard'
import { TicketModal } from './components/TicketModal'
import { TriagePanel } from './components/TriagePanel'

const GlobalSettingsPage = React.lazy(() =>
  import('./components/GlobalSettingsPage').then((m) => ({ default: m.GlobalSettingsPage })),
)
const OvernightTerminalHUD = React.lazy(() =>
  import('./components/OvernightTerminalHUD').then((m) => ({ default: m.OvernightTerminalHUD })),
)
const ProjectSettingsPage = React.lazy(() =>
  import('./components/ProjectSettingsPage').then((m) => ({ default: m.ProjectSettingsPage })),
)

function encodeTokenSubprotocol(token: string): string {
  const bytes = new TextEncoder().encode(token)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const b64url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `kanbanana-token.${b64url}`
}
import type {
  AgentInfo,
  AgentProfile,
  BoardMessage,
  FeatureLock,
  GlobalSettings,
  Project,
  ProjectWorktreesOverview,
  ResolvedLaneRoutingPlan,
  SkillCatalogItem,
  Ticket,
  TicketStatus,
} from './types'

type ActiveTab =
  | 'board'
  | 'triage'
  | 'agents'
  | 'messages'
  | 'skill'
  | 'terminal'
  | 'global-settings'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeSlug, setActiveSlug] = useState<string>(() => {
    return localStorage.getItem('kanbanana_active_slug') || ''
  })
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [locks, setLocks] = useState<FeatureLock[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([])
  const [worktreesOverview, setWorktreesOverview] =
    useState<ProjectWorktreesOverview | null>(null)
  const [messages, setMessages] = useState<BoardMessage[]>([])
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null)
  const [skillsCatalog, setSkillsCatalog] = useState<SkillCatalogItem[]>([])
  const [prevProjectTab, setPrevProjectTab] = useState<Exclude<ActiveTab, 'global-settings'>>('board')

  const [activeTab, setActiveTab] = useState<ActiveTab>('board')
  const [wallboardMode, setWallboardMode] = useState<boolean>(false)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [wsConnected, setWsConnected] = useState<boolean>(false)
  const [copiedMcp, setCopiedMcp] = useState<boolean>(false)

  const toggleWallboardMode = useCallback((nextValue?: boolean) => {
    setWallboardMode((prev) => {
      const target = typeof nextValue === 'boolean' ? nextValue : !prev
      if (target) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          void document.documentElement.requestFullscreen().catch(() => {
            // Fallback to viewport-filling CSS kiosk mode if fullscreen permission is blocked
          })
        }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {
          // ignore
        })
      }
      return target
    })
  }, [])

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setWallboardMode(false)
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Quick Create Project Modal
  const [showNewProject, setShowNewProject] = useState<boolean>(false)
  const [newProjSlug, setNewProjSlug] = useState('')
  const [newProjName, setNewProjName] = useState('')
  const [newProjRepo, setNewProjRepo] = useState('')
  const [newProjDesc, setNewProjDesc] = useState('')

  // Quick Claim Modal with Auto-Detected & A2A Agent Profiles
  const [claimingTicket, setClaimingTicket] = useState<Ticket | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [claimAgentId, setClaimAgentId] = useState('antigravity-worker')
  const [claimBranch, setClaimBranch] = useState('')
  const [claimWorktree, setClaimWorktree] = useState('')
  const [claimModel, setClaimModel] = useState<string>('')
  const [claimEffort, setClaimEffort] = useState<string>('')
  const [claimSkills, setClaimSkills] = useState<string[]>([])
  const [claimResolvedPlan, setClaimResolvedPlan] =
    useState<ResolvedLaneRoutingPlan | null>(null)
  const [claimCustomModelMode, setClaimCustomModelMode] = useState<boolean>(false)
  const [autoCreateWorktree, setAutoCreateWorktree] = useState<boolean>(true)
  const [launchAgentNow, setLaunchAgentNow] = useState<boolean>(false)
  const [dispatchViaA2A, setDispatchViaA2A] = useState<boolean>(true)
  const [scanningA2AInModal, setScanningA2AInModal] = useState<boolean>(false)
  const [customA2AEndpoint, setCustomA2AEndpoint] = useState<string>('')
  const [claimError, setClaimError] = useState('')
  const [sendItAnimation, setSendItAnimation] = useState<SendItAnimationState | null>(
    null,
  )
  const [claimSuccessResult, setClaimSuccessResult] = useState<{
    ticket_code?: string
    owner?: string
    worktree_path?: string
    shell_command?: string
    spawned?: boolean
    skills?: string[]
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
  } | null>(null)

  const triggerSendItAnimation = useCallback(
    (
      ticket: Ticket,
      fromStatus: TicketStatus,
      toStatus: TicketStatus,
      owner: string,
    ) => {
      setSendItAnimation({
        ticket,
        fromStatus,
        toStatus,
        owner,
        phase: 'launching',
      })
      window.setTimeout(() => {
        setSendItAnimation((prev) =>
          prev && prev.ticket.code === ticket.code
            ? { ...prev, phase: 'landing' }
            : prev,
        )
      }, 920)
      window.setTimeout(() => {
        setSendItAnimation((prev) =>
          prev && prev.ticket.code === ticket.code ? null : prev,
        )
      }, 2800)
    },
    [],
  )

  const loadAll = useCallback(async (slug?: string) => {
    try {
      const [projList, gSettings] = await Promise.all([
        api.listProjects(),
        api.getGlobalSettings().catch(() => null),
      ])
      setProjects(projList)
      if (gSettings) {
        setGlobalSettings(gSettings)
      }
      let targetSlug = slug || activeSlug
      if (!targetSlug || !projList.some((p) => p.slug === targetSlug)) {
        targetSlug = projList[0]?.slug || ''
      }
      if (targetSlug && targetSlug !== activeSlug) {
        setActiveSlug(targetSlug)
        localStorage.setItem('kanbanana_active_slug', targetSlug)
      }
      if (!targetSlug) return

      const [
        projDetail,
        tList,
        lList,
        aList,
        profList,
        wtOverview,
        mList,
        catalogList,
      ] = await Promise.all([
        api.getProject(targetSlug),
        api.listTickets(targetSlug),
        api.listLocks(targetSlug),
        api.listAgents(targetSlug),
        api.listAgentProfiles(),
        api.getProjectWorktrees(targetSlug),
        api.listMessages(targetSlug),
        api.getUnifiedSkillsCatalog(targetSlug).catch(() => []),
      ])
      setCurrentProject(projDetail)
      setTickets(tList)
      setLocks(lList)
      setAgents(aList)
      setAgentProfiles(profList)
      setWorktreesOverview(wtOverview)
      setMessages(mList)
      setSkillsCatalog(catalogList)
    } catch (e) {
      console.error('Failed to load project data:', e)
    }
  }, [activeSlug])

  useEffect(() => {
    loadAll(activeSlug)
  }, [activeSlug, loadAll])

  // Global Escape key listener to dismiss open modals
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (claimingTicket) {
          setClaimingTicket(null)
          setClaimError('')
        } else if (showNewProject) {
          setShowNewProject(false)
        } else if (selectedTicket) {
          setSelectedTicket(null)
        } else if (wallboardMode) {
          toggleWallboardMode(false)
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [claimingTicket, showNewProject, selectedTicket, wallboardMode, toggleWallboardMode])

  // Live WebSocket updates (uses short-lived single-use WS ticket or subprotocol — never long-lived token in URL)
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    let ws: WebSocket | null = null
    let reconnectTimer: number | undefined
    let disposed = false

    const connect = async () => {
      if (disposed) return
      const token = getClientApiToken()
      let wsUrl = `${proto}//${window.location.host}/api/ws`
      let protocols: string[] | undefined

      if (token) {
        try {
          const issued = await api.issueWsTicket()
          if (disposed) return
          wsUrl = `${wsUrl}?ticket=${encodeURIComponent(issued.ticket)}`
        } catch {
          if (disposed) return
          protocols = ['kanbanana.v1', encodeTokenSubprotocol(token)]
        }
      }

      ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl)
      ws.onopen = () => {
        if (!disposed) setWsConnected(true)
      }
      ws.onclose = () => {
        if (disposed) return
        setWsConnected(false)
        reconnectTimer = window.setTimeout(() => {
          void connect()
        }, 3000)
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          const payload = msg.data || msg.payload
          if (msg.event === 'a2a_stream_event' && payload?.profile_id) {
            const sseEvt = payload
            setAgentProfiles((prev) =>
              prev.map((p) => {
                if (p.id !== sseEvt.profile_id) return p
                const existing = p.a2a_recent_stream_events || []
                const nextEvts = [...existing.slice(-11), sseEvt]
                return {
                  ...p,
                  a2a_connected: true,
                  a2a_stream_active: !sseEvt.final,
                  a2a_recent_stream_events: nextEvts,
                }
              }),
            )
            return
          }
          if (
            (msg.event === 'ticket_claimed' || msg.event === 'lane_auto_dispatched') &&
            (payload?.code || payload?.ticket_code)
          ) {
            const code = String(payload.code || payload.ticket_code).toUpperCase()
            const owner = String(
              payload.owner || payload.agent_id || 'agent',
            )
            setTickets((prev) => {
              const found = prev.find((t) => t.code.toUpperCase() === code)
              if (found) {
                const targetStatus: TicketStatus =
                  found.status === 'todo' ? 'in-progress' : found.status
                triggerSendItAnimation(
                  { ...found, status: targetStatus, owner },
                  found.status,
                  targetStatus,
                  owner,
                )
              }
              return prev
            })
          }
        } catch {
          // ignore parse error
        }
        void loadAll(activeSlug)
      }
    }
    void connect()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [activeSlug, loadAll, triggerSendItAnimation])

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjSlug.trim() || !newProjName.trim()) return
    const created = await api.createProject({
      slug: newProjSlug.trim().toLowerCase(),
      name: newProjName.trim(),
      repo_path: newProjRepo.trim(),
      description: newProjDesc.trim(),
    })
    setShowNewProject(false)
    setNewProjSlug('')
    setNewProjName('')
    setNewProjRepo('')
    setNewProjDesc('')
    setActiveSlug(created.slug)
  }

  const applyModelAndEffortForProfile = (
    prof: AgentProfile | undefined,
    ticketStatus?: TicketStatus,
  ) => {
    if (!prof) {
      setClaimModel('')
      setClaimEffort('')
      return
    }
    const models = prof.supported_models || prof.a2a_card?.supported_models || []
    let chosenSpec = models[0]
    if (ticketStatus === 'triage' || ticketStatus === 'blocked') {
      chosenSpec =
        models.find((m) => m.tier === 'frontier') ||
        models.find((m) => m.id === prof.default_model) ||
        models[0]
    } else if (ticketStatus === 'todo' || ticketStatus === 'in-progress' || ticketStatus === 'review') {
      chosenSpec =
        models.find((m) => m.tier === 'mid-tier') ||
        models.find((m) => m.tier === 'fast') ||
        models[0]
    } else if (prof.default_model) {
      chosenSpec = models.find((m) => m.id === prof.default_model) || models[0]
    }
    if (chosenSpec) {
      setClaimModel(chosenSpec.id)
      if (chosenSpec.supports_effort) {
        const levels = chosenSpec.effort_levels || []
        const isWorkerLane = ticketStatus === 'todo' || ticketStatus === 'in-progress'
        const preferredEffort =
          isWorkerLane && levels.includes('max')
            ? 'max'
            : levels.includes('high')
              ? 'high'
              : chosenSpec.default_effort || levels[0] || 'high'
        setClaimEffort(preferredEffort)
      } else {
        setClaimEffort('')
      }
    } else {
      const fallbackModel = prof.default_model || prof.a2a_card?.default_model || ''
      setClaimModel(fallbackModel)
      setClaimEffort(prof.supports_effort ? prof.default_effort || 'high' : '')
    }
  }

  const resolveRoutingForClaim = useCallback(
    async (
      ticket: Ticket,
      prof: AgentProfile | undefined,
      explicitAgentId?: string,
    ) => {
      if (!activeSlug || ticket.status === 'done') return
      try {
        const plan = await api.resolveProjectLaneRouting(activeSlug, {
          lane: ticket.status,
          agent_id: explicitAgentId || prof?.id || undefined,
          profile_id: prof?.id || undefined,
          ticket_owner: ticket.owner || undefined,
        })
        setClaimResolvedPlan(plan)
        if (plan.model) {
          setClaimModel(plan.model)
          const availModels =
            prof?.supported_models || prof?.a2a_card?.supported_models || []
          const isPreset = availModels.some((m) => m.id === plan.model)
          setClaimCustomModelMode(availModels.length > 0 && !isPreset)
        }
        setClaimEffort(plan.effort || '')
        setClaimSkills(plan.skill_ids || [])
        setAutoCreateWorktree(plan.auto_create_worktree)
        setDispatchViaA2A(plan.dispatch_via_a2a)
        const prefix = plan.branch_prefix || 'board/'
        if (!ticket.branch_name) {
          const cleanPref = prefix.endsWith('/') ? prefix : `${prefix}/`
          setClaimBranch(`${cleanPref}${ticket.code.toLowerCase()}`)
        }
      } catch {
        // Fallback to local profile defaults if offline
        applyModelAndEffortForProfile(prof, ticket.status)
      }
    },
    [activeSlug],
  )

  const runA2AScanForModal = async (extraUrl?: string, targetTicket?: Ticket | null) => {
    setScanningA2AInModal(true)
    try {
      const eps = extraUrl && extraUrl.trim() ? [extraUrl.trim()] : []
      const scanRes = await api.scanA2AAgents(eps, activeSlug)
      setAgentProfiles(scanRes.agents)
      if (extraUrl && extraUrl.trim()) {
        setCustomA2AEndpoint('')
      }
      const t = targetTicket ?? claimingTicket
      if (scanRes.agents.length > 0 && t && !selectedProfileId) {
        const lanePref =
          currentProject?.effective_lanes?.[
            t.status as keyof NonNullable<Project['effective_lanes']>
          ]?.preferred_agent || ''
        const currentProf =
          (lanePref
            ? scanRes.agents.find(
                (p) =>
                  p.id === lanePref ||
                  lanePref.toLowerCase().includes(p.provider.toLowerCase()),
              )
            : undefined) ||
          scanRes.agents.find((p) => p.activity_state === 'active') ||
          scanRes.agents[0]
        setSelectedProfileId(currentProf.id)
        const nextAgentId = `${currentProf.provider}-${t.code.toLowerCase()}`
        setClaimAgentId(nextAgentId)
        void resolveRoutingForClaim(t, currentProf, nextAgentId)
      }
    } catch {
      // ignore scan errors
    } finally {
      setScanningA2AInModal(false)
    }
  }

  const openClaimModal = (t: Ticket) => {
    if (t.is_held) {
      alert(`Ticket ${t.code} is currently on hold. Resume work before claiming.`)
      return
    }
    setClaimingTicket(t)
    setClaimSuccessResult(null)
    setClaimError('')
    setClaimCustomModelMode(false)
    setClaimResolvedPlan(null)
    setClaimSkills([])

    const effLane =
      currentProject?.effective_lanes?.[
        t.status as keyof NonNullable<Project['effective_lanes']>
      ]
    const preferredAgentKey = effLane?.preferred_agent || ''
    const matchedPreferredProf = preferredAgentKey
      ? agentProfiles.find(
          (p) =>
            p.id === preferredAgentKey ||
            preferredAgentKey.toLowerCase().includes(p.provider.toLowerCase()),
        )
      : undefined

    const chosenProf =
      matchedPreferredProf ||
      agentProfiles.find((p) => p.activity_state === 'active') ||
      agentProfiles[0]
    const defaultProfId = chosenProf ? chosenProf.id : ''
    setSelectedProfileId(defaultProfId)
    const prefix = chosenProf
      ? chosenProf.provider
      : preferredAgentKey || 'agent'
    const initialAgentId = `${prefix}-${t.code.toLowerCase()}`
    setClaimAgentId(initialAgentId)
    const branchPref = currentProject?.project_settings?.branch_prefix || 'board/'
    const normBranchPref = branchPref.endsWith('/') ? branchPref : `${branchPref}/`
    setClaimBranch(t.branch_name || `${normBranchPref}${t.code.toLowerCase()}`)
    setClaimWorktree(t.worktree_path || '')
    applyModelAndEffortForProfile(chosenProf, t.status)
    void resolveRoutingForClaim(t, chosenProf, initialAgentId)
    if (globalSettings?.auto_scan_a2a !== false) {
      void runA2AScanForModal(undefined, t)
    }
  }

  const handleSelectProfile = (profId: string) => {
    setSelectedProfileId(profId)
    const prof = agentProfiles.find((p) => p.id === profId)
    if (prof && claimingTicket) {
      const nextAgentId = `${prof.provider}-${claimingTicket.code.toLowerCase()}`
      setClaimAgentId(nextAgentId)
      applyModelAndEffortForProfile(prof, claimingTicket.status)
      void resolveRoutingForClaim(claimingTicket, prof, nextAgentId)
    }
  }

  const handleSelectClaimModel = (modelId: string) => {
    if (modelId === '__custom__') {
      setClaimCustomModelMode(true)
      return
    }
    setClaimCustomModelMode(false)
    setClaimModel(modelId)
    const prof = agentProfiles.find((p) => p.id === selectedProfileId)
    const models = prof?.supported_models || prof?.a2a_card?.supported_models || []
    const spec = models.find((m) => m.id === modelId)
    if (spec) {
      if (spec.supports_effort) {
        if (!claimEffort || !spec.effort_levels.includes(claimEffort)) {
          setClaimEffort(spec.default_effort || spec.effort_levels[0] || 'medium')
        }
      } else {
        setClaimEffort('')
      }
    }
  }

  const handleConfirmClaim = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!claimingTicket || !claimAgentId.trim()) return
    setClaimError('')
    const prevStatus = claimingTicket.status
    try {
      const res = await api.claimTicketWithAgent(activeSlug, claimingTicket.code, {
        agent_id: claimAgentId.trim(),
        profile_id: selectedProfileId || undefined,
        branch_name: claimBranch.trim(),
        worktree_path: claimWorktree.trim(),
        model: claimModel.trim() || undefined,
        effort: claimEffort.trim() || undefined,
        skills: claimSkills,
        auto_create_worktree: autoCreateWorktree,
        launch_agent: launchAgentNow,
        dispatch_via_a2a: dispatchViaA2A,
      })
      // Close the modal backdrop immediately so the user sees the "SEND IT!" animation on the board!
      setClaimingTicket(null)
      setActiveTab('board')
      triggerSendItAnimation(
        res.ticket,
        prevStatus,
        res.ticket.status,
        res.ticket.owner || claimAgentId.trim(),
      )
      await loadAll(activeSlug)
      if (res.launch?.shell_command || res.a2a_dispatch) {
        setClaimSuccessResult({
          ticket_code: res.ticket.code,
          owner: res.ticket.owner || claimAgentId.trim(),
          worktree_path: res.worktree?.worktree_path || res.ticket.worktree_path,
          shell_command: res.launch?.shell_command,
          spawned: res.launch?.spawned,
          skills: res.a2a_dispatch?.skills || res.launch?.skills || claimSkills,
          a2a_dispatch: res.a2a_dispatch,
        })
      }
    } catch (err: any) {
      setClaimError(err.message || 'Failed to claim ticket')
    }
  }

  const handleNavigateTicket = async (code: string) => {
    const found = tickets.find((t) => t.code.toUpperCase() === code.toUpperCase())
    if (found) {
      setSelectedTicket(found)
    } else {
      try {
        const fetched = await api.getTicket(activeSlug, code)
        setSelectedTicket(fetched)
      } catch {
        // ignore
      }
    }
  }

  const triageCount = tickets.filter((t) => t.status === 'triage').length
  const needsInfoCount = tickets.filter(
    (t) => t.status === 'triage' && t.triage_state === 'needs-info',
  ).length
  const heldLocksCount = locks.filter((l) => l.active_claims.length > 0).length
  const activeAgentProfilesCount = agentProfiles.filter(
    (p) => p.activity_state === 'active',
  ).length
  const connectedA2ACount = agentProfiles.filter(
    (p) => p.a2a_connected || p.mounted || p.source === 'a2a-discovery',
  ).length
  const streamingA2ACount = agentProfiles.filter(
    (p) => p.a2a_stream_active || p.activity_state === 'active',
  ).length

  const isTerminalWallboard = activeTab === 'terminal' && wallboardMode

  return (
    <div
      className={`min-h-screen flex flex-col text-slate-100 ${
        isTerminalWallboard ? 'bg-[#050608]' : 'bg-slate-950'
      }`}
    >
      {/* Top Navbar (hidden during Wallboard / Kiosk Fullscreen Mode) */}
      {!isTerminalWallboard && (
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Brand + Project Selector */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                <Kanban className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-white">
                    Kanbanana
                  </span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Agent-First MCP
                  </span>
                </div>
              </div>
            </div>

            <div className="h-5 w-[1px] bg-slate-800 hidden sm:block" />

            {/* Project Switcher */}
            {/* Project Switcher */}
            <div className="flex items-center gap-2">
              <select
                value={activeSlug}
                onChange={(e) => setActiveSlug(e.target.value)}
                className="rounded-xl bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewProject(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-300 border border-slate-800 transition cursor-pointer"
                title="Create a new project"
              >
                <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
                New Project
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeTab === 'global-settings') {
                    setActiveTab(prevProjectTab)
                  } else {
                    setPrevProjectTab(activeTab)
                    setActiveTab('global-settings')
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  activeTab === 'global-settings'
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-500/20'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700'
                }`}
                title="Configure Fleet-Wide Lane × Agent Routing, Global Skills, Custom Models & HUD Defaults"
              >
                <Settings className="w-3.5 h-3.5 text-indigo-400" />
                Global Settings
              </button>
            </div>
          </div>

          {/* Right Status & Quick Actions */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* MCP Endpoint Pill */}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/mcp`)
                setCopiedMcp(true)
                setTimeout(() => setCopiedMcp(false), 2000)
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 transition cursor-pointer"
              title="Click to copy MCP HTTP server URL"
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span>MCP: {window.location.origin}/mcp</span>
              {copiedMcp ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-slate-500" />
              )}
            </button>

            {/* A2A Connected & SSE Streaming Indicator */}
            <button
              type="button"
              onClick={() => setActiveTab('agents')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition cursor-pointer ${
                connectedA2ACount > 0
                  ? 'bg-cyan-950/70 text-cyan-300 border-cyan-700/60 hover:bg-cyan-900/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
              title="Click to inspect A2A Agent Cards & real-time SSE streams"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  streamingA2ACount > 0
                    ? 'bg-cyan-400 animate-ping'
                    : connectedA2ACount > 0
                      ? 'bg-cyan-400'
                      : 'bg-slate-500'
                }`}
              />
              <span>
                A2A Connected ({connectedA2ACount}) ·{' '}
                <span className="font-mono text-[10px] text-emerald-300">SSE Stream</span>
              </span>
            </button>

            {/* Live WS indicator */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                wsConnected
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              {wsConnected ? 'Live Sync' : 'Polling'}
            </span>

            {/* Overnight HUD placed right next to Live Sync */}
            <button
              type="button"
              onClick={() => setActiveTab('terminal')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'terminal'
                  ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-md shadow-emerald-500/25 ring-1 ring-emerald-400/40'
                  : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 border border-emerald-500/30 bg-slate-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <Terminal className="w-3.5 h-3.5" />
              <span>Overnight HUD</span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-400/20 text-emerald-300 font-mono text-[9px] border border-emerald-500/30">
                v1.2-neuro
              </span>
            </button>

            <button
              type="button"
              onClick={() => loadAll(activeSlug)}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer"
              title="Refresh board"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-[1600px] mx-auto mt-3 flex items-center gap-2 overflow-x-auto pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('triage')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'triage'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Triage & Grill ({triageCount})
            {needsInfoCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                {needsInfoCount} Q&A
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('board')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'board'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Kanban className="w-3.5 h-3.5" />
            Kanban Board ({tickets.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('agents')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'agents'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            Agents & Live Activity ({agentProfiles.length})
            {activeAgentProfilesCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                {activeAgentProfilesCount} active
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('messages')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'messages'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Agent Message Board ({messages.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('skill')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'skill'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Project Settings &amp; Routing
          </button>
        </div>
      </header>
      )}

      {/* Main Content Area */}
      <main
        className={`flex-1 w-full mx-auto ${
          isTerminalWallboard ? 'max-w-none px-3 py-2.5 sm:px-5 sm:py-4' : 'max-w-[1600px] px-6 py-5'
        }`}
      >
        {activeTab === 'global-settings' && globalSettings && (
          <React.Suspense
            fallback={
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-xs text-slate-400">
                Loading Global Settings...
              </div>
            }
          >
            <GlobalSettingsPage
              globalSettings={globalSettings}
              agentProfiles={agentProfiles}
              skillsCatalog={skillsCatalog}
              onSaved={(updated) => {
                setGlobalSettings(updated)
                void loadAll(activeSlug)
              }}
              onClose={() => setActiveTab(prevProjectTab)}
            />
          </React.Suspense>
        )}

        {activeTab === 'board' && currentProject && (
          <KanbanBoard
            tickets={tickets}
            sections={currentProject.sections || []}
            onSelectTicket={(t) => setSelectedTicket(t)}
            onQuickCreateTriage={() => setActiveTab('triage')}
            onQuickClaim={openClaimModal}
            sendItAnimation={sendItAnimation}
          />
        )}

        {activeTab === 'triage' && currentProject && (
          <TriagePanel
            projectSlug={activeSlug}
            tickets={tickets}
            sections={currentProject.sections || []}
            agentProfiles={agentProfiles}
            onRefresh={() => loadAll(activeSlug)}
            onSelectTicket={(t) => setSelectedTicket(t)}
          />
        )}

        {activeTab === 'agents' && currentProject && (
          <AgentsTab
            project={currentProject}
            agentProfiles={agentProfiles}
            boardAgents={agents}
            worktreesOverview={worktreesOverview}
            defaultMcpUrl={globalSettings?.mcp_url}
            onRefresh={() => loadAll(activeSlug)}
            onNavigateTicket={handleNavigateTicket}
          />
        )}

        {activeTab === 'messages' && (
          <MessageBoard
            projectSlug={activeSlug}
            messages={messages}
            onRefresh={() => loadAll(activeSlug)}
            onNavigateTicket={handleNavigateTicket}
          />
        )}

        {activeTab === 'skill' && currentProject && (
          <React.Suspense
            fallback={
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center text-xs text-slate-400">
                Loading Project Settings...
              </div>
            }
          >
            <ProjectSettingsPage
              project={currentProject}
              globalSettings={globalSettings}
              agentProfiles={agentProfiles}
              skillsCatalog={skillsCatalog}
              canDeleteProject={projects.length > 1}
              onUpdated={() => loadAll(activeSlug)}
              onDeletedProject={(deletedSlug) => {
                const remaining = projects.filter((p) => p.slug !== deletedSlug)
                const nextSlug = remaining[0]?.slug || ''
                setActiveSlug(nextSlug)
                setActiveTab('board')
                void loadAll(nextSlug)
              }}
              onOpenGlobalSettings={() => {
                setPrevProjectTab('skill')
                setActiveTab('global-settings')
              }}
            />
          </React.Suspense>
        )}

        {activeTab === 'terminal' && currentProject && (
          <React.Suspense
            fallback={
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center font-mono text-xs text-cyan-400">
                Initializing Kanbanana Overnight HUD...
              </div>
            }
          >
            <OvernightTerminalHUD
              project={currentProject}
              tickets={tickets}
              locks={locks}
              agentProfiles={agentProfiles}
              boardAgents={agents}
              worktreesOverview={worktreesOverview}
              defaultTokenCeiling={
                currentProject.project_settings?.token_ceiling_override ??
                globalSettings?.default_token_ceiling ??
                1_500_000
              }
              defaultNeuroArmed={globalSettings?.hud_neuro_audio_armed_default ?? false}
              defaultNeuroVolume={globalSettings?.hud_neuro_volume ?? 0.78}
              prDropEnabled={globalSettings?.hud_pr_drop_enabled !== false}
              isWallboardMode={wallboardMode}
              onToggleWallboard={toggleWallboardMode}
              onSelectTicket={(ticket) => setSelectedTicket(ticket)}
              onNavigateTicket={handleNavigateTicket}
              onClaimTicket={openClaimModal}
              onQuickCreateTriage={() => setActiveTab('triage')}
            />
          </React.Suspense>
        )}
      </main>

      {/* Ticket Detail Modal */}
      {selectedTicket && currentProject && (
        <TicketModal
          projectSlug={activeSlug}
          ticket={selectedTicket}
          sections={currentProject.sections || []}
          onClose={() => setSelectedTicket(null)}
          onUpdated={(updated) => {
            setSelectedTicket(updated)
            loadAll(activeSlug)
          }}
          onNavigateTicket={handleNavigateTicket}
          onQuickClaim={openClaimModal}
        />
      )}

      {/* Non-blocking Floating "SEND IT!" A2A Dispatch Toast */}
      {claimSuccessResult && !claimingTicket && (
        <div className="fixed bottom-5 right-5 z-50 w-full max-w-md rounded-2xl border border-amber-400/60 bg-slate-900/95 backdrop-blur-md p-4 shadow-2xl flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-500 to-cyan-400 text-slate-950 font-black text-xs tracking-wider uppercase">
                🚀 SENT IT!
              </span>
              <span className="text-xs font-bold text-white font-mono">
                {claimSuccessResult.ticket_code} → {claimSuccessResult.owner}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setClaimSuccessResult(null)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {claimSuccessResult.a2a_dispatch?.dispatched && (
            <div className="text-[11px] font-mono text-indigo-200 bg-indigo-950/60 border border-indigo-800/60 rounded-lg px-2.5 py-1.5 flex flex-col gap-1">
              <div>
                ✓ A2A `{claimSuccessResult.a2a_dispatch.method}` ({claimSuccessResult.a2a_dispatch.task_id}) →{' '}
                <span className="text-cyan-300">
                  {claimSuccessResult.a2a_dispatch.agent_endpoint}
                </span>
              </div>
              {claimSuccessResult.a2a_dispatch.model && (
                <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-indigo-900/70 text-indigo-200 border border-indigo-700/60">
                    Model: {claimSuccessResult.a2a_dispatch.model}
                  </span>
                  {claimSuccessResult.a2a_dispatch.supports_effort &&
                  claimSuccessResult.a2a_dispatch.effort ? (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                      Effort: {claimSuccessResult.a2a_dispatch.effort}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      Effort: N/A
                    </span>
                  )}
                </div>
              )}
              {claimSuccessResult.skills && claimSuccessResult.skills.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap pt-0.5 text-[10px]">
                  <span className="text-slate-400">Skills:</span>
                  {claimSuccessResult.skills.map((sid) => (
                    <span
                      key={sid}
                      className="px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/50"
                    >
                      {sid}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {claimSuccessResult.worktree_path && (
            <div className="text-[11px] font-mono text-slate-300 truncate">
              Worktree: <code className="text-emerald-300">{claimSuccessResult.worktree_path}</code>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {claimSuccessResult.shell_command && (
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(claimSuccessResult.shell_command || '')
                }
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-white cursor-pointer"
              >
                Copy CLI Command
              </button>
            )}
            <button
              type="button"
              onClick={() => setClaimSuccessResult(null)}
              className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-semibold text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Claim Ticket with Auto-Detected & A2A Agent Modal */}
      {claimingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">
                  {claimingTicket.status === 'review'
                    ? 'Assign Reviewer via A2A'
                    : claimingTicket.status === 'blocked'
                      ? 'Handover & Resume Story'
                      : 'Claim & Assign via A2A'}{' '}
                  <span className="font-mono text-indigo-300">
                    {claimingTicket.code} · {claimingTicket.title}
                  </span>
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  A2A v0.2.1 · JSON-RPC 2.0
                </span>
              </div>
              <button
                type="button"
                onClick={() => setClaimingTicket(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {claimingTicket.status === 'blocked' && (
              <div className="rounded-xl bg-amber-950/40 border border-amber-600/40 p-3 text-xs text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-amber-300">Resuming Blocked Story: </span>
                  {claimingTicket.blocked_reason || 'Quota/usage exhausted. Awaiting agent handover.'}
                  {claimingTicket.owner && (
                    <span className="text-amber-300/80"> (Prior owner: <code>{claimingTicket.owner}</code>)</span>
                  )}
                </div>
              </div>
            )}

            {claimSuccessResult ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-xl bg-emerald-950/50 border border-emerald-700/60 p-3.5 text-xs text-emerald-200 flex flex-col gap-1.5">
                  <div className="font-bold text-emerald-300">
                    ✓ Assigned {claimingTicket.code} to `{claimAgentId}`!
                  </div>
                  {claimSuccessResult.worktree_path && (
                    <div>
                      Worktree prepared at:{' '}
                      <code className="text-white">{claimSuccessResult.worktree_path}</code>
                    </div>
                  )}
                  {claimSuccessResult.a2a_dispatch?.dispatched && (
                    <div className="text-indigo-200">
                      ✓ A2A `tasks/send` dispatched (`{claimSuccessResult.a2a_dispatch.task_id}`) →{' '}
                      <code className="text-indigo-300">
                        {claimSuccessResult.a2a_dispatch.agent_endpoint}
                      </code>
                    </div>
                  )}
                  {claimSuccessResult.spawned && (
                    <div className="text-emerald-300">
                      ✓ Background agent subprocess dispatched! Check the Agents tab for live log output.
                    </div>
                  )}
                </div>

                {claimSuccessResult.a2a_dispatch && (
                  <div>
                    <label className="block text-[11px] text-indigo-300 font-semibold mb-1">
                      A2A Protocol (`tasks/send`) JSON-RPC 2.0 Envelope:
                    </label>
                    <pre className="whitespace-pre-wrap font-mono text-[10px] bg-slate-950 border border-indigo-900/60 p-3 rounded-xl text-indigo-200 max-h-44 overflow-y-auto">
                      {JSON.stringify(
                        {
                          request: claimSuccessResult.a2a_dispatch.jsonrpc_request,
                          response: claimSuccessResult.a2a_dispatch.jsonrpc_response,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}

                {claimSuccessResult.shell_command && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Ready-to-run Agent CLI Command (if launching from host terminal):
                    </label>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] bg-slate-950 border border-slate-800 p-3 rounded-xl text-indigo-200">
                      {claimSuccessResult.shell_command}
                    </pre>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  {claimSuccessResult.shell_command && (
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(claimSuccessResult.shell_command || '')
                      }
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white cursor-pointer"
                    >
                      Copy CLI Command
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setClaimingTicket(null)}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConfirmClaim} className="flex flex-col gap-3.5">
                {claimError && (
                  <div className="rounded-lg bg-rose-950/80 border border-rose-700 p-2.5 text-xs text-rose-200">
                    {claimError}
                  </div>
                )}

                {/* A2A Discovery & Available Agents Grid */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="text-xs text-slate-200 font-semibold flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-indigo-400" />
                      Available A2A Agents (`/.well-known/agent.json`)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={customA2AEndpoint}
                        onChange={(e) => setCustomA2AEndpoint(e.target.value)}
                        placeholder="Probe remote A2A URL (optional)..."
                        className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1 text-[11px] font-mono text-white w-48"
                      />
                      <button
                        type="button"
                        onClick={() => runA2AScanForModal(customA2AEndpoint)}
                        disabled={scanningA2AInModal}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-[11px] font-semibold text-indigo-200 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${scanningA2AInModal ? 'animate-spin' : ''}`}
                        />
                        {scanningA2AInModal ? 'Scanning...' : 'Scan A2A'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                    {agentProfiles.map((prof) => {
                      const isSelected = selectedProfileId === prof.id
                      const card = prof.a2a_card
                      const isActive = prof.activity_state === 'active'
                      const isMounted = prof.mounted || prof.source === 'a2a-discovery'
                      const profModels = prof.supported_models || card?.supported_models || []
                      const displayedModelId = isSelected
                        ? claimModel || prof.default_model || card?.default_model || profModels[0]?.id
                        : prof.default_model || card?.default_model || profModels[0]?.id
                      const displayedModelObj =
                        profModels.find((m) => m.id === displayedModelId) || profModels[0]
                      const modelSupportsEffort = displayedModelObj
                        ? displayedModelObj.supports_effort
                        : Boolean(prof.supports_effort ?? card?.supports_effort)
                      const displayedEffort = isSelected
                        ? claimEffort || displayedModelObj?.default_effort || prof.default_effort
                        : displayedModelObj?.default_effort || prof.default_effort
                      return (
                        <div
                          key={prof.id}
                          onClick={() => handleSelectProfile(prof.id)}
                          className={`rounded-xl border p-2.5 cursor-pointer transition flex flex-col gap-1.5 ${
                            isSelected
                              ? 'bg-indigo-950/60 border-indigo-500 ring-1 ring-indigo-500/50'
                              : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-bold text-white truncate">
                              {card?.name || prof.name}
                            </span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full border shrink-0 ${
                                isActive
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : isMounted
                                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              {isActive ? 'ACTIVE' : isMounted ? 'READY' : prof.activity_state.toUpperCase()}
                            </span>
                          </div>

                          <div className="text-[10px] font-mono text-indigo-300/90 truncate">
                            {card?.url || `/api/a2a/agents/${prof.id}`}
                          </div>

                          {/* Model to Use & Effort Badge on each A2A Agent Card */}
                          {displayedModelId && (
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-200 border border-purple-700/60">
                                Model: <strong className="text-white">{displayedModelId}</strong>
                              </span>
                              {modelSupportsEffort && displayedEffort ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  Effort: <strong className="uppercase">{displayedEffort}</strong>
                                </span>
                              ) : (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800">
                                  Effort: N/A
                                </span>
                              )}
                            </div>
                          )}

                          {card && (
                            <div className="flex items-center gap-1 flex-wrap">
                              <span
                                className={`inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.2 rounded border ${
                                  prof.a2a_connected !== false && isMounted
                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                                    : 'bg-slate-900 text-slate-400 border-slate-800'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    prof.a2a_connected !== false && isMounted
                                      ? 'bg-emerald-400 animate-pulse'
                                      : 'bg-slate-500'
                                  }`}
                                />
                                {prof.a2a_transport === 'remote-http-sse'
                                  ? 'A2A HTTP CONNECTED'
                                  : 'A2A LOCAL CONNECTED'}
                              </span>
                              {card.capabilities?.streaming && (
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                                  SSE STREAM
                                </span>
                              )}
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-900 text-slate-300 border border-slate-800">
                                v{card.protocolVersion}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Self-Review Guard Banner */}
                {claimResolvedPlan?.self_review_prevented && (
                  <div className="rounded-xl border border-amber-500/50 bg-amber-950/40 p-3 text-xs text-amber-200 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-amber-300">
                        Review Self-Review Guard Active (`prevent_self_review`)
                      </div>
                      <p className="mt-0.5 text-[11px] text-amber-200/90">
                        Ticket author is <code>{claimingTicket.owner}</code>. Assigning the same agent identity to review its own PR is blocked (`HTTP 409`). Choose a different reviewer{claimResolvedPlan.fallback_agent ? ` (recommended fallback: ${claimResolvedPlan.fallback_agent})` : ''}.
                      </p>
                    </div>
                  </div>
                )}

                {/* Model to Use, Effort & Lane Role Skills Selector for the Selected A2A Agent */}
                {(() => {
                  const selectedProf = agentProfiles.find((p) => p.id === selectedProfileId)
                  const availModels =
                    selectedProf?.supported_models ||
                    selectedProf?.a2a_card?.supported_models ||
                    []
                  const activeModelSpec = availModels.find((m) => m.id === claimModel)
                  const supportsEffort = claimCustomModelMode
                    ? true
                    : activeModelSpec
                      ? activeModelSpec.supports_effort
                      : Boolean(selectedProf?.supports_effort)
                  const effortLevels =
                    activeModelSpec?.effort_levels && activeModelSpec.effort_levels.length > 0
                      ? activeModelSpec.effort_levels
                      : ['low', 'medium', 'high']

                  return (
                    <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-indigo-200 flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                          Lane Routing Rule (`{claimingTicket.status}`) · Model, Effort &amp; Skills
                        </span>
                        <div className="flex items-center gap-1.5">
                          {claimResolvedPlan?.rule_matched && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                              Matched {claimResolvedPlan.rule_source} rule
                            </span>
                          )}
                          {activeModelSpec && !claimCustomModelMode && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
                              Tier: <strong className="text-indigo-300 uppercase">{activeModelSpec.tier}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] text-slate-300">
                              Model to Use (`--model`)
                            </label>
                            {availModels.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setClaimCustomModelMode((v) => !v)}
                                className="text-[10px] font-mono text-indigo-300 hover:text-white cursor-pointer"
                              >
                                {claimCustomModelMode ? 'Use preset list' : 'Custom slug'}
                              </button>
                            )}
                          </div>
                          {availModels.length > 0 && !claimCustomModelMode ? (
                            <select
                              value={claimModel}
                              onChange={(e) => handleSelectClaimModel(e.target.value)}
                              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                            >
                              {availModels.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.id}) · [{m.tier}]
                                  {m.supports_effort
                                    ? ` · effort: ${m.effort_levels.join('/')}`
                                    : ' · no effort'}
                                </option>
                              ))}
                              <option value="__custom__">+ Enter custom model slug...</option>
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={claimModel}
                              onChange={(e) => setClaimModel(e.target.value)}
                              placeholder="e.g. grok-4-reasoning or claude-sonnet-4-6"
                              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-300 mb-1">
                            Reasoning / Thinking Effort (`--effort`)
                          </label>
                          {supportsEffort ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {effortLevels.map((lvl) => {
                                const active = claimEffort === lvl
                                return (
                                  <button
                                    key={lvl}
                                    type="button"
                                    onClick={() => setClaimEffort(active ? '' : lvl)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase border transition cursor-pointer ${
                                      active
                                        ? 'bg-amber-500/25 text-amber-200 border-amber-400 shadow-sm shadow-amber-500/20'
                                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                                    }`}
                                  >
                                    {lvl}
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="rounded-lg bg-slate-950/90 border border-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-400">
                              Effort not supported for <code className="text-slate-200">{claimModel || 'this model'}</code> (fixed pass)
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Assigned Role Skills for this (lane, agent) */}
                      <div className="pt-2 border-t border-indigo-500/20 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] text-slate-300 font-semibold flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-purple-400" />
                            Skills Dispatched on `{claimingTicket.status}` ({claimSkills.length})
                          </span>
                          <select
                            value=""
                            onChange={(e) => {
                              const sid = e.target.value
                              if (sid && !claimSkills.includes(sid)) {
                                setClaimSkills([...claimSkills, sid])
                              }
                            }}
                            className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-[11px] text-slate-300"
                          >
                            <option value="">+ Attach skill...</option>
                            {skillsCatalog
                              .filter((s) => !claimSkills.includes(s.id))
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({s.id}) [{s.source}]
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {claimSkills.length === 0 ? (
                            <span className="text-[11px] font-mono text-slate-500">
                              Board `SKILL.md` only (configure automatic per-lane skills in Project Settings)
                            </span>
                          ) : (
                            claimSkills.map((sid) => {
                              const cat = skillsCatalog.find((s) => s.id === sid)
                              return (
                                <span
                                  key={sid}
                                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md bg-purple-950/80 text-purple-200 border border-purple-700/60"
                                >
                                  {cat?.name || sid}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setClaimSkills(claimSkills.filter((x) => x !== sid))
                                    }
                                    className="text-purple-400 hover:text-white cursor-pointer ml-0.5"
                                    title="Remove skill from this dispatch"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              )
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Assigned Agent / Session ID *
                    </label>
                    <input
                      type="text"
                      required
                      value={claimAgentId}
                      onChange={(e) => setClaimAgentId(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Git Branch Name
                    </label>
                    <input
                      type="text"
                      value={claimBranch}
                      onChange={(e) => setClaimBranch(e.target.value)}
                      className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Custom Worktree Path (Leave blank to use shared worktrees directory)
                  </label>
                  <input
                    type="text"
                    value={claimWorktree}
                    onChange={(e) => setClaimWorktree(e.target.value)}
                    placeholder={`Auto: ${
                      worktreesOverview?.worktrees_dir || '/workspaces/worktrees'
                    }/${activeSlug}-${claimingTicket.code.toLowerCase()}`}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                  />
                </div>

                <div className="flex flex-col gap-2 bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                  <label className="inline-flex items-center gap-2 text-xs text-emerald-300 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dispatchViaA2A}
                      onChange={(e) => setDispatchViaA2A(e.target.checked)}
                    />
                    Assign & dispatch task via A2A Protocol (`tasks/send` JSON-RPC 2.0)
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateWorktree}
                      onChange={(e) => setAutoCreateWorktree(e.target.checked)}
                    />
                    Auto-create Git Worktree (`git worktree add -B {claimBranch || 'board/...'}`) in shared worktrees directory
                  </label>
                  {selectedProfileId && (
                    <label className="inline-flex items-center gap-2 text-xs text-indigo-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={launchAgentNow}
                        onChange={(e) => setLaunchAgentNow(e.target.checked)}
                      />
                      Also spawn local Agent CLI subprocess inside worktree
                    </label>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setClaimingTicket(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    {claimingTicket.status === 'blocked'
                      ? (dispatchViaA2A ? 'Handover & Dispatch via A2A' : 'Handover & Resume Story')
                      : (dispatchViaA2A ? 'Claim & Dispatch via A2A' : 'Claim & Prepare Worktree')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Create New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleCreateProject}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col gap-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Create New Project</h3>
              <button
                type="button"
                onClick={() => setShowNewProject(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Project Slug *</label>
              <input
                type="text"
                required
                value={newProjSlug}
                onChange={(e) => setNewProjSlug(e.target.value)}
                placeholder="e.g. hipfire-v2"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Project Name *</label>
              <input
                type="text"
                required
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="e.g. Hipfire RDNA4 Kernel Advancements"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Repository Path</label>
              <input
                type="text"
                value={newProjRepo}
                onChange={(e) => setNewProjRepo(e.target.value)}
                placeholder="D:\code\inference\hipfire"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <textarea
                rows={2}
                value={newProjDesc}
                onChange={(e) => setNewProjDesc(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-xs text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewProject(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
