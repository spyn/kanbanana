import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Cpu,
  FileCode,
  Filter,
  FolderGit2,
  GitBranch,
  Lock,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sparkles,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type {
  AgentProfile,
  FeatureLock,
  ProjectWorktreesOverview,
  Ticket,
} from '../types'

export type AgentPlaySectorId = 'files' | 'tools' | 'worktrees' | 'locks'

export interface AgentPlayRosterNode {
  id: string
  provider: string
  codeName: string
  shortName: string
  accentHex: string
  tokensUsed: number
  tokensPerMin: number
  locShipped: number
  mergesCount: number
  eventsCount: number
  status: string
  statusBadge: string
  activeTicketCode?: string
  isOnline: boolean
}

export interface AgentPlayLogItem {
  id: string
  time: string
  epoch: number
  agentId: string
  agentName: string
  ticketCode: string
  ticketTitle: string
  action: 'DISPATCH' | 'WORKTREE' | 'LOCK' | 'TEST' | 'REVIEW' | 'MERGE' | 'BLOCKED'
  toolCall?: string
  jsonRpcMethod?: string
  branch?: string
  worktreePath?: string
  lockName?: string
  filesTouched?: string[]
  message: string
  tokenCost: number
  locAdded: number
  locRemoved: number
  status: 'running' | 'success' | 'blocked'
}

export interface AgentPlayRadialMapProps {
  projectName: string
  projectSlug: string
  agents: AgentPlayRosterNode[]
  agentProfiles: AgentProfile[]
  worktreesOverview?: ProjectWorktreesOverview | null
  tickets: Ticket[]
  locks: FeatureLock[]
  events: AgentPlayLogItem[]
  selectedAgentId: string
  onSelectAgent: (agentId: string) => void
  onInspectTicketCode: (code: string) => void
  activeLogFilter: string | null
  onFilterLogByNode: (filterToken: string | null) => void
  isLiveConnected: boolean
  isPlaying: boolean
  spectrumBars?: number[]
  getSpectrumLevels?: () => number[]
  dropFlashLabel: string | null
}

type NodeKind = 'core' | 'agent' | 'hub' | 'file' | 'tool' | 'worktree' | 'shell' | 'lock'

type InteractionFlavor = 'read' | 'write' | 'exec' | 'mcp' | 'lock' | 'error'

interface GraphNode {
  id: string
  label: string
  fullPath: string
  kind: NodeKind
  sector?: AgentPlaySectorId
  parentId?: string
  tx: number
  ty: number
  angle: number
  ring: number
  radius: number
  color: string
  touchCount: number
  locDelta: number
  flavor: InteractionFlavor
  lastAgentId?: string
  lastAgentName?: string
  agentsTouched: string[]
  ticketCode?: string
  filterToken?: string
  tokensPerMin?: number
  statusBadge?: string
  isDirty?: boolean
}

interface GraphLink {
  id: string
  sourceId: string
  targetId: string
  kind: 'spine' | 'agent-touch'
  color: string
  weight: number
  flavor: InteractionFlavor
  agentId?: string
}

interface AnimatedPos {
  x: number
  y: number
  heat: number
}

interface CometParticle {
  id: string
  sourceId: string
  targetId: string
  t: number
  speed: number
  color: string
  size: number
  curveOffset: number
}

interface ImpactRipple {
  id: string
  nodeId: string
  progress: number
  maxRadius: number
  color: string
}

interface ShockwaveRing {
  id: string
  progress: number
  color: string
}

const SECTOR_META: Record<
  AgentPlaySectorId,
  {
    label: string
    shortLabel: string
    color: string
    badgeClass: string
    startAngle: number
    endAngle: number
  }
> = {
  files: {
    label: 'Repo Files & Dirs',
    shortLabel: 'Files',
    color: '#10b981',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    startAngle: -Math.PI * 0.82,
    endAngle: -Math.PI * 0.12,
  },
  tools: {
    label: 'MCP & Coding Tools',
    shortLabel: 'Tools & MCP',
    color: '#a855f7',
    badgeClass: 'border-purple-500/40 bg-purple-500/15 text-purple-300',
    startAngle: -Math.PI * 0.08,
    endAngle: Math.PI * 0.36,
  },
  worktrees: {
    label: 'Worktrees & Shell',
    shortLabel: 'Worktrees & Shell',
    color: '#22d3ee',
    badgeClass: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
    startAngle: Math.PI * 0.4,
    endAngle: Math.PI * 0.82,
  },
  locks: {
    label: 'Locks & Guardrails',
    shortLabel: 'Locks & Alerts',
    color: '#f59e0b',
    badgeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    startAngle: Math.PI * 0.86,
    endAngle: Math.PI * 1.14,
  },
}

const FLAVOR_COLORS: Record<InteractionFlavor, string> = {
  read: '#22d3ee',
  write: '#10b981',
  exec: '#38bdf8',
  mcp: '#a855f7',
  lock: '#f59e0b',
  error: '#f43f5e',
}

function inferProviderIdLocal(raw: string): string {
  const s = (raw || '').toLowerCase()
  if (s.includes('claude') || s.includes('anthropic')) return 'claude'
  if (s.includes('kimi') || s.includes('moonshot')) return 'kimi'
  if (s.includes('antigravity') || s.includes('agy') || s.includes('gemini')) return 'antigravity'
  if (s.includes('codex') || s.includes('openai')) return 'codex'
  if (s.includes('minimax')) return 'minimax'
  if (s.includes('grok') || s.includes('xai')) return 'grok'
  return 'claude'
}

function normalizeDisplayPath(raw: string): { dir: string; base: string; clean: string } {
  const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  const parts = clean.split('/').filter(Boolean)
  if (parts.length === 0) {
    return { dir: 'workspace', base: raw, clean: raw }
  }
  if (parts.length === 1) {
    return { dir: 'root', base: parts[0], clean: parts[0] }
  }
  const base = parts[parts.length - 1]
  const dir = parts.slice(0, Math.min(2, parts.length - 1)).join('/')
  return { dir, base, clean }
}

