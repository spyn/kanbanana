import React, { useState } from 'react'
import {
  Activity,
  Bot,
  Check,
  Code2,
  FileText,
  FolderGit2,
  Gauge,
  GitBranch,
  GitCommit,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from 'lucide-react'
import { api, getClientApiToken } from '../api'
import { AgentFighterAvatar } from './AgentFighterAvatar'
import type {
  AgentInfo,
  AgentProfile,
  AgentTelemetryPoint,
  Project,
  ProjectWorktreesOverview,
} from '../types'

interface AgentsTabProps {
  project: Project
  agentProfiles: AgentProfile[]
  boardAgents: AgentInfo[]
  worktreesOverview: ProjectWorktreesOverview | null
  fighterAvatarsEnabled?: boolean
  defaultMcpUrl?: string
  onRefresh: () => void
  onNavigateTicket: (code: string) => void
}

const PROVIDER_OPTIONS = [
  { value: 'antigravity', label: 'Google Antigravity (agy)', defaultCmd: 'agy' },
  { value: 'claude', label: 'Claude Code', defaultCmd: 'claude' },
  { value: 'kimi', label: 'Kimi / Kimi Code', defaultCmd: 'kimi' },
  { value: 'minimax', label: 'Minimax / Minimax Code', defaultCmd: 'minimax-code' },
  { value: 'grok', label: 'Grok CLI', defaultCmd: 'grok' },
  { value: 'codex', label: 'OpenAI Codex CLI', defaultCmd: 'codex' },
  { value: 'cursor', label: 'Cursor Agent', defaultCmd: 'cursor' },
  { value: 'opencode', label: 'OpenCode', defaultCmd: 'opencode' },
  { value: 'custom', label: 'Custom CLI Agent', defaultCmd: 'custom-agent' },
]

const TelemetrySparkGraph: React.FC<{
  series: AgentTelemetryPoint[]
  tokensPerMin: number
  locPerMin: number
}> = ({ series, tokensPerMin, locPerMin }) => {
  const pts = series.length > 0 ? series : Array.from({ length: 12 }, (_, i) => ({
    bucket: i === 11 ? 'now' : `-${11 - i}m`,
    tokens_per_min: 0,
    loc_per_min: 0,
  }))

  const width = 380
  const height = 84
  const padX = 10
  const padY = 12
  const innerW = width - padX * 2
  const innerH = height - padY * 2

  const maxTok = Math.max(100, ...pts.map((p) => p.tokens_per_min))
  const maxLoc = Math.max(10, ...pts.map((p) => p.loc_per_min))

  const tokCoords = pts.map((p, i) => {
    const x = padX + (i / Math.max(1, pts.length - 1)) * innerW
    const y = padY + innerH - (p.tokens_per_min / maxTok) * innerH
    return { x, y, val: p.tokens_per_min, bucket: p.bucket }
  })

  const locCoords = pts.map((p, i) => {
    const x = padX + (i / Math.max(1, pts.length - 1)) * innerW
    const y = padY + innerH - (p.loc_per_min / maxLoc) * innerH
    return { x, y, val: p.loc_per_min, bucket: p.bucket }
  })

  const tokLine = tokCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const tokArea = `${tokLine} L${tokCoords[tokCoords.length - 1].x.toFixed(1)},${height - padY} L${tokCoords[0].x.toFixed(1)},${height - padY} Z`

  const locLine = locCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const locArea = `${locLine} L${locCoords[locCoords.length - 1].x.toFixed(1)},${height - padY} L${locCoords[0].x.toFixed(1)},${height - padY} Z`

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-cyan-300 font-semibold">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            Tokens/min: {tokensPerMin.toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-300 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            LOC/min: {locPerMin.toLocaleString()}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">12-min Telemetry Window</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20 overflow-visible">
        <defs>
          <linearGradient id="tokGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="locGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        <line x1={padX} y1={padY} x2={width - padX} y2={padY} stroke="#1e293b" strokeDasharray="3 3" />
        <line x1={padX} y1={height / 2} x2={width - padX} y2={height / 2} stroke="#1e293b" strokeDasharray="3 3" />
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#1e293b" />

        {/* Tokens/min Area + Line */}
        <path d={tokArea} fill="url(#tokGrad)" />
        <path d={tokLine} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />

        {/* LOC/min Area + Line */}
        <path d={locArea} fill="url(#locGrad)" />
        <path d={locLine} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />

        {/* Data points */}
        {tokCoords.map((c, idx) => (
          <circle
            key={`t-${idx}`}
            cx={c.x}
            cy={c.y}
            r="2.4"
            fill="#22d3ee"
          >
            <title>{`${c.bucket}: ${c.val.toLocaleString()} tokens/min`}</title>
          </circle>
        ))}
        {locCoords.map((c, idx) => (
          <circle
            key={`l-${idx}`}
            cx={c.x}
            cy={c.y}
            r="2.4"
            fill="#10b981"
          >
            <title>{`${c.bucket}: ${c.val.toLocaleString()} LOC/min`}</title>
          </circle>
        ))}
      </svg>

      <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 px-1">
        <span>{pts[0]?.bucket}</span>
        <span>{pts[Math.floor(pts.length / 2)]?.bucket}</span>
        <span>{pts[pts.length - 1]?.bucket}</span>
      </div>
    </div>
  )
}