function extractConciseToolName(rawTool?: string, rpcMethod?: string): string | null {
  if (rawTool) {
    const first = rawTool.split(',')[0].trim()
    const fnMatch = first.match(/^([A-Za-z0-9_./:-]+)\s*\(/)
    if (fnMatch) return fnMatch[1]
    return first.slice(0, 28)
  }
  if (rpcMethod) {
    const parts = rpcMethod.split('·').map((s) => s.trim())
    return parts[parts.length - 1].slice(0, 28)
  }
  return null
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return `rgba(34, 211, 238, ${alpha})`
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const AgentPlayRadialMap: React.FC<AgentPlayRadialMapProps> = ({
  projectName,
  projectSlug,
  agents,
  agentProfiles,
  worktreesOverview,
  tickets,
  locks,
  events,
  selectedAgentId,
  onSelectAgent,
  onInspectTicketCode,
  activeLogFilter,
  onFilterLogByNode,
  isLiveConnected,
  isPlaying,
  spectrumBars = [],
  getSpectrumLevels,
  dropFlashLabel,
}) => {
  const [enabledSectors, setEnabledSectors] = useState<Record<AgentPlaySectorId, boolean>>({
    files: true,
    tools: true,
    worktrees: true,
    locks: true,
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [mouseHudPos, setMouseHudPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isInViewport, setIsInViewport] = useState(true)
  const [isTabVisible, setIsTabVisible] = useState(
    () => (typeof document !== 'undefined' ? !document.hidden : true),
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const viewportSizeRef = useRef<{ width: number; height: number }>({ width: 760, height: 380 })
  const getSpectrumRef = useRef(getSpectrumLevels)
  getSpectrumRef.current = getSpectrumLevels

  // Animation state stored in refs for 60fps zero-re-render canvas painting
  const animPositionsRef = useRef<Map<string, AnimatedPos>>(new Map())
  const cometsRef = useRef<CometParticle[]>([])
  const ripplesRef = useRef<ImpactRipple[]>([])
  const shockwavesRef = useRef<ShockwaveRing[]>([])
  const seenEventKeysRef = useRef<Set<string>>(new Set())
  const initializedEventsRef = useRef(false)
  const prevDropFlashRef = useRef<string | null>(null)
  const dragStateRef = useRef<{
    dragging: boolean
    startX: number
    startY: number
    originPanX: number
    originPanY: number
    moved: boolean
  }>({
    dragging: false,
    startX: 0,
    startY: 0,
    originPanX: 0,
    originPanY: 0,
    moved: false,
  })

  // Keep latest reactive values accessible inside requestAnimationFrame loop
  const spectrumRef = useRef<number[]>(spectrumBars)
  spectrumRef.current = spectrumBars

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const panRef = useRef(pan)
  panRef.current = pan

  const hoveredIdRef = useRef<string | null>(hoveredNodeId)
  hoveredIdRef.current = hoveredNodeId

  const activeFilterRef = useRef<string | null>(activeLogFilter)
  activeFilterRef.current = activeLogFilter

  // Pause canvas rAF & comet timers when scrolled out of viewport or when browser tab is hidden
  useEffect(() => {
    const onVisChange = () => setIsTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisChange)
    return () => document.removeEventListener('visibilitychange', onVisChange)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      viewportSizeRef.current = { width: rect.width, height: rect.height }
    }

    const resizeObs =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const entry = entries[0]
            if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
              viewportSizeRef.current = {
                width: entry.contentRect.width,
                height: entry.contentRect.height,
              }
            }
          })
        : null
    resizeObs?.observe(container)

    const intersectObs =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries[0]) {
                setIsInViewport(entries[0].isIntersecting)
              }
            },
            { threshold: 0.02 },
          )
        : null
    intersectObs?.observe(container)

    return () => {
      resizeObs?.disconnect()
      intersectObs?.disconnect()
    }
  }, [isFullscreen])

  // Escape key closes fullscreen modal
  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullscreen])

  const codingAgents = useMemo(
    () => agents.filter((a) => a.id !== 'user'),
    [agents],
  )

  const focusedAgent = useMemo(
    () =>
      selectedAgentId !== 'all'
        ? codingAgents.find((a) => a.id === selectedAgentId) || null
        : null,
    [codingAgents, selectedAgentId],
  )

  // Build unified radial session graph from live transcripts, git worktrees, locks, tickets & replay events
  const graph = useMemo(() => {
    const leafMap = new Map<
      string,
      {
        id: string
        label: string
        fullPath: string
        kind: NodeKind
        sector: AgentPlaySectorId
        hubKey: string
        hubLabel: string
        touchCount: number
        locDelta: number
        flavor: InteractionFlavor
        lastAgentId?: string
        lastAgentName?: string
        agentsSet: Set<string>
        ticketCode?: string
        filterToken?: string
        isDirty?: boolean
      }
    >()

    const registerTouch = (opts: {
      id: string
      label: string
      fullPath: string
      kind: NodeKind
      sector: AgentPlaySectorId
      hubKey: string
      hubLabel: string
      flavor: InteractionFlavor
      agentId?: string
      agentName?: string
      locDelta?: number
      ticketCode?: string
      filterToken?: string
      isDirty?: boolean
    }) => {
      if (focusedAgent && opts.agentId && opts.agentId !== focusedAgent.id) {
        return
      }
      const existing = leafMap.get(opts.id)
      if (existing) {
        existing.touchCount += 1
        existing.locDelta += opts.locDelta || 0
        if (opts.flavor === 'error' || opts.flavor === 'write' || opts.flavor === 'lock') {
          existing.flavor = opts.flavor
        }
        if (opts.agentId) {
          existing.lastAgentId = opts.agentId
          existing.lastAgentName = opts.agentName || opts.agentId
          existing.agentsSet.add(opts.agentId)
        }
        if (opts.ticketCode) existing.ticketCode = opts.ticketCode
        if (opts.isDirty) existing.isDirty = true
      } else {
        const agentsSet = new Set<string>()
        if (opts.agentId) agentsSet.add(opts.agentId)
        leafMap.set(opts.id, {
          id: opts.id,
          label: opts.label,
          fullPath: opts.fullPath,
          kind: opts.kind,
          sector: opts.sector,
          hubKey: opts.hubKey,
          hubLabel: opts.hubLabel,
          touchCount: 1,
          locDelta: opts.locDelta || 0,
          flavor: opts.flavor,
          lastAgentId: opts.agentId,
          lastAgentName: opts.agentName,
          agentsSet,
          ticketCode: opts.ticketCode,
          filterToken: opts.filterToken,
          isDirty: opts.isDirty,
        })
      }
    }

    // 1. Ingest active timeline / live A2A log events
    events.forEach((ev) => {
      const evFlavor: InteractionFlavor =
        ev.action === 'BLOCKED' || ev.status === 'blocked'
          ? 'error'
          : ev.action === 'MERGE' || ev.action === 'WORKTREE'
            ? 'write'
            : ev.action === 'LOCK'
              ? 'lock'
              : ev.action === 'TEST'
                ? 'exec'
                : 'mcp'

      // Files touched in event
      ;(ev.filesTouched || []).forEach((fp) => {
        const { dir, base, clean } = normalizeDisplayPath(fp)
        registerTouch({
          id: `file:${clean}`,
          label: base,
          fullPath: clean,
          kind: 'file',
          sector: 'files',
          hubKey: `dir:${dir}`,
          hubLabel: `${dir}/`,
          flavor: ev.action === 'REVIEW' ? 'read' : 'write',
          agentId: ev.agentId,
          agentName: ev.agentName,
          locDelta: Math.round((ev.locAdded || 0) / Math.max(1, (ev.filesTouched || []).length)),
          ticketCode: ev.ticketCode,
          filterToken: base,
        })
      })

      // Tool / MCP / A2A invocation
      const toolName = extractConciseToolName(ev.toolCall, ev.jsonRpcMethod)
      if (toolName) {
        const isMcp =
          (ev.jsonRpcMethod || '').includes('mcp') ||
          (ev.jsonRpcMethod || '').includes('a2a') ||
          toolName.includes('ticket') ||
          toolName.includes('lock') ||
          toolName.includes('Task')
        registerTouch({
          id: `tool:${toolName}`,
          label: toolName,
          fullPath: ev.toolCall || ev.jsonRpcMethod || toolName,
          kind: 'tool',
          sector: 'tools',
          hubKey: isMcp ? 'hub:mcp-rpc' : 'hub:cli-tools',
          hubLabel: isMcp ? 'MCP / A2A' : 'CLI Tools',
          flavor: isMcp ? 'mcp' : evFlavor,
          agentId: ev.agentId,
          agentName: ev.agentName,
          ticketCode: ev.ticketCode,
          filterToken: toolName,
        })
      }

      // Isolated git worktree / branch
      if (ev.worktreePath || ev.branch) {
        const wtLabel = ev.ticketCode ? `wt/${ev.ticketCode.toLowerCase()}` : ev.branch || 'worktree'
        registerTouch({
          id: `wt:${ev.ticketCode || ev.branch}`,
          label: wtLabel,
          fullPath: `${ev.branch || wtLabel} · ${ev.worktreePath || 'isolated worktree'}`,
          kind: 'worktree',
          sector: 'worktrees',
          hubKey: 'hub:worktrees',
          hubLabel: 'Git Worktrees',
          flavor: ev.action === 'MERGE' ? 'write' : 'exec',
          agentId: ev.agentId,
          agentName: ev.agentName,
          locDelta: ev.locAdded,
          ticketCode: ev.ticketCode,
          filterToken: ev.ticketCode,
        })
      }

      // Shell / test execution
      if (ev.action === 'TEST') {
        const testVerb = toolName || 'pytest -q'
        registerTouch({
          id: `shell:${testVerb}`,
          label: `$ ${testVerb}`,
          fullPath: ev.message || testVerb,
          kind: 'shell',
          sector: 'worktrees',
          hubKey: 'hub:shell',
          hubLabel: 'Shell Verbs',
          flavor: 'exec',
          agentId: ev.agentId,
          agentName: ev.agentName,
          ticketCode: ev.ticketCode,
          filterToken: testVerb,
        })
      }

      // Locks & Blocked Guardrail Alerts
      if (ev.lockName || ev.action === 'LOCK') {
        const cleanLock = (ev.lockName || 'resource-lock').split('(')[0].trim()
        registerTouch({
          id: `lock:${cleanLock}`,
          label: cleanLock,
          fullPath: ev.lockName || cleanLock,
          kind: 'lock',
          sector: 'locks',
          hubKey: 'hub:locks',
          hubLabel: 'FIFO Locks',
          flavor: 'lock',
          agentId: ev.agentId,
          agentName: ev.agentName,
          ticketCode: ev.ticketCode,
          filterToken: cleanLock,
        })
      } else if (ev.action === 'BLOCKED') {
        registerTouch({
          id: `alert:${ev.ticketCode}`,
          label: `! $${ev.ticketCode}`,
          fullPath: `Guardrail Hold · $${ev.ticketCode}: ${ev.message}`,
          kind: 'lock',
          sector: 'locks',
          hubKey: 'hub:guardrails',
          hubLabel: 'Guardrails',
          flavor: 'error',
          agentId: ev.agentId,
          agentName: ev.agentName,
          ticketCode: ev.ticketCode,
          filterToken: ev.ticketCode,
        })
      }
    })

    // 2. Ingest real live CLI JSONL transcript telemetry (`files`, `commands`, `tools`, `action`)
    if (isLiveConnected) {
      agentProfiles.forEach((prof) => {
        const aid = inferProviderIdLocal(prof.provider || prof.name)
        const rosterMatch = codingAgents.find((a) => a.id === aid)
        const aName = rosterMatch?.shortName || prof.name

        ;(prof.recent_events || []).forEach((tev) => {
          const tFlavor: InteractionFlavor =
            tev.action === 'write'
              ? 'write'
              : tev.action === 'read'
                ? 'read'
                : tev.action === 'exec'
                  ? 'exec'
                  : tev.action === 'lock'
                    ? 'lock'
                    : tev.action === 'error'
                      ? 'error'
                      : 'mcp'

          ;(tev.files || []).forEach((fp) => {
            const { dir, base, clean } = normalizeDisplayPath(fp)
            registerTouch({
              id: `file:${clean}`,
              label: base,
              fullPath: clean,
              kind: 'file',
              sector: 'files',
              hubKey: `dir:${dir}`,
              hubLabel: `${dir}/`,
              flavor: tFlavor === 'write' ? 'write' : 'read',
              agentId: aid,
              agentName: aName,
              filterToken: base,
            })
          })

          ;(tev.tools || []).slice(0, 3).forEach((tname) => {
            const shortTool = tname.replace(/^mcp_kanbanana_/, '')
            const isMcp = tname.startsWith('mcp_') || tFlavor === 'mcp'
            registerTouch({
              id: `tool:${shortTool}`,
              label: shortTool,
              fullPath: `${tname} (${prof.name})`,
              kind: 'tool',
              sector: 'tools',
              hubKey: isMcp ? 'hub:mcp-rpc' : 'hub:cli-tools',
              hubLabel: isMcp ? 'MCP / A2A' : 'CLI Tools',
              flavor: isMcp ? 'mcp' : tFlavor,
              agentId: aid,
              agentName: aName,
              filterToken: shortTool,
            })
          })

          ;(tev.commands || []).forEach((cmd) => {
            registerTouch({
              id: `shell:${cmd}`,
              label: `$ ${cmd}`,
              fullPath: `Shell command (${prof.name}): ${cmd}`,
              kind: 'shell',
              sector: 'worktrees',
              hubKey: 'hub:shell',
              hubLabel: 'Shell Verbs',
              flavor: 'exec',
              agentId: aid,
              agentName: aName,
              filterToken: cmd.split(' ')[0],
            })
          })
        })
      })

      // 3. Ingest live git worktrees (`dirty_files` & `.kanbanana-agent.log` tails)
      ;(worktreesOverview?.worktrees || []).forEach((wt) => {
        const aid = wt.owner ? inferProviderIdLocal(wt.owner) : 'claude'
        if (wt.git_status.exists || wt.worktree_path) {
          registerTouch({
            id: `wt:${wt.ticket_code}`,
            label: `wt/${wt.ticket_code.toLowerCase()}`,
            fullPath: `${wt.branch_name || wt.ticket_code} · ${wt.worktree_path || 'worktree'}`,
            kind: 'worktree',
            sector: 'worktrees',
            hubKey: 'hub:worktrees',
            hubLabel: 'Git Worktrees',
            flavor: (wt.git_status.dirty_count || 0) > 0 ? 'write' : 'read',
            agentId: aid,
            agentName: wt.owner || aid,
            ticketCode: wt.ticket_code,
            filterToken: wt.ticket_code,
            isDirty: (wt.git_status.dirty_count || 0) > 0,
          })
        }

        ;(wt.git_status.dirty_files || []).slice(0, 10).forEach((df) => {
          // Strip git status prefix like "M backend/app/db.py" if present
          const stripped = df.replace(/^[MADRCU?!]{1,2}\s+/, '').trim()
          const { dir, base, clean } = normalizeDisplayPath(stripped)
          registerTouch({
            id: `file:${clean}`,
            label: base,
            fullPath: `${clean} (dirty in $${wt.ticket_code})`,
            kind: 'file',
            sector: 'files',
            hubKey: `dir:${dir}`,
            hubLabel: `${dir}/`,
            flavor: 'write',
            agentId: aid,
            agentName: wt.owner || aid,
            ticketCode: wt.ticket_code,
            filterToken: base,
            isDirty: true,
          })
        })

        ;(wt.git_status.agent_log_tail || []).forEach((wev) => {
          ;(wev.files || []).forEach((fp) => {
            const { dir, base, clean } = normalizeDisplayPath(fp)
            registerTouch({
              id: `file:${clean}`,
              label: base,
              fullPath: clean,
              kind: 'file',
              sector: 'files',
              hubKey: `dir:${dir}`,
              hubLabel: `${dir}/`,
              flavor: wev.action === 'write' ? 'write' : 'read',
              agentId: aid,
              agentName: wt.owner || aid,
              ticketCode: wt.ticket_code,
              filterToken: base,
            })
          })
          ;(wev.commands || []).forEach((cmd) => {
            registerTouch({
              id: `shell:${cmd}`,
              label: `$ ${cmd}`,
              fullPath: `$${wt.ticket_code} shell: ${cmd}`,
              kind: 'shell',
              sector: 'worktrees',
              hubKey: 'hub:shell',
              hubLabel: 'Shell Verbs',
              flavor: 'exec',
              agentId: aid,
              agentName: wt.owner || aid,
              ticketCode: wt.ticket_code,
              filterToken: cmd.split(' ')[0],
            })
          })
        })
      })

      // 4. Ensure active locks & in-flight tickets always appear on Live Board even when fresh
      locks.forEach((lk) => {
        const firstClaim = lk.active_claims[0]
        const aid = firstClaim ? inferProviderIdLocal(firstClaim.agent_id) : undefined
        if (!focusedAgent || !aid || aid === focusedAgent.id) {
          registerTouch({
            id: `lock:${lk.name}`,
            label: lk.name,
            fullPath: `${lk.name} (${lk.available_slots}/${lk.max_slots} free · ${lk.wait_queue.length} queued)`,
            kind: 'lock',
            sector: 'locks',
            hubKey: 'hub:locks',
            hubLabel: 'FIFO Locks',
            flavor: lk.active_claims.length > 0 ? 'lock' : 'read',
            agentId: aid,
            agentName: firstClaim?.agent_id,
            ticketCode: firstClaim?.ticket_code || undefined,
            filterToken: lk.name,
          })
        }
      })

      tickets.slice(0, 6).forEach((t) => {
        if (t.worktree_path || t.status === 'in-progress' || t.status === 'review') {
          const aid = t.owner ? inferProviderIdLocal(t.owner) : 'claude'
          registerTouch({
            id: `wt:${t.code}`,
            label: `wt/${t.code.toLowerCase()}`,
            fullPath: `${t.branch_name || `board/${t.code.toLowerCase()}`} · ${t.title}`,
            kind: 'worktree',
            sector: 'worktrees',
            hubKey: 'hub:worktrees',
            hubLabel: 'Git Worktrees',
            flavor: t.status === 'done' ? 'write' : t.status === 'blocked' ? 'error' : 'exec',
            agentId: aid,
            agentName: t.owner || aid,
            ticketCode: t.code,
            filterToken: t.code,
          })
        }
      })
    }

    // Seed baseline standby structure if Timeline is at 23:00 (simStep=0) or project has 0 events yet
    if (leafMap.size === 0) {
      const defaultAgent = focusedAgent?.id || 'claude'
      registerTouch({
        id: 'tool:claim_ticket',
        label: 'claim_ticket',
        fullPath: 'mcp/tools/call · claim_ticket',
        kind: 'tool',
        sector: 'tools',
        hubKey: 'hub:mcp-rpc',
        hubLabel: 'MCP / A2A',
        flavor: 'mcp',
        agentId: defaultAgent,
        filterToken: 'claim_ticket',
      })
      registerTouch({
        id: 'tool:sendSubscribe',
        label: 'a2a/sendSubscribe',
        fullPath: 'JSON-RPC 2.0 SSE Task Stream',
        kind: 'tool',
        sector: 'tools',
        hubKey: 'hub:mcp-rpc',
        hubLabel: 'MCP / A2A',
        flavor: 'mcp',
        agentId: defaultAgent,
        filterToken: 'sendSubscribe',
      })
      registerTouch({
        id: 'wt:main',
        label: 'branch/main',
        fullPath: `${projectSlug} · clean mainline`,
        kind: 'worktree',
        sector: 'worktrees',
        hubKey: 'hub:worktrees',
        hubLabel: 'Git Worktrees',
        flavor: 'read',
        agentId: defaultAgent,
      })
    }

    // Count total leaves per sector (before sector filter toggle) for header pill badges
    const sectorCounts: Record<AgentPlaySectorId, number> = {
      files: 0,
      tools: 0,
      worktrees: 0,
      locks: 0,
    }
    leafMap.forEach((item) => {
      sectorCounts[item.sector] += 1
    })

    // Filter visible leaves by enabledSectors & cap per sector to keep radial typography razor-sharp
    const MAX_PER_SECTOR: Record<AgentPlaySectorId, number> = {
      files: 14,
      tools: 8,
      worktrees: 8,
      locks: 6,
    }

    const nodes: GraphNode[] = []
    const nodeIds = new Set<string>()
    const links: GraphLink[] = []

    // 1. Center Core Node: EitherFocused Single Agent OR Kanbanana Coordinator Core
    const coreId = focusedAgent ? `agent:${focusedAgent.id}` : 'core:kanbanana'
    if (focusedAgent) {
      nodes.push({
        id: coreId,
        label: focusedAgent.shortName,
        fullPath: `${focusedAgent.codeName} · ${focusedAgent.tokensUsed.toLocaleString()} tok · +${focusedAgent.locShipped} LOC`,
        kind: 'agent',
        tx: 0,
        ty: 0,
        angle: 0,
        ring: 0,
        radius: 24,
        color: focusedAgent.accentHex,
        touchCount: focusedAgent.eventsCount,
        locDelta: focusedAgent.locShipped,
        flavor: 'mcp',
        agentsTouched: [focusedAgent.id],
        tokensPerMin: focusedAgent.tokensPerMin,
        statusBadge: focusedAgent.statusBadge,
        ticketCode: focusedAgent.activeTicketCode,
      })
      nodeIds.add(coreId)
    } else {
      nodes.push({
        id: coreId,
        label: projectSlug.toUpperCase().slice(0, 12),
        fullPath: `${projectName} · FastMCP + A2A Coordinator Hub`,
        kind: 'core',
        tx: 0,
        ty: 0,
        angle: 0,
        ring: 0,
        radius: 21,
        color: '#22d3ee',
        touchCount: events.length,
        locDelta: 0,
        flavor: 'mcp',
        agentsTouched: codingAgents.map((a) => a.id),
      })
      nodeIds.add(coreId)

      // Inner Ring (R1 = 84px): 6 Active Coding Agents
      const agentRingRadius = 84
      codingAgents.forEach((ag, idx) => {
        const theta = -Math.PI / 2 + (idx / Math.max(1, codingAgents.length)) * Math.PI * 2
        const agNodeId = `agent:${ag.id}`
        nodes.push({
          id: agNodeId,
          label: ag.shortName,
          fullPath: `${ag.codeName} (${ag.statusBadge}) · ${ag.tokensUsed.toLocaleString()} tok · ${ag.tokensPerMin.toLocaleString()} tok/m`,
          kind: 'agent',
          parentId: coreId,
          tx: Math.cos(theta) * agentRingRadius,
          ty: Math.sin(theta) * agentRingRadius,
          angle: theta,
          ring: 1,
          radius: ag.tokensPerMin > 0 || ag.status !== 'STANDBY' ? 14 : 11,
          color: ag.accentHex,
          touchCount: ag.eventsCount,
          locDelta: ag.locShipped,
          flavor: 'mcp',
          agentsTouched: [ag.id],
          tokensPerMin: ag.tokensPerMin,
          statusBadge: ag.statusBadge,
          ticketCode: ag.activeTicketCode,
        })
        nodeIds.add(agNodeId)
        links.push({
          id: `spine:${coreId}->${agNodeId}`,
          sourceId: coreId,
          targetId: agNodeId,
          kind: 'spine',
          color: ag.accentHex,
          weight: ag.status !== 'STANDBY' ? 1.4 : 0.7,
          flavor: 'mcp',
          agentId: ag.id,
        })
      })
    }

    // Rings depend on Constellation vs Single-Agent Drill-Down
    const hubRingRadius = focusedAgent ? 118 : 164
    const leafInnerRadius = focusedAgent ? 206 : 238
    const leafOuterRadius = focusedAgent ? 236 : 268

    const activeSectorIds = (Object.keys(SECTOR_META) as AgentPlaySectorId[]).filter(
      (s) => enabledSectors[s],
    )

    // In Single-Agent Drill-Down or when some sectors are toggled off, redistribute angular space smoothly!
    const allFourEnabled = activeSectorIds.length === 4 && !focusedAgent

    activeSectorIds.forEach((sectorId, sIdx) => {
      const sectorLeaves = Array.from(leafMap.values())
        .filter((item) => item.sector === sectorId)
        .sort((a, b) => b.touchCount - a.touchCount)
        .slice(0, MAX_PER_SECTOR[sectorId])

      if (sectorLeaves.length === 0) return

      let startAngle = SECTOR_META[sectorId].startAngle
      let endAngle = SECTOR_META[sectorId].endAngle
      if (!allFourEnabled) {
        const sliceSpan = (Math.PI * 2) / Math.max(1, activeSectorIds.length)
        const pad = 0.14
        startAngle = -Math.PI * 0.85 + sIdx * sliceSpan + pad / 2
        endAngle = -Math.PI * 0.85 + (sIdx + 1) * sliceSpan - pad / 2
      }

      // Group leaves by directory / category hub so radial branches look authentically like AgentPlay!
      const hubsMap = new Map<string, { hubKey: string; hubLabel: string; items: typeof sectorLeaves }>()
      sectorLeaves.forEach((leaf) => {
        const h = hubsMap.get(leaf.hubKey)
        if (h) {
          h.items.push(leaf)
        } else {
          hubsMap.set(leaf.hubKey, {
            hubKey: leaf.hubKey,
            hubLabel: leaf.hubLabel,
            items: [leaf],
          })
        }
      })

      const orderedLeaves = Array.from(hubsMap.values()).flatMap((h) => h.items)
      const leafAngles = new Map<string, number>()
      orderedLeaves.forEach((leaf, lIdx) => {
        const t =
          orderedLeaves.length === 1 ? 0.5 : lIdx / Math.max(1, orderedLeaves.length - 1)
        leafAngles.set(leaf.id, startAngle + t * (endAngle - startAngle))
      })

      // Emit Hub nodes at the centroid angle of their children
      hubsMap.forEach((hub) => {
        const childAngles = hub.items.map((it) => leafAngles.get(it.id) || 0)
        const avgAngle =
          childAngles.reduce((acc, a) => acc + a, 0) / Math.max(1, childAngles.length)
        const hubNodeId = `${sectorId}:${hub.hubKey}`
        const hubTouches = hub.items.reduce((acc, it) => acc + it.touchCount, 0)

        nodes.push({
          id: hubNodeId,
          label: hub.hubLabel,
          fullPath: `${SECTOR_META[sectorId].label} · ${hub.hubLabel} (${hub.items.length} targets)`,
          kind: 'hub',
          sector: sectorId,
          parentId: coreId,
          tx: Math.cos(avgAngle) * hubRingRadius,
          ty: Math.sin(avgAngle) * hubRingRadius,
          angle: avgAngle,
          ring: focusedAgent ? 1 : 2,
          radius: Math.min(9.5, 5.5 + Math.log2(hubTouches + 1) * 1.1),
          color: SECTOR_META[sectorId].color,
          touchCount: hubTouches,
          locDelta: hub.items.reduce((acc, it) => acc + it.locDelta, 0),
          flavor: sectorId === 'files' ? 'write' : sectorId === 'tools' ? 'mcp' : sectorId === 'locks' ? 'lock' : 'exec',
          agentsTouched: Array.from(
            new Set(hub.items.flatMap((it) => Array.from(it.agentsSet))),
          ),
        })

        // Connect hub to Core in Single-Agent mode (or subtle structural spine in Constellation mode)
        links.push({
          id: `spine:${coreId}->${hubNodeId}`,
          sourceId: coreId,
          targetId: hubNodeId,
          kind: 'spine',
          color: SECTOR_META[sectorId].color,
          weight: focusedAgent ? 1.2 : 0.55,
          flavor: 'read',
        })

        // Emit Leaf nodes & link Hub -> Leaf + Agent -> Leaf
        hub.items.forEach((leaf) => {
          const globalIdx = orderedLeaves.indexOf(leaf)
          const theta = leafAngles.get(leaf.id) || avgAngle
          // Stagger radial distance slightly when >5 leaves in a sector so adjacent filenames never collide
          const leafR =
            orderedLeaves.length > 5 && globalIdx % 2 === 1 ? leafOuterRadius : leafInnerRadius
          const leafColor = FLAVOR_COLORS[leaf.flavor] || SECTOR_META[sectorId].color
          const scaledRadius = Math.min(11, 5 + Math.sqrt(leaf.touchCount) * 1.6)

          nodes.push({
            id: leaf.id,
            label: leaf.label,
            fullPath: leaf.fullPath,
            kind: leaf.kind,
            sector: sectorId,
            parentId: hubNodeId,
            tx: Math.cos(theta) * leafR,
            ty: Math.sin(theta) * leafR,
            angle: theta,
            ring: focusedAgent ? 2 : 3,
            radius: scaledRadius,
            color: leafColor,
            touchCount: leaf.touchCount,
            locDelta: leaf.locDelta,
            flavor: leaf.flavor,
            lastAgentId: leaf.lastAgentId,
            lastAgentName: leaf.lastAgentName,
            agentsTouched: Array.from(leaf.agentsSet),
            ticketCode: leaf.ticketCode,
            filterToken: leaf.filterToken,
            isDirty: leaf.isDirty,
          })

          // Hub -> Leaf structural radial branch
          links.push({
            id: `spine:${hubNodeId}->${leaf.id}`,
            sourceId: hubNodeId,
            targetId: leaf.id,
            kind: 'spine',
            color: leafColor,
            weight: Math.min(2.0, 0.8 + leaf.touchCount * 0.2),
            flavor: leaf.flavor,
          })

          // In Constellation mode, also connect each Agent that touched this leaf via a curved telemetry arc!
          if (!focusedAgent) {
            leaf.agentsSet.forEach((aid) => {
              const agentNodeId = `agent:${aid}`
              if (nodeIds.has(agentNodeId)) {
                links.push({
                  id: `touch:${agentNodeId}->${leaf.id}`,
                  sourceId: agentNodeId,
                  targetId: leaf.id,
                  kind: 'agent-touch',
                  color: leafColor,
                  weight: Math.min(2.2, 0.75 + leaf.touchCount * 0.25),
                  flavor: leaf.flavor,
                  agentId: aid,
                })
              }
            })
          }
        })
      })
    })

    const nodeById = new Map<string, GraphNode>()
    nodes.forEach((n) => nodeById.set(n.id, n))

    return {
      nodes,
      links,
      nodeById,
      sectorCounts,
      totalLeaves: leafMap.size,
    }
  }, [
    agentProfiles,
    codingAgents,
    enabledSectors,
    events,
    focusedAgent,
    isLiveConnected,
    locks,
    projectName,
    projectSlug,
    tickets,
    worktreesOverview,
  ])

  const graphRef = useRef(graph)
  graphRef.current = graph

  // Spawn CometParticle helper
  const spawnComet = useCallback(
    (sourceId: string, targetId: string, color: string, size = 3.2) => {
      const g = graphRef.current
      if (!g.nodeById.has(sourceId) || !g.nodeById.has(targetId)) return
      if (cometsRef.current.length > 44) {
        cometsRef.current.shift()
      }
      cometsRef.current.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sourceId,
        targetId,
        t: 0,
        speed: 0.016 + Math.random() * 0.012,
        color,
        size,
        curveOffset: (Math.random() - 0.5) * 34,
      })
      const srcAnim = animPositionsRef.current.get(sourceId)
      if (srcAnim) srcAnim.heat = Math.min(1, srcAnim.heat + 0.55)
    },
    [],
  )

  // Fire live comet particles whenever new events arrive (from live agents OR replay timeline scrubber!)
  useEffect(() => {
    const currentKeys = new Set(events.map((e) => e.id))
    // Support backward scrubbing
    seenEventKeysRef.current.forEach((k) => {
      if (!currentKeys.has(k)) seenEventKeysRef.current.delete(k)
    })

    if (!initializedEventsRef.current) {
      events.forEach((e) => seenEventKeysRef.current.add(e.id))
      initializedEventsRef.current = true
      // Fire an opening burst for the latest 2 events so the HUD feels alive immediately on open
      events.slice(-2).forEach((ev) => {
        const srcId =
          selectedAgentId !== 'all' ? `agent:${selectedAgentId}` : `agent:${ev.agentId}`
        ;(ev.filesTouched || []).slice(0, 3).forEach((fp) => {
          const { clean } = normalizeDisplayPath(fp)
          spawnComet(srcId, `file:${clean}`, '#10b981', 3.4)
        })
        const toolName = extractConciseToolName(ev.toolCall, ev.jsonRpcMethod)
        if (toolName) {
          spawnComet(srcId, `tool:${toolName}`, '#a855f7', 3.0)
        }
      })
      return
    }

    const newlyArrived = events.filter((e) => !seenEventKeysRef.current.has(e.id))
    newlyArrived.forEach((e) => seenEventKeysRef.current.add(e.id))
    if (newlyArrived.length === 0) return

    newlyArrived.slice(-4).forEach((ev) => {
      if (selectedAgentId !== 'all' && ev.agentId !== selectedAgentId) return
      const srcId = `agent:${ev.agentId}`
      const evColor =
        ev.action === 'MERGE'
          ? '#10b981'
          : ev.action === 'BLOCKED'
            ? '#f43f5e'
            : ev.action === 'LOCK'
              ? '#f59e0b'
              : '#22d3ee'

      ;(ev.filesTouched || []).slice(0, 4).forEach((fp) => {
        const { clean } = normalizeDisplayPath(fp)
        spawnComet(srcId, `file:${clean}`, evColor, 3.6)
      })

      const toolName = extractConciseToolName(ev.toolCall, ev.jsonRpcMethod)
      if (toolName) {
        spawnComet(srcId, `tool:${toolName}`, '#a855f7', 3.1)
      }

      if (ev.worktreePath || ev.branch) {
        spawnComet(srcId, `wt:${ev.ticketCode || ev.branch}`, '#22d3ee', 3.2)
      }

      if (ev.lockName || ev.action === 'LOCK') {
        const cleanLock = (ev.lockName || 'resource-lock').split('(')[0].trim()
        spawnComet(srcId, `lock:${cleanLock}`, '#f59e0b', 3.4)
      } else if (ev.action === 'BLOCKED') {
        spawnComet(srcId, `alert:${ev.ticketCode}`, '#f43f5e', 3.8)
      }
    })
  }, [events, selectedAgentId, spawnComet])

  // Continuous live token-velocity telemetry packets when agents are actively burning tokens
  useEffect(() => {
    if (!isTabVisible || (!isInViewport && !isFullscreen)) return
    const activeRunners = codingAgents.filter(
      (a) =>
        (selectedAgentId === 'all' || a.id === selectedAgentId) &&
        (a.tokensPerMin > 0 ||
          (isLiveConnected && a.status !== 'STANDBY') ||
          (!isLiveConnected && isPlaying && a.status !== 'STANDBY')),
    )
    if (activeRunners.length === 0) return

    const intervalMs = 950
    const timer = window.setInterval(() => {
      const g = graphRef.current
      activeRunners.forEach((runner) => {
        const srcId = `agent:${runner.id}`
        const myTargets = g.nodes.filter(
          (n) =>
            n.ring >= (selectedAgentId === 'all' ? 3 : 2) &&
            n.agentsTouched.includes(runner.id),
        )
        if (myTargets.length > 0) {
          const pick = myTargets[Math.floor(Math.random() * myTargets.length)]
          spawnComet(srcId, pick.id, pick.color, 2.8)
        }
      })
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [codingAgents, isFullscreen, isInViewport, isLiveConnected, isPlaying, isTabVisible, selectedAgentId, spawnComet])

  // Trigger twin radial shockwaves on PR merge / 174 BPM drop!
  useEffect(() => {
    if (dropFlashLabel && dropFlashLabel !== prevDropFlashRef.current) {
      shockwavesRef.current.push(
        { id: `sw-1-${Date.now()}`, progress: 0, color: '#10b981' },
        { id: `sw-2-${Date.now()}`, progress: -0.16, color: '#22d3ee' },
      )
    }
    prevDropFlashRef.current = dropFlashLabel
  }, [dropFlashLabel])

  // 60fps HTML5 Canvas 2D High-DPI Renderer (pauses automatically when tab hidden or scrolled off-screen)
  useEffect(() => {
    if (!isTabVisible || (!isInViewport && !isFullscreen)) return
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    ctxRef.current = canvas.getContext('2d')
    let rafId = 0
    let lastTime = performance.now()

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      const { width: w, height: h } = viewportSizeRef.current
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetW = Math.max(1, Math.floor(w * dpr))
      const targetH = Math.max(1, Math.floor(h * dpr))
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
        ctxRef.current = canvas.getContext('2d')
      }

      const ctx = ctxRef.current
      if (!ctx) {
        rafId = window.requestAnimationFrame(render)
        return
      }

      const g = graphRef.current
      const spec = getSpectrumRef.current ? getSpectrumRef.current() : spectrumRef.current
      const subBass = ((spec[0] || 0) + (spec[1] || 0) + (spec[2] || 0)) / 3
      const midSnap = ((spec[4] || 0) + (spec[5] || 0)) / 2

      // Auto-fit base scale to container dimensions so full radial tree fits cleanly at zoom=1
      const minDim = Math.min(w, h)
      const baseScale = Math.max(0.54, Math.min(1.28, minDim / 600))
      const effectiveScale = baseScale * zoomRef.current
      const cx = w / 2 + panRef.current.x
      const cy = h / 2 + panRef.current.y

      // Smoothly interpolate node positions & decay node heat
      const animMap = animPositionsRef.current
      const activeIds = new Set<string>()
      g.nodes.forEach((node) => {
        activeIds.add(node.id)
        const cur = animMap.get(node.id)
        if (!cur) {
          animMap.set(node.id, { x: node.tx * 0.25, y: node.ty * 0.25, heat: 0.35 })
        } else {
          cur.x += (node.tx - cur.x) * 0.14
          cur.y += (node.ty - cur.y) * 0.14
          cur.heat = Math.max(0, cur.heat - dt * 0.32)
        }
      })
      animMap.forEach((_, id) => {
        if (!activeIds.has(id)) animMap.delete(id)
      })

      ctx.save()
      ctx.scale(dpr, dpr)

      // 1. Deep Neuro-HUD Canvas Background + Subtle Vignette
      ctx.fillStyle = '#080b11'
      ctx.fillRect(0, 0, w, h)

      const bgGrad = ctx.createRadialGradient(cx, cy, 12, cx, cy, Math.max(w, h) * 0.65)
      bgGrad.addColorStop(0, `rgba(34, 211, 238, ${0.055 + subBass * 0.08})`)
      bgGrad.addColorStop(0.45, 'rgba(16, 185, 129, 0.02)')
      bgGrad.addColorStop(1, 'rgba(7, 9, 14, 0)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(effectiveScale, effectiveScale)

      // 2. Concentric Radar / Session Depth Rings
      const guideRings = selectedAgentId !== 'all' ? [118, 220] : [84, 164, 252]
      guideRings.forEach((r, idx) => {
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.strokeStyle =
          idx === 0
            ? `rgba(56, 189, 248, ${0.13 + subBass * 0.1})`
            : 'rgba(51, 65, 85, 0.26)'
        ctx.lineWidth = 1 / effectiveScale
        if (idx > 0) ctx.setLineDash([3, 5])
        ctx.stroke()
        ctx.setLineDash([])
      })

      // Subtle sector divider ticks on outer perimeter when all 4 sectors active in Constellation mode
      if (selectedAgentId === 'all') {
        ;(Object.keys(SECTOR_META) as AgentPlaySectorId[]).forEach((sid) => {
          if (!enabledSectors[sid]) return
          const meta = SECTOR_META[sid]
          const midA = (meta.startAngle + meta.endAngle) / 2
          const labelR = 294
          const lx = Math.cos(midA) * labelR
          const ly = Math.sin(midA) * labelR
          ctx.save()
          ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.fillStyle = hexToRgba(meta.color, 0.52)
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(meta.shortLabel.toUpperCase(), lx, ly)
          ctx.restore()
        })
      }

      // 3. Radial Shockwaves (PR Merge / 174 BPM Drop)
      for (let i = shockwavesRef.current.length - 1; i >= 0; i--) {
        const sw = shockwavesRef.current[i]
        sw.progress += dt * 0.72
        if (sw.progress >= 1) {
          shockwavesRef.current.splice(i, 1)
          continue
        }
        if (sw.progress < 0) continue
        const swR = 20 + sw.progress * 310
        const alpha = (1 - sw.progress) * 0.65
        ctx.beginPath()
        ctx.arc(0, 0, swR, 0, Math.PI * 2)
        ctx.strokeStyle = hexToRgba(sw.color, alpha)
        ctx.lineWidth = (3.2 * (1 - sw.progress * 0.6)) / effectiveScale
        ctx.stroke()
      }

      const hoveredId = hoveredIdRef.current
      const activeFilter = activeFilterRef.current

      // 4. Curved Bezier Edges (Structural Spine + Agent-to-Target Telemetry Arcs)
      g.links.forEach((link) => {
        const sPos = animMap.get(link.sourceId)
        const tPos = animMap.get(link.targetId)
        if (!sPos || !tPos) return

        const isHoveredLink =
          hoveredId !== null && (link.sourceId === hoveredId || link.targetId === hoveredId)
        const targetAnim = animMap.get(link.targetId)
        const targetHeat = targetAnim?.heat || 0

        ctx.beginPath()
        ctx.moveTo(sPos.x, sPos.y)

        if (link.kind === 'spine') {
          // Gentle radial tree curve pulled slightly toward angular bisector
          const cpx = (sPos.x + tPos.x) * 0.52
          const cpy = (sPos.y + tPos.y) * 0.52
          ctx.quadraticCurveTo(cpx, cpy, tPos.x, tPos.y)
          const baseAlpha = isHoveredLink ? 0.68 : 0.19 + targetHeat * 0.35
          ctx.strokeStyle = hexToRgba(link.color, baseAlpha)
          ctx.lineWidth = (isHoveredLink ? 1.8 : 1.05) / effectiveScale
        } else {
          // Agent -> Target curved quadratic arc bowed gently around core
          const midX = (sPos.x + tPos.x) * 0.38
          const midY = (sPos.y + tPos.y) * 0.38
          ctx.quadraticCurveTo(midX, midY, tPos.x, tPos.y)
          const baseAlpha = isHoveredLink
            ? 0.78
            : hoveredId
              ? 0.06
              : 0.13 + targetHeat * 0.42 + midSnap * 0.08
          ctx.strokeStyle = hexToRgba(link.color, baseAlpha)
          ctx.lineWidth = (isHoveredLink ? 2.0 : 0.95 + targetHeat * 0.9) / effectiveScale
        }
        ctx.stroke()
      })

      // 5. Traveling Comet Particles along Bezier paths
      for (let i = cometsRef.current.length - 1; i >= 0; i--) {
        const c = cometsRef.current[i]
        const sPos = animMap.get(c.sourceId)
        const tPos = animMap.get(c.targetId)
        if (!sPos || !tPos) {
          cometsRef.current.splice(i, 1)
          continue
        }
        c.t += c.speed * (1 + subBass * 0.45)
        if (c.t >= 1) {
          // Trigger target node heat & expanding impact ripple!
          const tAnim = animMap.get(c.targetId)
          if (tAnim) tAnim.heat = 1
          const tNode = g.nodeById.get(c.targetId)
          if (ripplesRef.current.length < 32) {
            ripplesRef.current.push({
              id: `rip-${c.id}`,
              nodeId: c.targetId,
              progress: 0,
              maxRadius: (tNode?.radius || 7) + 15,
              color: c.color,
            })
          }
          cometsRef.current.splice(i, 1)
          continue
        }

        const ctrlX = (sPos.x + tPos.x) * 0.42 + c.curveOffset * 0.35
        const ctrlY = (sPos.y + tPos.y) * 0.42 - c.curveOffset * 0.35
        const pointAt = (u: number) => {
          const inv = 1 - u
          return {
            x: inv * inv * sPos.x + 2 * inv * u * ctrlX + u * u * tPos.x,
            y: inv * inv * sPos.y + 2 * inv * u * ctrlY + u * u * tPos.y,
          }
        }

        const head = pointAt(c.t)
        const tail1 = pointAt(Math.max(0, c.t - 0.06))
        const tail2 = pointAt(Math.max(0, c.t - 0.13))

        // Glowing comet tail
        const grad = ctx.createLinearGradient(tail2.x, tail2.y, head.x, head.y)
        grad.addColorStop(0, hexToRgba(c.color, 0))
        grad.addColorStop(0.55, hexToRgba(c.color, 0.45))
        grad.addColorStop(1, '#ffffff')

        ctx.beginPath()
        ctx.moveTo(tail2.x, tail2.y)
        ctx.quadraticCurveTo(tail1.x, tail1.y, head.x, head.y)
        ctx.strokeStyle = grad
        ctx.lineWidth = (c.size * 0.95) / effectiveScale
        ctx.lineCap = 'round'
        ctx.stroke()

        // Glowing comet head (fast alpha halo without expensive per-frame shadowBlur)
        const headR = (c.size * 1.1) / Math.sqrt(effectiveScale)
        ctx.beginPath()
        ctx.arc(head.x, head.y, headR * 2.3, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(c.color, 0.34)
        ctx.fill()

        ctx.beginPath()
        ctx.arc(head.x, head.y, headR, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }

      // 6. Expanding Impact Ripples on Target Nodes
      for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
        const rip = ripplesRef.current[i]
        const nPos = animMap.get(rip.nodeId)
        if (!nPos) {
          ripplesRef.current.splice(i, 1)
          continue
        }
        rip.progress += dt * 1.55
        if (rip.progress >= 1) {
          ripplesRef.current.splice(i, 1)
          continue
        }
        const r = 4 + rip.progress * rip.maxRadius
        ctx.beginPath()
        ctx.arc(nPos.x, nPos.y, r, 0, Math.PI * 2)
        ctx.strokeStyle = hexToRgba(rip.color, (1 - rip.progress) * 0.75)
        ctx.lineWidth = 1.6 / effectiveScale
        ctx.stroke()
      }

      // 7. Nodes + Spinning Token-Velocity Orbital Halos + Crisp Radial Labels
      const secNow = now / 1000
      g.nodes.forEach((node) => {
        const pos = animMap.get(node.id)
        if (!pos) return

        const isHovered = hoveredId === node.id
        const isFilterMatch =
          Boolean(activeFilter) &&
          Boolean(node.filterToken) &&
          node.filterToken?.toLowerCase() === activeFilter?.toLowerCase()
        const heat = pos.heat
        const pulseBoost =
          node.kind === 'core'
            ? subBass * 3.8
            : node.kind === 'agent' && (node.tokensPerMin || 0) > 0
              ? Math.sin(secNow * 5 + node.angle) * 1.2 + subBass * 1.8
              : heat * 2.2
        const r = node.radius + pulseBoost + (isHovered ? 2.2 : 0)

        // Outer heat / active glow
        if (heat > 0.08 || isHovered || isFilterMatch || node.kind === 'core') {
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r + 5.5, 0, Math.PI * 2)
          ctx.fillStyle = hexToRgba(
            node.color,
            isHovered || isFilterMatch ? 0.28 : 0.1 + heat * 0.22 + subBass * 0.08,
          )
          ctx.fill()
        }

        // Spinning orbital arc on Agent nodes proportional to tokens/min burn rate!
        if (node.kind === 'agent') {
          const tokRate = node.tokensPerMin || 0
          const spinSpeed = tokRate > 0 ? Math.min(5.5, 0.9 + tokRate / 6500) : 0.25
          const orbitR = r + 4.2
          const rot = secNow * spinSpeed + node.angle
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, orbitR, rot, rot + (tokRate > 0 ? Math.PI * 1.25 : Math.PI * 0.55))
          ctx.strokeStyle = hexToRgba(node.color, tokRate > 0 ? 0.88 : 0.35)
          ctx.lineWidth = (tokRate > 0 ? 1.9 : 1.1) / effectiveScale
          ctx.stroke()

          if (tokRate > 0) {
            ctx.beginPath()
            ctx.arc(pos.x, pos.y, orbitR, rot + Math.PI * 1.45, rot + Math.PI * 1.82)
            ctx.strokeStyle = hexToRgba('#22d3ee', 0.7)
            ctx.lineWidth = 1.4 / effectiveScale
            ctx.stroke()
          }
        }

        // Core node dual tech ring
        if (node.kind === 'core') {
          const rot = -secNow * 0.65
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, r + 5, rot, rot + Math.PI * 1.5)
          ctx.strokeStyle = hexToRgba('#10b981', 0.65 + subBass * 0.25)
          ctx.lineWidth = 1.6 / effectiveScale
          ctx.stroke()
        }

        // Node body
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
        ctx.fillStyle =
          node.kind === 'hub'
            ? '#0f172a'
            : node.kind === 'core' || node.kind === 'agent'
              ? '#0b111d'
              : hexToRgba(node.color, 0.22 + heat * 0.45)
        ctx.fill()

        ctx.lineWidth = (isHovered || isFilterMatch ? 2.4 : 1.45) / effectiveScale
        ctx.strokeStyle = isFilterMatch ? '#ffffff' : node.color
        ctx.stroke()

        // Inner bright nucleus for leaf nodes / dirty indicator
        if (node.kind !== 'hub') {
          ctx.beginPath()
          ctx.arc(
            pos.x,
            pos.y,
            node.kind === 'core' || node.kind === 'agent' ? r * 0.36 : Math.max(1.8, r * 0.38),
            0,
            Math.PI * 2,
          )
          ctx.fillStyle = node.isDirty ? '#10b981' : node.color
          ctx.fill()
        }

        // Typography: Crisp radial labels
        ctx.save()
        if (node.ring === 0) {
          ctx.font = '800 10px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.fillStyle = '#f8fafc'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(node.label, pos.x, pos.y + r + 7)
          if (node.statusBadge) {
            ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
            ctx.fillStyle = node.color
            ctx.fillText(node.statusBadge, pos.x, pos.y + r + 19)
          }
        } else if (node.kind === 'agent') {
          ctx.font = '700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.fillStyle = isHovered ? '#ffffff' : '#e2e8f0'
          ctx.textAlign = 'center'
          ctx.textBaseline = pos.y >= 0 ? 'top' : 'bottom'
          const yOff = pos.y >= 0 ? r + 6 : -(r + 6)
          ctx.fillText(node.label, pos.x, pos.y + yOff)
        } else if (node.kind === 'hub') {
          ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.fillStyle = hexToRgba(node.color, isHovered ? 1 : 0.78)
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(node.label, pos.x, pos.y - r - 3)
        } else {
          // Outer Leaf Node: orient outward along radial angle so text never crosses the circle!
          const normA = ((node.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
          const isLeftHalf = normA > Math.PI * 0.5 && normA < Math.PI * 1.5
          const labelDist = r + 5.5
          const lx = pos.x + Math.cos(node.angle) * labelDist
          const ly = pos.y + Math.sin(node.angle) * labelDist

          ctx.translate(lx, ly)
          let rotAngle = node.angle
          if (isLeftHalf) {
            rotAngle += Math.PI
          }
          // Clamp tilt gently so labels stay effortless to read
          ctx.rotate(rotAngle * 0.58)
          ctx.font =
            isHovered || isFilterMatch || heat > 0.35
              ? '700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace'
              : '500 9px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.fillStyle =
            isHovered || isFilterMatch
              ? '#ffffff'
              : heat > 0.25
                ? '#e2e8f0'
                : 'rgba(203, 213, 225, 0.84)'
          ctx.textAlign = isLeftHalf ? 'right' : 'left'
          ctx.textBaseline = 'middle'
          const displayLabel =
            node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label
          ctx.fillText(displayLabel, 0, 0)
        }
        ctx.restore()
      })

      ctx.restore()
      ctx.restore()

      rafId = window.requestAnimationFrame(render)
    }

    rafId = window.requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(rafId)
  }, [enabledSectors, selectedAgentId])

  // Convert client mouse coordinates to World Coordinates for node hit-testing
  const hitTestNodeAtClientPos = useCallback(
    (clientX: number, clientY: number): GraphNode | null => {
      const container = containerRef.current
      if (!container) return null
      const rect = container.getBoundingClientRect()
      const mx = clientX - rect.left
      const my = clientY - rect.top
      const minDim = Math.min(rect.width, rect.height)
      const baseScale = Math.max(0.54, Math.min(1.28, minDim / 600))
      const effectiveScale = baseScale * zoomRef.current
      const wx = (mx - (rect.width / 2 + panRef.current.x)) / effectiveScale
      const wy = (my - (rect.height / 2 + panRef.current.y)) / effectiveScale

      const g = graphRef.current
      const animMap = animPositionsRef.current
      let closest: GraphNode | null = null
      let bestDist = Infinity

      g.nodes.forEach((n) => {
        const pos = animMap.get(n.id)
        if (!pos) return
        const dx = wx - pos.x
        const dy = wy - pos.y
        const dist = Math.hypot(dx, dy)
        const hitRadius = Math.max(12, n.radius + 7)
        if (dist <= hitRadius && dist < bestDist) {
          bestDist = dist
          closest = n
        }
      })
      return closest
    },
    [],
  )

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragStateRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      originPanX: pan.x,
      originPanY: pan.y,
      moved: false,
    }
  }

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const container = containerRef.current
    if (container) {
      const rect = container.getBoundingClientRect()
      setMouseHudPos({
        x: Math.min(rect.width - 250, Math.max(12, e.clientX - rect.left + 14)),
        y: Math.min(rect.height - 125, Math.max(12, e.clientY - rect.top + 14)),
      })
    }

    if (dragStateRef.current.dragging) {
      const dx = e.clientX - dragStateRef.current.startX
      const dy = e.clientY - dragStateRef.current.startY
      if (Math.hypot(dx, dy) > 4) {
        dragStateRef.current.moved = true
      }
      setPan({
        x: dragStateRef.current.originPanX + dx,
        y: dragStateRef.current.originPanY + dy,
      })
      return
    }

    const hit = hitTestNodeAtClientPos(e.clientX, e.clientY)
    setHoveredNodeId(hit ? hit.id : null)
  }

  const handlePointerUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasMoved = dragStateRef.current.moved
    dragStateRef.current.dragging = false
    if (wasMoved) return

    const hit = hitTestNodeAtClientPos(e.clientX, e.clientY)
    if (!hit) return

    if (hit.kind === 'agent') {
      const aid = hit.id.replace('agent:', '')
      onSelectAgent(selectedAgentId === aid ? 'all' : aid)
      return
    }

    if (hit.kind === 'core') {
      onSelectAgent('all')
      return
    }

    if (hit.kind === 'worktree' && hit.ticketCode) {
      onInspectTicketCode(hit.ticketCode)
      return
    }

    if (hit.filterToken) {
      const next =
        activeLogFilter?.toLowerCase() === hit.filterToken.toLowerCase()
          ? null
          : hit.filterToken
      onFilterLogByNode(next)
      if (hit.ticketCode) {
        onInspectTicketCode(hit.ticketCode)
      }
    } else if (hit.ticketCode) {
      onInspectTicketCode(hit.ticketCode)
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 1.12 : 0.89
    setZoom((prev) => Math.min(2.6, Math.max(0.55, Number((prev * delta).toFixed(2)))))
  }

  const toggleSector = (sectorId: AgentPlaySectorId) => {
    setEnabledSectors((prev) => {
      const next = { ...prev, [sectorId]: !prev[sectorId] }
      // Prevent disabling every sector at once
      if (!Object.values(next).some(Boolean)) return prev
      return next
    })
  }

  const resetCamera = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const hoveredNode = hoveredNodeId ? graph.nodeById.get(hoveredNodeId) || null : null

  const renderPanelContent = (expanded: boolean) => (
    <div
      className={`rounded-2xl border border-slate-800 bg-[#0b0e15] flex flex-col font-mono overflow-hidden ${
        expanded
          ? 'fixed inset-3 sm:inset-6 z-50 shadow-2xl shadow-cyan-950/60 border-cyan-500/40'
          : 'w-full'
      }`}
    >
      {/* Header Bar: Title + Sector Filter Pills + Camera & Fullscreen Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800/80 bg-[#0d111a]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-100">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>AGENTPLAY RADIAL SESSION MAP</span>
          </span>

          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              isLiveConnected
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : isPlaying
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                  : 'bg-slate-800/90 text-slate-300 border-slate-700'
            }`}
          >
            {isLiveConnected
              ? '● LIVE TELEMETRY'
              : isPlaying
                ? '▶ REPLAY STREAMING'
                : '⏸ SCRUBBER READY'}
          </span>

          {focusedAgent && (
            <button
              type="button"
              onClick={() => onSelectAgent('all')}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 text-[10px] font-bold transition cursor-pointer"
              title="Return to 6-Agent Constellation View"
            >
              <span>← All Agents Constellation</span>
              <span className="text-cyan-400">({focusedAgent.shortName} focused)</span>
            </button>
          )}

          {activeLogFilter && (
            <button
              type="button"
              onClick={() => onFilterLogByNode(null)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/50 text-[10px] font-bold transition cursor-pointer"
              title="Clear log tail filter"
            >
              <Filter className="w-2.5 h-2.5" />
              <span>Filter: {activeLogFilter}</span>
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        {/* Sector Filter Pills + Zoom / Expand */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(Object.keys(SECTOR_META) as AgentPlaySectorId[]).map((sid) => {
            const meta = SECTOR_META[sid]
            const active = enabledSectors[sid]
            const count = graph.sectorCounts[sid]
            const Icon =
              sid === 'files'
                ? FileCode
                : sid === 'tools'
                  ? Wrench
                  : sid === 'worktrees'
                    ? FolderGit2
                    : Lock
            return (
              <button
                key={sid}
                type="button"
                onClick={() => toggleSector(sid)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold transition cursor-pointer ${
                  active
                    ? meta.badgeClass
                    : 'bg-slate-900/70 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
                title={`Toggle ${meta.label} sector`}
              >
                <Icon className="w-3 h-3" />
                <span>{meta.shortLabel}</span>
                <span className="opacity-80">({count})</span>
              </button>
            )
          })}

          <div className="h-3.5 w-px bg-slate-800 mx-0.5 hidden sm:block" />

          <div className="inline-flex items-center rounded-lg bg-slate-950 border border-slate-800 p-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.55, Number((z * 0.85).toFixed(2))))}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-1.5 text-[10px] text-slate-400 select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.6, Number((z * 1.18).toFixed(2))))}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={resetCamera}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Reset pan & zoom"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-[10px] font-bold text-slate-200 transition cursor-pointer"
            title={expanded ? 'Exit Fullscreen (Esc)' : 'Expand AgentPlay Map to Fullscreen'}
          >
            {expanded ? (
              <>
                <Minimize2 className="w-3 h-3 text-cyan-400" />
                <span>Dock</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3 text-cyan-400" />
                <span>Expand</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Interactive High-DPI Canvas Viewport */}
      <div
        ref={containerRef}
        className={`relative w-full select-none overflow-hidden ${
          expanded ? 'flex-1 min-h-[460px]' : 'h-[360px] sm:h-[390px]'
        }`}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={() => {
            dragStateRef.current.dragging = false
            setHoveredNodeId(null)
          }}
          onWheel={handleWheel}
          className={`w-full h-full block ${
            hoveredNode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
          }`}
        />

        {/* Top-Left Subtle Quick-Focus Agent Strip */}
        <div className="absolute top-2.5 left-3 flex items-center gap-1 flex-wrap pointer-events-auto">
          <button
            type="button"
            onClick={() => onSelectAgent('all')}
            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
              selectedAgentId === 'all'
                ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            All ({codingAgents.length})
          </button>
          {codingAgents.map((ag) => {
            const isSel = selectedAgentId === ag.id
            return (
              <button
                key={ag.id}
                type="button"
                onClick={() => onSelectAgent(isSel ? 'all' : ag.id)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                  isSel
                    ? 'bg-slate-900 text-white border-cyan-400/70 shadow-xs shadow-cyan-500/20'
                    : 'bg-slate-950/80 text-slate-400 border-slate-800/90 hover:text-slate-200'
                }`}
                title={`Drill into ${ag.codeName} radial session tree`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: ag.accentHex }}
                />
                <span>{ag.shortName}</span>
                {ag.tokensPerMin > 0 && (
                  <span className="text-[9px] text-emerald-400">
                    {(ag.tokensPerMin / 1000).toFixed(1)}k/m
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Bottom-Left Legend & Live Node Counter */}
        <div className="absolute bottom-2.5 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none text-[10px]">
          <div className="inline-flex items-center gap-3 px-2.5 py-1 rounded-lg bg-slate-950/85 border border-slate-800/80 text-slate-400 backdrop-blur-xs">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Write / Merge</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>Read / Shell</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span>MCP / A2A</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Lock</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span>Blocked</span>
            </span>
          </div>

          <div className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-950/85 border border-slate-800/80 text-slate-400 backdrop-blur-xs">
            <Activity className="w-3 h-3 text-cyan-400" />
            <span>
              {graph.nodes.length} radial nodes · {graph.links.length} arcs · drag to pan · scroll
              to zoom
            </span>
          </div>
        </div>

        {/* Rich Floating Hover HUD Card */}
        {hoveredNode && (
          <div
            style={{ left: mouseHudPos.x, top: mouseHudPos.y }}
            className="absolute z-30 w-60 rounded-xl border border-slate-700/90 bg-slate-950/95 p-2.5 shadow-xl shadow-black/60 pointer-events-none backdrop-blur-md text-[10px] flex flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span
                className="px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[9px]"
                style={{
                  backgroundColor: hexToRgba(hoveredNode.color, 0.18),
                  color: hoveredNode.color,
                  border: `1px solid ${hexToRgba(hoveredNode.color, 0.45)}`,
                }}
              >
                {hoveredNode.kind.toUpperCase()}
                {hoveredNode.isDirty ? ' · DIRTY' : ''}
              </span>
              {hoveredNode.ticketCode && (
                <span className="text-white font-black">${hoveredNode.ticketCode}</span>
              )}
            </div>

            <div className="text-xs font-bold text-white break-all leading-snug">
              {hoveredNode.label}
            </div>
            <div className="text-[10px] text-slate-400 break-all leading-tight">
              {hoveredNode.fullPath}
            </div>

            <div className="flex items-center justify-between pt-1 mt-0.5 border-t border-slate-800 text-slate-300">
              <span>
                Touches: <strong className="text-cyan-300">{hoveredNode.touchCount}</strong>
              </span>
              {hoveredNode.locDelta > 0 && (
                <span className="text-emerald-400 font-bold">+{hoveredNode.locDelta} LOC</span>
              )}
              {hoveredNode.tokensPerMin !== undefined && hoveredNode.tokensPerMin > 0 && (
                <span className="text-amber-300 font-bold">
                  {hoveredNode.tokensPerMin.toLocaleString()} tok/m
                </span>
              )}
            </div>

            <div className="text-[9px] text-cyan-400/90 font-semibold pt-0.5 flex items-center gap-1">
              {hoveredNode.kind === 'agent' ? (
                <>
                  <Cpu className="w-2.5 h-2.5" />
                  <span>
                    Click to{' '}
                    {selectedAgentId === hoveredNode.id.replace('agent:', '')
                      ? 'return to all agents'
                      : 'focus single-agent radial tree'}
                  </span>
                </>
              ) : hoveredNode.kind === 'worktree' ? (
                <>
                  <GitBranch className="w-2.5 h-2.5" />
                  <span>Click to pin ${hoveredNode.ticketCode} in Task Inspector</span>
                </>
              ) : hoveredNode.filterToken ? (
                <>
                  <Filter className="w-2.5 h-2.5" />
                  <span>Click to filter A2A log stream by “{hoveredNode.filterToken}”</span>
                </>
              ) : (
                <span>Drag canvas to pan · wheel to zoom</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (isFullscreen) {
    return (
      <>
        <div
          onClick={() => setIsFullscreen(false)}
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs"
        />
        {renderPanelContent(true)}
      </>
    )
  }

  return renderPanelContent(false)
}