export const AgentsTab: React.FC<AgentsTabProps> = ({
  project,
  agentProfiles,
  worktreesOverview,
  fighterAvatarsEnabled = true,
  defaultMcpUrl,
  onRefresh,
  onNavigateTicket,
}) => {
  // Add custom agent profile state
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('antigravity')
  const [configPath, setConfigPath] = useState('')
  const [cliCommand, setCliCommand] = useState('agy')
  const [defaultArgs, setDefaultArgs] = useState('')
  const [injectStatus, setInjectStatus] = useState<Record<string, string>>({})

  // Workspace & Worktrees paths editor
  const [repoPath, setRepoPath] = useState(project.repo_path || '')
  const [worktreesDir, setWorktreesDir] = useState(
    project.worktrees_dir || worktreesOverview?.worktrees_dir || '',
  )
  const [savingPaths, setSavingPaths] = useState(false)
  const [a2aProbeUrl, setA2aProbeUrl] = useState('')
  const [scanningA2A, setScanningA2A] = useState(false)
  const [a2aScanStatus, setA2aScanStatus] = useState('')
  const [expandedCardJson, setExpandedCardJson] = useState<Record<string, boolean>>({})
  const [streamingProfileMap, setStreamingProfileMap] = useState<Record<string, boolean>>({})
  const [localSseEventsMap, setLocalSseEventsMap] = useState<
    Record<string, Array<{ id: string; timestamp: string; event_type: string; state: string; summary: string; final: boolean }>>
  >({})

  const handleStreamA2ASse = async (profileId: string) => {
    setStreamingProfileMap((prev) => ({ ...prev, [profileId]: true }))
    try {
      const token = getClientApiToken()
      const sseHeaders: Record<string, string> = { Accept: 'text/event-stream' }
      if (token) {
        sseHeaders.Authorization = `Bearer ${token}`
      }
      const resp = await fetch(`/api/a2a/agents/${encodeURIComponent(profileId)}/stream`, {
        headers: sseHeaders,
      })
      if (!resp.ok || !resp.body) {
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const rawLine of lines) {
          const ln = rawLine.trim()
          if (!ln.startsWith('data:')) continue
          try {
            const frame = JSON.parse(ln.slice(5).trim())
            const res = frame.result || {}
            const isArtifact = res.type === 'artifact' || Boolean(res.artifact)
            const eventType = isArtifact ? 'TaskArtifactUpdateEvent' : 'TaskStatusUpdateEvent'
            let summary = ''
            if (res.artifact?.parts?.[0]?.text) {
              summary = res.artifact.parts[0].text
            } else if (res.status?.message?.parts?.[0]?.text) {
              summary = res.status.message.parts[0].text
            } else {
              summary = JSON.stringify(res).slice(0, 140)
            }
            const evtItem = {
              id: `sse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: res.status?.timestamp || new Date().toISOString(),
              event_type: eventType,
              state: res.status?.state || 'working',
              summary,
              final: Boolean(res.final),
            }
            setLocalSseEventsMap((prev) => ({
              ...prev,
              [profileId]: [...(prev[profileId] || []).slice(-11), evtItem],
            }))
          } catch {
            // ignore malformed frame
          }
        }
      }
    } finally {
      setStreamingProfileMap((prev) => ({ ...prev, [profileId]: false }))
    }
  }

  const handleScanA2A = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setScanningA2A(true)
    setA2aScanStatus('')
    try {
      const eps = a2aProbeUrl.trim() ? [a2aProbeUrl.trim()] : []
      const res = await api.scanA2AAgents(eps, project.slug)
      setA2aScanStatus(
        `Scanned ${res.total_count} A2A agents (${res.active_count} active/ready via A2A v${res.protocol_version})`,
      )
      if (a2aProbeUrl.trim()) setA2aProbeUrl('')
      onRefresh()
    } catch (err: any) {
      setA2aScanStatus(`Scan error: ${err.message || 'failed'}`)
    } finally {
      setScanningA2A(false)
    }
  }

  const handleProviderChange = (prov: string) => {
    setProvider(prov)
    const found = PROVIDER_OPTIONS.find((p) => p.value === prov)
    if (found) setCliCommand(found.defaultCmd)
  }

  const handleAddProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !configPath.trim()) return
    await api.createAgentProfile({
      name: name.trim(),
      provider,
      config_path: configPath.trim(),
      cli_command: cliCommand.trim(),
      default_args: defaultArgs.trim(),
    })
    setName('')
    setConfigPath('')
    setDefaultArgs('')
    onRefresh()
  }

  const handleDeleteProfile = async (profileId: string) => {
    await api.deleteAgentProfile(profileId)
    onRefresh()
  }

  const handleInjectMcp = async (profileId: string) => {
    setInjectStatus((prev) => ({ ...prev, [profileId]: 'Injecting...' }))
    try {
      const mcpUrl = (defaultMcpUrl && defaultMcpUrl.trim()) || `${window.location.origin}/mcp`
      const res = await api.injectMcpIntoProfile(profileId, {
        project_slug: project.slug,
        mcp_url: mcpUrl,
        inject_skill: true,
      })
      setInjectStatus((prev) => ({
        ...prev,
        [profileId]: `Wired ${res.mcp_config_written_to}`,
      }))
      onRefresh()
    } catch (e: any) {
      setInjectStatus((prev) => ({
        ...prev,
        [profileId]: `Error: ${e.message}`,
      }))
    }
  }

  const handleSaveWorkspacePaths = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingPaths(true)
    try {
      await api.updateProject(project.slug, {
        repo_path: repoPath.trim(),
        worktrees_dir: worktreesDir.trim(),
      })
      onRefresh()
    } finally {
      setSavingPaths(false)
    }
  }

  const activityBadge = (state: AgentProfile['activity_state']) => {
    switch (state) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            FIGHTING / ACTIVE
          </span>
        )
      case 'recent':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            RECENTLY ACTIVE
          </span>
        )
      case 'unmounted':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/20 text-rose-300 border border-rose-500/30">
            PATH NOT FOUND
          </span>
        )
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            IDLE
          </span>
        )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Add / Link Agent Config + Shared Workspace/Worktrees Config */}
        <div className="flex flex-col gap-5">
          {/* Add Agent Form */}
          <form
            onSubmit={handleAddProfile}
            className="rounded-2xl border border-indigo-500/30 bg-slate-900/75 p-5 flex flex-col gap-3.5"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Add / Link Agent Configuration
                </h3>
                <p className="text-xs text-slate-400">
                  Mounts under <code className="text-slate-200">/agent-configs/*</code> and host <code className="text-slate-200">~/.antigravity</code>, <code className="text-slate-200">~/.claude</code>, <code className="text-slate-200">~/.kimi</code>, <code className="text-slate-200">~/.minimax</code>, <code className="text-slate-200">~/.grok</code> are auto-detected.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white"
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Kimi Fighter 2"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Mounted or Host Config Directory Path *
              </label>
              <input
                type="text"
                required
                value={configPath}
                onChange={(e) => setConfigPath(e.target.value)}
                placeholder="e.g. /agent-configs/kimi or ~/.antigravity"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">CLI Binary</label>
                <input
                  type="text"
                  value={cliCommand}
                  onChange={(e) => setCliCommand(e.target.value)}
                  placeholder="agy / claude / kimi"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Default Flags</label>
                <input
                  type="text"
                  value={defaultArgs}
                  onChange={(e) => setDefaultArgs(e.target.value)}
                  placeholder="--dangerously-skip-permissions"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Register Agent Profile
            </button>
          </form>

          {/* A2A Protocol Network Discovery Scanner */}
          <form
            onSubmit={handleScanA2A}
            className="rounded-2xl border border-cyan-500/30 bg-slate-900/75 p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">
                    A2A Protocol Discovery Scanner
                  </h3>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    A2A v0.2.1
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Probes <code className="text-slate-200">/.well-known/agent.json</code> across mounted &amp; remote A2A agents for task assignment via <code className="text-slate-200">tasks/send</code>.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={a2aProbeUrl}
                onChange={(e) => setA2aProbeUrl(e.target.value)}
                placeholder="http://remote-agent:8080 (or leave blank to scan all)"
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white"
              />
              <button
                type="submit"
                disabled={scanningA2A}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scanningA2A ? 'animate-spin' : ''}`} />
                {scanningA2A ? 'Scanning...' : 'Scan A2A'}
              </button>
            </div>

            {a2aScanStatus && (
              <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/50 rounded-lg px-2.5 py-1.5">
                {a2aScanStatus}
              </div>
            )}
          </form>

          {/* Shared Workspace & Worktrees Directory Configuration */}
          <form
            onSubmit={handleSaveWorkspacePaths}
            className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Shared Project Workspace & Worktrees
                </h3>
              </div>
              <button
                type="submit"
                disabled={savingPaths}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Save Paths
              </button>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Project Git Workspace Path (`/workspaces/project`)
              </label>
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/workspaces/project or D:\code\project"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Git Worktrees Root Directory (`/workspaces/worktrees`)
              </label>
              <input
                type="text"
                value={worktreesDir}
                onChange={(e) => setWorktreesDir(e.target.value)}
                placeholder="/workspaces/worktrees or D:\code\worktrees"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>
          </form>
        </div>

        {/* Right 2 Columns: Auto-Detected Agent Fighters, Usage Telemetry Graph & Transcripts */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">
                Auto-Detected Agent Roster & Live Telemetry ({agentProfiles.length})
              </h3>
              <p className="text-xs text-slate-400">
                Active agents unleash fighting combos! Shows live usage quota, Tokens/min &amp; LOC/min telemetry graph, and transcript tails.
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Rescan Logs
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {agentProfiles.map((prof) => {
              const tel = prof.usage_telemetry
              const totalTok = tel?.total_tokens || 0
              const totalLoc = tel?.total_loc || 0
              const tpm = tel?.tokens_per_min || 0
              const lpm = tel?.loc_per_min || 0
              const quotaPct = tel?.quota_used_pct || 0

              return (
                <div
                  key={prof.id}
                  className={`rounded-2xl border p-5 flex flex-col gap-4 ${
                    prof.activity_state === 'active'
                      ? 'border-emerald-500/40 bg-emerald-950/10'
                      : 'border-slate-800 bg-slate-900/75'
                  }`}
                >
                  {/* Top Row: Fighter Avatar + Agent Details + Telemetry Chart */}
                  <div className="flex flex-col md:flex-row gap-4 items-stretch">
                    {/* Fighter Character Avatar */}
                    {fighterAvatarsEnabled && (
                      <AgentFighterAvatar
                        provider={prof.provider}
                        name={prof.name}
                        isActive={prof.activity_state === 'active'}
                        isRecent={prof.activity_state === 'recent'}
                        quotaUsedPct={quotaPct}
                        tokensPerMin={tpm}
                      />
                    )}

                    {/* Right Side: Metadata + Usage Bar + Tokens/LOC per Minute Graph */}
                    <div className="flex-1 flex flex-col justify-between gap-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-bold text-white">{prof.name}</span>
                            {activityBadge(prof.activity_state)}
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                              {prof.provider}
                            </span>
                            {/* Explicit A2A Connection Indicator */}
                            {prof.a2a_connected !== false && prof.activity_state !== 'unmounted' ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                                {prof.a2a_transport === 'remote-http-sse'
                                  ? 'A2A Connected (Remote HTTP)'
                                  : 'A2A Connected (Local Bridge)'}
                                {prof.a2a_latency_ms != null && (
                                  <span className="text-[10px] text-cyan-200/80">
                                    · {prof.a2a_latency_ms}ms
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                                A2A Offline
                              </span>
                            )}
                            {/* Explicit SSE Streaming Indicator */}
                            {(prof.a2a_streaming_enabled ?? true) && (
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border ${
                                  streamingProfileMap[prof.id] || prof.a2a_stream_active
                                    ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/60 shadow-sm shadow-emerald-500/20'
                                    : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    streamingProfileMap[prof.id] || prof.a2a_stream_active
                                      ? 'bg-emerald-400 animate-ping'
                                      : 'bg-indigo-400'
                                  }`}
                                />
                                {streamingProfileMap[prof.id] || prof.a2a_stream_active
                                  ? 'SSE STREAMING LIVE'
                                  : 'SSE Stream Ready'}
                              </span>
                            )}
                            {prof.mcp_configured && (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                <Check className="w-3 h-3" />
                                MCP Wired
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-mono text-slate-400 flex items-center gap-3 flex-wrap mt-1">
                            <span>Config: {prof.config_path}</span>
                            <span>CLI: `{prof.cli_command}`</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleInjectMcp(prof.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-xs font-semibold text-white transition cursor-pointer"
                          >
                            <PlugZap className="w-3.5 h-3.5" />
                            Wire MCP & SKILL.md
                          </button>
                          {prof.source === 'custom' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteProfile(prof.id)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Current Usage & Session Totals Bar */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/70 border border-slate-800/90 rounded-xl p-2.5 text-xs font-mono">
                        <div>
                          <span className="text-[10px] text-slate-500 block">SESSION TOKENS</span>
                          <span className="font-bold text-cyan-300">
                            {totalTok.toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">LINES OF CODE</span>
                          <span className="font-bold text-emerald-300">
                            {totalLoc.toLocaleString()} LOC
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">PEAK TOK/MIN</span>
                          <span className="font-bold text-indigo-300">
                            {(tel?.peak_tokens_per_min || 0).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">USAGE QUOTA</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full ${
                                  quotaPct > 85
                                    ? 'bg-rose-500'
                                    : quotaPct > 50
                                      ? 'bg-amber-400'
                                      : 'bg-indigo-500'
                                }`}
                                style={{ width: `${Math.min(100, quotaPct)}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-bold text-white">
                              {quotaPct}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Dual-Line Telemetry Graph: Tokens/min & LOC/min */}
                      <TelemetrySparkGraph
                        series={tel?.series || []}
                        tokensPerMin={tpm}
                        locPerMin={lpm}
                      />
                    </div>
                  </div>

                  {injectStatus[prof.id] && (
                    <div className="text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-1.5">
                      {injectStatus[prof.id]}
                    </div>
                  )}

                  {/* A2A Agent Card (`/.well-known/agent.json`) */}
                  {prof.a2a_card && (
                    <div className="rounded-xl border border-indigo-500/30 bg-slate-950/85 p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80 pb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                            A2A AGENT CARD · v{prof.a2a_card.protocolVersion}
                          </span>
                          <span className="text-xs font-semibold text-white">
                            {prof.a2a_card.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            ({prof.a2a_card.provider?.organization})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStreamA2ASse(prof.id)}
                            disabled={streamingProfileMap[prof.id]}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-[10px] font-mono font-semibold text-cyan-200 cursor-pointer"
                            title="Connect to /api/a2a/agents/{id}/stream (Server-Sent Events) and stream live A2A frames"
                          >
                            <RefreshCw
                              className={`w-3 h-3 ${streamingProfileMap[prof.id] ? 'animate-spin' : ''}`}
                            />
                            {streamingProfileMap[prof.id] ? 'Streaming SSE...' : 'Stream A2A SSE'}
                          </button>
                          <a
                            href={`/api/a2a/agents/${encodeURIComponent(prof.id)}/.well-known/agent.json`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-mono text-cyan-300 hover:underline"
                          >
                            /.well-known/agent.json
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCardJson((prev) => ({
                                ...prev,
                                [prof.id]: !prev[prof.id],
                              }))
                            }
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-200 cursor-pointer"
                          >
                            {expandedCardJson[prof.id] ? 'Hide JSON' : 'Inspect Card JSON'}
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {prof.a2a_card.description}
                      </p>

                      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-mono">
                        <div className="text-slate-400 truncate">
                          A2A JSON-RPC Endpoint:{' '}
                          <code className="text-indigo-300">{prof.a2a_card.url}</code>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(prof.default_model || prof.a2a_card.default_model) && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-200 border border-purple-700/60 text-[10px]">
                              Model: {prof.default_model || prof.a2a_card.default_model}
                            </span>
                          )}
                          {(prof.supports_effort ?? prof.a2a_card.supports_effort) &&
                          (prof.default_effort || prof.a2a_card.default_effort) ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] uppercase">
                              Effort: {prof.default_effort || prof.a2a_card.default_effort}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px]">
                              Effort: N/A
                            </span>
                          )}
                          {prof.a2a_card.capabilities?.streaming && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 text-[10px]">
                              streaming
                            </span>
                          )}
                          {prof.a2a_card.capabilities?.stateTransitionHistory && (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60 text-[10px]">
                              stateTransitionHistory
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px]">
                            tasks/sendSubscribe (SSE)
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px]">
                            tasks/send
                          </span>
                        </div>
                      </div>

                      {/* Real-Time A2A SSE Stream Feed (`tasks/sendSubscribe` / `/stream`) */}
                      {((localSseEventsMap[prof.id] && localSseEventsMap[prof.id].length > 0) ||
                        (prof.a2a_recent_stream_events && prof.a2a_recent_stream_events.length > 0)) && (
                        <div className="rounded-lg bg-slate-900/95 border border-cyan-500/30 p-2.5 flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="inline-flex items-center gap-1.5 text-cyan-300 font-bold">
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  streamingProfileMap[prof.id] || prof.a2a_stream_active
                                    ? 'bg-emerald-400 animate-ping'
                                    : 'bg-cyan-400'
                                }`}
                              />
                              A2A SSE Event Stream (`text/event-stream` · {prof.a2a_stream_url || `/api/a2a/agents/${prof.id}/stream`})
                            </span>
                            <span className="text-slate-400">
                              {(localSseEventsMap[prof.id] || prof.a2a_recent_stream_events || []).length} frames
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 max-h-28 overflow-y-auto font-mono text-[10px]">
                            {(localSseEventsMap[prof.id] || prof.a2a_recent_stream_events || [])
                              .slice(-5)
                              .map((ev) => (
                                <div
                                  key={ev.id}
                                  className="flex items-start gap-2 text-slate-300 bg-slate-950/80 px-2 py-1 rounded border border-slate-800/80"
                                >
                                  <span
                                    className={`px-1 rounded text-[9px] shrink-0 ${
                                      ev.event_type === 'TaskArtifactUpdateEvent'
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                                        : 'bg-indigo-950 text-indigo-300 border border-indigo-800/60'
                                    }`}
                                  >
                                    {ev.event_type === 'TaskArtifactUpdateEvent' ? 'artifact' : 'status'}
                                  </span>
                                  <span className="text-cyan-200/90 shrink-0">[{ev.state}]</span>
                                  <span className="truncate flex-1">{ev.summary}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* A2A Skills */}
                      {prof.a2a_card.skills && prof.a2a_card.skills.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
                          {prof.a2a_card.skills.map((sk) => (
                            <div
                              key={sk.id}
                              className="rounded-lg bg-slate-900/90 border border-slate-800/90 p-2 flex flex-col gap-1"
                            >
                              <div className="text-[11px] font-bold text-indigo-200 truncate">
                                {sk.name}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400 truncate">
                                id: {sk.id}
                              </div>
                              <div className="text-[10px] text-slate-400 line-clamp-2">
                                {sk.description}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {expandedCardJson[prof.id] && (
                        <pre className="whitespace-pre-wrap font-mono text-[10px] bg-slate-950 border border-slate-800 p-3 rounded-lg text-indigo-200 max-h-56 overflow-y-auto">
                          {JSON.stringify(prof.a2a_card, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Active Log File & Live Transcript Tail */}
                  {prof.active_log_file && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800/80 pb-1.5">
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          Live Transcript / Log: {prof.active_log_file}
                        </span>
                        <span>{prof.recent_events.length} recent entries</span>
                      </div>

                      {prof.recent_events.length === 0 ? (
                        <div className="text-xs text-slate-500 italic">
                          Log file found, waiting for readable transcript events...
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                          {prof.recent_events.map((ev, idx) => (
                            <div
                              key={idx}
                              className="text-xs font-mono flex items-start gap-2 leading-relaxed py-1 border-b border-slate-900 last:border-0"
                            >
                              {ev.timestamp && (
                                <span className="text-[10px] text-slate-500 shrink-0">
                                  {ev.timestamp.slice(11, 19) || ev.timestamp.slice(0, 10)}
                                </span>
                              )}
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-indigo-300 shrink-0">
                                {ev.kind}
                              </span>
                              <span className="text-slate-200 break-all">{ev.summary}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Active Ticket Worktrees & Git Progress */}
          {worktreesOverview && worktreesOverview.worktrees.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-3.5 mt-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  Active Task Worktrees & Git Progress ({worktreesOverview.worktrees.length})
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {worktreesOverview.worktrees.map((wt) => (
                  <div
                    key={wt.ticket_code}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 text-xs flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => onNavigateTicket(wt.ticket_code)}
                        className="font-mono font-bold text-indigo-300 hover:underline cursor-pointer"
                      >
                        {wt.ticket_code} · {wt.ticket_title}
                      </button>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                        {wt.owner || 'unclaimed'}
                      </span>
                    </div>

                    <div className="font-mono text-[11px] text-slate-400 flex flex-col gap-1">
                      <div>
                        Branch: <span className="text-emerald-300">{wt.branch_name || '—'}</span>
                      </div>
                      {wt.worktree_path && (
                        <div className="truncate">Worktree: {wt.worktree_path}</div>
                      )}
                      {wt.git_status?.exists && (
                        <div className="flex items-center gap-3 text-slate-300 pt-1">
                          <span>
                            Dirty files:{' '}
                            <strong>{wt.git_status.dirty_count || 0}</strong>
                          </span>
                          {wt.git_status.last_commit && (
                            <span className="truncate text-indigo-200">
                              <GitCommit className="w-3 h-3 inline mr-1" />
                              {wt.git_status.last_commit}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
