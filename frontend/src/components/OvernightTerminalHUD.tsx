import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Eye,
  FastForward,
  FileCode,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitMerge,
  Lock,
  Maximize2,
  Minimize2,
  OctagonAlert,
  Pause,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap,
} from 'lucide-react'
import { api } from '../api'
import {
  DROP_PRESETS,
  NeurofunkAudioEngine,
  type DropPresetMeta,
  type NeuroDropFlavor,
} from '../audio/neurofunkAudio'

const AgentPlayRadialMap = React.lazy(() =>
  import('./AgentPlayRadialMap').then((m) => ({ default: m.AgentPlayRadialMap })),
)
import type {
  AgentInfo,
  AgentProfile,
  FeatureLock,
  Project,
  ProjectWorktreesOverview,
  Ticket,
} from '../types'

interface OvernightTerminalHUDProps {
  project: Project
  tickets: Ticket[]
  locks: FeatureLock[]
  agentProfiles: AgentProfile[]
  boardAgents?: AgentInfo[]
  worktreesOverview?: ProjectWorktreesOverview | null
  defaultTokenCeiling?: number
  defaultNeuroArmed?: boolean
  defaultNeuroVolume?: number
  prDropEnabled?: boolean
  isWallboardMode?: boolean
  onToggleWallboard?: (next?: boolean) => void
  onSelectTicket?: (ticket: Ticket) => void
  onNavigateTicket?: (code: string) => void
  onClaimTicket?: (ticket: Ticket) => void
  onQuickCreateTriage?: () => void
}

type LogAction =
  | 'DISPATCH'
  | 'WORKTREE'
  | 'LOCK'
  | 'TEST'
  | 'REVIEW'
  | 'MERGE'
  | 'BLOCKED'

type AgentOperationalStatus =
  | 'ACTIVE'
  | 'EXECUTING'
  | 'REVIEWING'
  | 'TRIAGING'
  | 'PLANNING'
  | 'LOCKING'
  | 'AUDITING'
  | 'STANDBY'
  | 'READING'

type PipelineStageId = 'triage' | 'guard' | 'worktree' | 'exec' | 'review'

interface A2ALogEntry {
  id: string
  time: string
  epoch: number
  agentId: string
  agentName: string
  agentColor: string
  ticketCode: string
  ticketTitle: string
  action: LogAction
  toolCall?: string
  jsonRpcMethod?: string
  branch?: string
  worktreePath?: string
  commitSha?: string
  lockName?: string
  filesTouched?: string[]
  doneWhen?: string
  message: string
  tokenCost: number
  locAdded: number
  locRemoved: number
  durationSec?: number
  prNumber?: number
  status: 'running' | 'success' | 'blocked'
}

interface AgentPersonaMeta {
  id: string
  provider: string
  codeName: string
  shortName: string
  realName: string
  defaultModel: string
  pun: string
  role: string
  accentHex: string
  badgeColor: string
  iconBg: string
  defaultStage: PipelineStageId
}

interface AgentCardItem extends AgentPersonaMeta {
  tokensUsed: number
  tokensPerMin: number
  tokenSharePct: number
  locShipped: number
  mergesCount: number
  eventsCount: number
  status: AgentOperationalStatus
  statusBadge: string
  activeTicketCode?: string
  isOnline: boolean
}

const AGENT_PERSONAS: AgentPersonaMeta[] = [
  {
    id: 'claude',
    provider: 'claude',
    codeName: 'Claude Architect',
    shortName: 'Claude',
    realName: 'Claude Code · Anthropic',
    defaultModel: 'claude-sonnet-4-5 (medium effort)',
    pun: 'Zero regression tolerance — keeping the main branch 100% clean until tests pass',
    role: 'Lead Architect & Mainline Review Gate',
    accentHex: '#f59e0b',
    badgeColor: 'bg-amber-400/20 text-amber-300 border-amber-400/40',
    iconBg: 'bg-amber-500/20 border-amber-400/50 text-amber-300',
    defaultStage: 'review',
  },
  {
    id: 'kimi',
    provider: 'kimi',
    codeName: 'Kimi Deep Diver',
    shortName: 'Kimi',
    realName: 'Kimi Code · Moonshot AI',
    defaultModel: 'kimi-k2.5-thinking (high effort)',
    pun: 'Munching through complex ASTs and 128k context windows at high velocity',
    role: 'Deep Systems & High-Velocity Code Runner',
    accentHex: '#22d3ee',
    badgeColor: 'bg-cyan-400/20 text-cyan-300 border-cyan-400/50',
    iconBg: 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300',
    defaultStage: 'exec',
  },
  {
    id: 'antigravity',
    provider: 'antigravity',
    codeName: 'Isaac Antigravity',
    shortName: 'Antigravity',
    realName: 'Antigravity · Google DeepMind',
    defaultModel: 'gemini-4-argon (medium effort)',
    pun: 'Breaking circular dependencies with Tarjan topological sorts before graphs spin out',
    role: 'Triage Scanner & DAG Cycle Guard',
    accentHex: '#a855f7',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    iconBg: 'bg-purple-500/20 border-purple-400/50 text-purple-300',
    defaultStage: 'guard',
  },
  {
    id: 'codex',
    provider: 'codex',
    codeName: 'Codex Worktree Pruner',
    shortName: 'Codex',
    realName: 'Codex CLI · OpenAI',
    defaultModel: 'gpt-5-codex (high effort)',
    pun: 'Pruning stale worktrees and orphan branch refs before digital debris accumulates',
    role: 'Git Worktree & PR Assembler',
    accentHex: '#10b981',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    iconBg: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300',
    defaultStage: 'worktree',
  },
  {
    id: 'minimax',
    provider: 'minimax',
    codeName: 'MiniMax Lock Wrangler',
    shortName: 'MiniMax',
    realName: 'MiniMax Code · Hailuo',
    defaultModel: 'minimax-m2.5-coding',
    pun: 'Managing shared state and deep diffs without ever dropping a FIFO lock',
    role: 'FIFO Lock & Resource Wrangler',
    accentHex: '#f43f5e',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    iconBg: 'bg-rose-500/20 border-rose-400/50 text-rose-300',
    defaultStage: 'guard',
  },
  {
    id: 'grok',
    provider: 'grok',
    codeName: 'Grok Security Auditor',
    shortName: 'Grok',
    realName: 'Grok CLI · xAI',
    defaultModel: 'grok-4-code (high effort)',
    pun: 'Auditing security holes, SSRF vectors, and memory leaks with surgical precision',
    role: 'Security & Edge-Case Auditor',
    accentHex: '#60a5fa',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    iconBg: 'bg-blue-500/20 border-blue-400/50 text-blue-300',
    defaultStage: 'review',
  },
  {
    id: 'user',
    provider: 'user',
    codeName: 'You (The Sleeping Architect)',
    shortName: 'Human',
    realName: 'Human In The Loop',
    defaultModel: '8h REM Cycle · Morning Coffee',
    pun: 'Went to sleep on a backlog, woke up to autonomous overnight green PR merges',
    role: 'Chief Sloth & Morning Approver',
    accentHex: '#94a3b8',
    badgeColor: 'bg-slate-800 text-slate-300 border-slate-600',
    iconBg: 'bg-slate-800 border-slate-600 text-slate-200',
    defaultStage: 'triage',
  },
]

// Canonical autonomous overnight logs stream across all 6 A2A agents (23:00 -> 07:00)
const HISTORIC_A2A_LOGS: A2ALogEntry[] = [
  {
    id: 'a2a-1',
    time: '23:04:12',
    epoch: 4,
    agentId: 'antigravity',
    agentName: 'Isaac Antigravity',
    agentColor: 'text-purple-400 bg-purple-950/40 border-purple-800',
    ticketCode: 'G1',
    ticketTitle: 'Topological DAG Cycle Safeguard & Ticket Sizing Guardrail',
    action: 'BLOCKED',
    toolCall: 'check_ticket_dependencies(code="G1")',
    jsonRpcMethod: 'mcp/tools/call · check_ticket_dependencies',
    branch: 'board/g1-graph-rewrite',
    worktreePath: '/workspaces/worktrees/g1',
    filesTouched: ['backend/app/db.py', 'backend/app/importer.py'],
    doneWhen: 'Split ticket below 500 LOC cap and resolve circular dependency on $G2',
    message: 'Spec Guard: est. diff 1,840 LOC > 500 LOC review cap · circular dep on $G2 · quarantined',
    tokenCost: 14800,
    locAdded: 0,
    locRemoved: 0,
    durationSec: 9,
    status: 'blocked',
  },
  {
    id: 'a2a-2',
    time: '23:19:05',
    epoch: 19,
    agentId: 'grok',
    agentName: 'Grok Security Auditor',
    agentColor: 'text-blue-400 bg-blue-950/40 border-blue-800',
    ticketCode: 'S2',
    ticketTitle: 'Dynamic Webhook Filter Expression Evaluator & Sandboxing',
    action: 'BLOCKED',
    toolCall: 'inspect_review_ticket(code="S2")',
    jsonRpcMethod: 'a2a/tasks/sendSubscribe · security-audit',
    branch: 'board/s2-webhook-eval',
    worktreePath: '/workspaces/worktrees/s2',
    filesTouched: ['backend/app/webhooks.py'],
    doneWhen: 'Replace raw Python eval() with AST allowlist visitor + unit tests',
    message: 'Security Audit: Unsandboxed eval() on untrusted payload · rejected unsafe AST visitor · bounced back to todo',
    tokenCost: 22400,
    locAdded: 0,
    locRemoved: 0,
    durationSec: 14,
    status: 'blocked',
  },
  {
    id: 'a2a-3',
    time: '23:46:22',
    epoch: 46,
    agentId: 'codex',
    agentName: 'Codex Worktree Pruner',
    agentColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800',
    ticketCode: 'W3',
    ticketTitle: 'Atomic Git Worktree Provisioner & Orphan Branch Pruner',
    action: 'WORKTREE',
    toolCall: 'ensure_ticket_worktree(code="W3", branch="board/w3-worktree-gc")',
    jsonRpcMethod: 'mcp/tools/call · ensure_ticket_worktree',
    branch: 'board/w3-worktree-gc',
    worktreePath: '/workspaces/worktrees/w3',
    filesTouched: ['backend/app/agent_manager.py', 'backend/tests/test_worktree_gc.py'],
    doneWhen: 'Stale worktrees auto-prune without touching uncommitted diffs; pytest green',
    message: 'Isolated git worktree mounted at /workspaces/worktrees/w3 · pruning stale worktrees with zero uncommitted residue',
    tokenCost: 31500,
    locAdded: 148,
    locRemoved: 22,
    durationSec: 28,
    status: 'running',
  },
  {
    id: 'a2a-4',
    time: '00:18:41',
    epoch: 78,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'W3',
    ticketTitle: 'Atomic Git Worktree Provisioner & Orphan Branch Pruner',
    action: 'MERGE',
    toolCall: 'review_ticket(code="W3", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/w3-worktree-gc',
    worktreePath: '/workspaces/worktrees/w3',
    commitSha: '9a4b2c1',
    prNumber: 101,
    filesTouched: ['backend/app/agent_manager.py', 'backend/tests/test_worktree_gc.py'],
    doneWhen: 'Stale worktrees auto-prune without touching uncommitted diffs; pytest green',
    message: 'Worktree GC verified clean, path-traversal guard verified · merged PR #101 -> main@9a4b2c1',
    tokenCost: 58200,
    locAdded: 148,
    locRemoved: 22,
    durationSec: 42,
    status: 'success',
  },
  {
    id: 'a2a-5',
    time: '00:52:18',
    epoch: 112,
    agentId: 'minimax',
    agentName: 'MiniMax Lock Wrangler',
    agentColor: 'text-rose-400 bg-rose-950/40 border-rose-800',
    ticketCode: 'L4',
    ticketTitle: 'FIFO Resource Lock Lease Renewal & Dead-Agent Reclaim',
    action: 'LOCK',
    toolCall: 'acquire_lock(lock_name="ci:integration-suite", expected_minutes=25)',
    jsonRpcMethod: 'mcp/tools/call · acquire_lock',
    branch: 'board/l4-fifo-leases',
    worktreePath: '/workspaces/worktrees/l4',
    lockName: 'ci:integration-suite',
    filesTouched: ['backend/app/db.py', 'backend/app/mcp_server.py'],
    doneWhen: 'Expired lock leases promote head-of-line waiter atomically in SQLite WAL',
    message: 'FIFO Lock: ci:integration-suite acquired exclusively (slot 1/1 · 0 queued) · running stress test',
    tokenCost: 29400,
    locAdded: 196,
    locRemoved: 34,
    durationSec: 19,
    status: 'running',
  },
  {
    id: 'a2a-6',
    time: '01:28:09',
    epoch: 148,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'L4',
    ticketTitle: 'FIFO Resource Lock Lease Renewal & Dead-Agent Reclaim',
    action: 'MERGE',
    toolCall: 'review_ticket(code="L4", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/l4-fifo-leases',
    worktreePath: '/workspaces/worktrees/l4',
    commitSha: 'c71d08e',
    lockName: 'ci:integration-suite (released)',
    prNumber: 102,
    filesTouched: ['backend/app/db.py', 'backend/app/mcp_server.py'],
    doneWhen: 'Expired lock leases promote head-of-line waiter atomically in SQLite WAL',
    message: 'Lock handoff deterministic under 32 concurrent workers · merged PR #102 -> main@c71d08e',
    tokenCost: 67400,
    locAdded: 196,
    locRemoved: 34,
    durationSec: 51,
    status: 'success',
  },
  {
    id: 'a2a-7',
    time: '02:06:40',
    epoch: 186,
    agentId: 'kimi',
    agentName: 'Kimi Deep Diver',
    agentColor: 'text-cyan-400 bg-cyan-950/40 border-cyan-800',
    ticketCode: 'A5',
    ticketTitle: 'Zero-Copy Token Stream & SSE Multiplexer',
    action: 'DISPATCH',
    toolCall: 'a2a.tasks.sendSubscribe(agent="kimi-code", model="kimi-k2.5-thinking", effort="high")',
    jsonRpcMethod: 'a2a/tasks/sendSubscribe',
    branch: 'board/a5-sse-multiplexer',
    worktreePath: '/workspaces/worktrees/a5',
    lockName: 'ci:benchmark-runner',
    filesTouched: ['backend/app/a2a_protocol.py', 'backend/app/events.py'],
    doneWhen: 'p99 fan-out latency < 4ms across 16 A2A streams with backpressure ring-buffer',
    message: 'Streaming ring-buffer dispatching at 174 Hz · synthesizing async ring-buffer in /workspaces/worktrees/a5',
    tokenCost: 118500,
    locAdded: 284,
    locRemoved: 41,
    durationSec: 94,
    status: 'running',
  },
  {
    id: 'a2a-8',
    time: '02:44:15',
    epoch: 224,
    agentId: 'grok',
    agentName: 'Grok Security Auditor',
    agentColor: 'text-blue-400 bg-blue-950/40 border-blue-800',
    ticketCode: 'A5',
    ticketTitle: 'Zero-Copy Token Stream & SSE Multiplexer',
    action: 'REVIEW',
    toolCall: 'audit_ssrf_and_backpressure(code="A5", branch="board/a5-sse-multiplexer")',
    jsonRpcMethod: 'a2a/tasks/send · security-review',
    branch: 'board/a5-sse-multiplexer',
    worktreePath: '/workspaces/worktrees/a5',
    filesTouched: ['backend/app/a2a_protocol.py', 'backend/app/events.py'],
    doneWhen: 'SSRF private-CIDR blocklist intact; slow consumers evicted cleanly',
    message: 'Security Audit: Buffer bounds verified, SSRF CIDR guard intact · approved',
    tokenCost: 41600,
    locAdded: 12,
    locRemoved: 4,
    durationSec: 27,
    status: 'success',
  },
  {
    id: 'a2a-9',
    time: '02:58:02',
    epoch: 238,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'A5',
    ticketTitle: 'Zero-Copy Token Stream & SSE Multiplexer',
    action: 'MERGE',
    toolCall: 'review_ticket(code="A5", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/a5-sse-multiplexer',
    worktreePath: '/workspaces/worktrees/a5',
    commitSha: '4f82e19',
    prNumber: 103,
    filesTouched: ['backend/app/a2a_protocol.py', 'backend/app/events.py'],
    doneWhen: 'p99 fan-out latency < 4ms across 16 A2A streams with backpressure ring-buffer',
    message: 'p99 latency measured at 1.8ms · 0 memory leaks · merged PR #103 -> main@4f82e19',
    tokenCost: 79300,
    locAdded: 296,
    locRemoved: 45,
    durationSec: 38,
    status: 'success',
  },
  {
    id: 'a2a-10',
    time: '03:35:50',
    epoch: 275,
    agentId: 'antigravity',
    agentName: 'Isaac Antigravity',
    agentColor: 'text-purple-400 bg-purple-950/40 border-purple-800',
    ticketCode: 'T6',
    ticketTitle: 'Circular DAG Loop Detector & Ready-Queue Topological Sort',
    action: 'TEST',
    toolCall: 'run_tests(command="uv run pytest -v tests/test_dag_cycles.py")',
    jsonRpcMethod: 'mcp/tools/call · run_verification',
    branch: 'board/t6-dag-toposort',
    worktreePath: '/workspaces/worktrees/t6',
    filesTouched: ['backend/app/db.py', 'backend/tests/test_dag_cycles.py'],
    doneWhen: 'Tarjan SCC detects 3-node cycles in <1ms and surfaces exact cycle path in UI',
    message: 'Tarjan SCC cycle checks verified: 14/14 property-based DAG cycle tests passed in 0.62s · ready for merge gate',
    tokenCost: 88200,
    locAdded: 218,
    locRemoved: 19,
    durationSec: 44,
    status: 'success',
  },
  {
    id: 'a2a-11',
    time: '03:54:11',
    epoch: 294,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'T6',
    ticketTitle: 'Circular DAG Loop Detector & Ready-Queue Topological Sort',
    action: 'MERGE',
    toolCall: 'review_ticket(code="T6", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/t6-dag-toposort',
    worktreePath: '/workspaces/worktrees/t6',
    commitSha: 'e03a77b',
    prNumber: 104,
    filesTouched: ['backend/app/db.py', 'backend/tests/test_dag_cycles.py'],
    doneWhen: 'Tarjan SCC detects 3-node cycles in <1ms and surfaces exact cycle path in UI',
    message: 'Cycle resolution verified: clean Tarjan implementation, crisp error messages · merged PR #104 -> main@e03a77b',
    tokenCost: 61400,
    locAdded: 218,
    locRemoved: 19,
    durationSec: 33,
    status: 'success',
  },
  {
    id: 'a2a-12',
    time: '04:32:27',
    epoch: 332,
    agentId: 'codex',
    agentName: 'Codex Worktree Pruner',
    agentColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800',
    ticketCode: 'M7',
    ticketTitle: 'Auto-Handoff Snapshot & Tree Preserver on Quota Exhaustion',
    action: 'WORKTREE',
    toolCall: 'claim_ticket(code="M7", auto_create_worktree=True)',
    jsonRpcMethod: 'mcp/tools/call · claim_ticket',
    branch: 'board/m7-quota-handoff',
    worktreePath: '/workspaces/worktrees/m7',
    filesTouched: ['backend/app/mcp_server.py', 'frontend/src/components/LocksAndAgents.tsx'],
    doneWhen: 'Out-of-usage agent commits WIP diff summary, releases locks, and queues peer pickup',
    message: 'Pristine mainline preserved: out-of-usage agent snapshots WIP diff, relays cleanly to peer',
    tokenCost: 76900,
    locAdded: 264,
    locRemoved: 31,
    durationSec: 63,
    status: 'running',
  },
  {
    id: 'a2a-13',
    time: '05:09:48',
    epoch: 369,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'M7',
    ticketTitle: 'Auto-Handoff Snapshot & Tree Preserver on Quota Exhaustion',
    action: 'MERGE',
    toolCall: 'review_ticket(code="M7", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/m7-quota-handoff',
    worktreePath: '/workspaces/worktrees/m7',
    commitSha: '72b91d4',
    prNumber: 105,
    filesTouched: ['backend/app/mcp_server.py', 'frontend/src/components/LocksAndAgents.tsx'],
    doneWhen: 'Out-of-usage agent commits WIP diff summary, releases locks, and queues peer pickup',
    message: 'Auto-handoff relay tested between Kimi -> Codex · merged PR #105 -> main@72b91d4',
    tokenCost: 68500,
    locAdded: 264,
    locRemoved: 31,
    durationSec: 41,
    status: 'success',
  },
  {
    id: 'a2a-14',
    time: '05:48:14',
    epoch: 408,
    agentId: 'minimax',
    agentName: 'MiniMax Lock Wrangler',
    agentColor: 'text-rose-400 bg-rose-950/40 border-rose-800',
    ticketCode: 'C8',
    ticketTitle: 'Portable Project Preset Exporter & Secret Scrubber',
    action: 'LOCK',
    toolCall: 'acquire_lock(lock_name="env:staging", expected_minutes=15)',
    jsonRpcMethod: 'mcp/tools/call · acquire_lock',
    branch: 'board/c8-preset-scrubber',
    worktreePath: '/workspaces/worktrees/c8',
    lockName: 'env:staging',
    filesTouched: ['backend/app/api_routes.py', 'backend/tests/test_presets.py'],
    doneWhen: 'Exported JSON presets strip tokens/endpoints and round-trip cleanly on fresh DB',
    message: 'Secret scrubber: rapid regex sanitizing API keys & tokens on env:staging',
    tokenCost: 53800,
    locAdded: 175,
    locRemoved: 14,
    durationSec: 36,
    status: 'success',
  },
  {
    id: 'a2a-15',
    time: '06:12:33',
    epoch: 432,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'C8',
    ticketTitle: 'Portable Project Preset Exporter & Secret Scrubber',
    action: 'MERGE',
    toolCall: 'review_ticket(code="C8", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/c8-preset-scrubber',
    worktreePath: '/workspaces/worktrees/c8',
    commitSha: '19d4fa2',
    prNumber: 106,
    filesTouched: ['backend/app/api_routes.py', 'backend/tests/test_presets.py'],
    doneWhen: 'Exported JSON presets strip tokens/endpoints and round-trip cleanly on fresh DB',
    message: 'Sanitization confirmed: API keys & bearer headers scrubbed · round-trip verified · merged PR #106 -> main@19d4fa2',
    tokenCost: 59100,
    locAdded: 175,
    locRemoved: 14,
    durationSec: 29,
    status: 'success',
  },
  {
    id: 'a2a-16',
    time: '06:34:19',
    epoch: 454,
    agentId: 'kimi',
    agentName: 'Kimi Deep Diver',
    agentColor: 'text-cyan-400 bg-cyan-950/40 border-cyan-800',
    ticketCode: 'H9',
    ticketTitle: 'Overnight Autonomous HUD Telemetry & Drum & Bass Sound Engine',
    action: 'DISPATCH',
    toolCall: 'a2a.tasks.sendSubscribe(agent="kimi-code", model="kimi-k2.5-thinking", effort="high")',
    jsonRpcMethod: 'a2a/tasks/sendSubscribe',
    branch: 'board/h9-overnight-hud',
    worktreePath: '/workspaces/worktrees/h9',
    lockName: 'ci:benchmark-runner',
    filesTouched: [
      'frontend/src/components/OvernightTerminalHUD.tsx',
      'frontend/src/App.tsx',
    ],
    doneWhen: 'tsc --noEmit 0 errors, vite build green, timeline scrubber & A2A trace inspector live',
    message: 'Executing H9 in /workspaces/worktrees/h9 · streaming 174 BPM WebAudio telemetry & real-time spectrum',
    tokenCost: 146800,
    locAdded: 342,
    locRemoved: 28,
    durationSec: 88,
    status: 'running',
  },
  {
    id: 'a2a-17',
    time: '06:54:08',
    epoch: 474,
    agentId: 'claude',
    agentName: 'Claude Architect',
    agentColor: 'text-amber-400 bg-amber-950/40 border-amber-800',
    ticketCode: 'H9',
    ticketTitle: 'Overnight Autonomous HUD Telemetry & Drum & Bass Sound Engine',
    action: 'MERGE',
    toolCall: 'review_ticket(code="H9", verdict="approve", merge_if_clean=True)',
    jsonRpcMethod: 'mcp/tools/call · review_ticket',
    branch: 'board/h9-overnight-hud',
    worktreePath: '/workspaces/worktrees/h9',
    commitSha: 'f82c901',
    prNumber: 107,
    filesTouched: [
      'frontend/src/components/OvernightTerminalHUD.tsx',
      'frontend/src/App.tsx',
    ],
    doneWhen: 'tsc --noEmit 0 errors, vite build green, timeline scrubber & A2A trace inspector live',
    message: 'Strict TypeScript clean, 174 BPM WebAudio engine active · merged PR #107 -> main@f82c901',
    tokenCost: 92400,
    locAdded: 342,
    locRemoved: 28,
    durationSec: 46,
    status: 'success',
  },
]

const PIPELINE_STAGES: Array<{
  id: PipelineStageId
  label: string
  shortLabel: string
  sub: string
  colorText: string
  colorBorder: string
  colorBg: string
}> = [
  {
    id: 'triage',
    label: '1. TRIAGE',
    shortLabel: 'TRIAGE',
    sub: 'decompose & grill',
    colorText: 'text-fuchsia-300',
    colorBorder: 'border-fuchsia-500/60',
    colorBg: 'bg-fuchsia-950/40',
  },
  {
    id: 'guard',
    label: '2. SPEC & LOCK',
    shortLabel: 'SPEC GUARD',
    sub: 'DAG + FIFO lock',
    colorText: 'text-purple-300',
    colorBorder: 'border-purple-500/60',
    colorBg: 'bg-purple-950/40',
  },
  {
    id: 'worktree',
    label: '3. WORKTREE',
    shortLabel: 'WORKTREE',
    sub: 'isolated branch',
    colorText: 'text-emerald-300',
    colorBorder: 'border-emerald-500/60',
    colorBg: 'bg-emerald-950/40',
  },
  {
    id: 'exec',
    label: '4. A2A EXEC',
    shortLabel: 'A2A EXEC',
    sub: 'SSE code runner',
    colorText: 'text-cyan-300',
    colorBorder: 'border-cyan-400/70',
    colorBg: 'bg-cyan-950/50',
  },
  {
    id: 'review',
    label: '5. REVIEW GATE',
    shortLabel: 'REVIEW GATE',
    sub: 'audit & merge',
    colorText: 'text-amber-300',
    colorBorder: 'border-amber-400/70',
    colorBg: 'bg-amber-950/40',
  },
]

function actionToStage(action: LogAction): PipelineStageId {
  switch (action) {
    case 'BLOCKED':
    case 'LOCK':
      return 'guard'
    case 'WORKTREE':
      return 'worktree'
    case 'DISPATCH':
    case 'TEST':
      return 'exec'
    case 'REVIEW':
    case 'MERGE':
      return 'review'
  }
}

function inferProviderId(raw?: string | null): string {
  const s = (raw || '').toLowerCase()
  if (s.includes('claude') || s.includes('sonnet') || s.includes('opus')) return 'claude'
  if (s.includes('kimi') || s.includes('moonshot')) return 'kimi'
  if (s.includes('antigravity') || s.includes('agy') || s.includes('gemini')) return 'antigravity'
  if (s.includes('codex') || s.includes('openai')) return 'codex'
  if (s.includes('minimax')) return 'minimax'
  if (s.includes('grok')) return 'grok'
  return 'kimi'
}

const ProviderVectorEmblem: React.FC<{ provider: string; className?: string }> = ({
  provider,
  className = 'w-4 h-4',
}) => {
  switch (provider) {
    case 'claude':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
        </svg>
      )
    case 'kimi':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M15.5 3.5a8.5 8.5 0 1 0 0 17 6.8 6.8 0 1 1 0-17z" />
          <circle cx="17.5" cy="8.5" r="1.8" />
        </svg>
      )
    case 'antigravity':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M12 2 L14.8 9.2 L22 12 L14.8 14.8 L12 22 L9.2 14.8 L2 12 L9.2 9.2 Z" />
        </svg>
      )
    case 'codex':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2">
          <polygon points="12,2.5 20,7.2 20,16.8 12,21.5 4,16.8 4,7.2" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        </svg>
      )
    case 'minimax':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18 L7 6 L12 14 L17 6 L21 18" />
        </svg>
      )
    case 'grok':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
          <circle cx="12" cy="12" r="6.5" />
          <line x1="4.5" y1="19.5" x2="19.5" y2="4.5" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M18 8h1a3 3 0 0 1 0 6h-1" />
          <path d="M4 8h14v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z" />
          <line x1="8" y1="3" x2="8" y2="5" />
          <line x1="12" y1="3" x2="12" y2="5" />
        </svg>
      )
  }
}

const ZERO_SPECTRUM: number[] = Array.from({ length: 12 }, () => 0)

const NeuroSpectrumBars = React.memo(function NeuroSpectrumBars({
  active,
  getLevels,
}: {
  active: boolean
  getLevels: () => number[]
}) {
  const barRefs = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    const resetBars = () => {
      for (let i = 0; i < 12; i++) {
        const el = barRefs.current[i]
        if (el) {
          el.style.height = '18%'
          el.style.opacity = '0.25'
        }
      }
    }

    if (!active) {
      resetBars()
      return
    }

    let rafId = 0
    const tick = () => {
      if (!document.hidden) {
        const levels = getLevels()
        for (let i = 0; i < 12; i++) {
          const el = barRefs.current[i]
          if (!el) continue
          const lvl = levels[i] || 0
          el.style.height = `${Math.max(18, Math.round(lvl * 100))}%`
          el.style.opacity = lvl > 0.04 ? '0.95' : '0.25'
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }

    const handleVisibility = () => {
      if (!document.hidden && rafId === 0) {
        rafId = window.requestAnimationFrame(tick)
      } else if (document.hidden && rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
    }

    if (!document.hidden) {
      rafId = window.requestAnimationFrame(tick)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [active, getLevels])

  return (
    <div
      className="flex items-end gap-0.5 h-6 px-2 py-1 rounded-xl bg-slate-950 border border-slate-800/90"
      title="Real-time WebAudio AnalyserNode spectrum (Sub F1 43Hz → 200Hz Snare → 8kHz Hats)"
    >
      {ZERO_SPECTRUM.map((_, idx) => (
        <span
          key={idx}
          ref={(el) => {
            barRefs.current[idx] = el
          }}
          className={`w-1 rounded-xs transition-[height,opacity] duration-75 ${
            idx < 3
              ? 'bg-purple-400'
              : idx < 7
                ? 'bg-cyan-400'
                : 'bg-emerald-400'
          }`}
          style={{ height: '18%', opacity: 0.25 }}
        />
      ))}
    </div>
  )
})

export const OvernightTerminalHUD: React.FC<OvernightTerminalHUDProps> = ({
  project,
  tickets,
  locks,
  agentProfiles,
  boardAgents = [],
  worktreesOverview = null,
  defaultTokenCeiling = 1_500_000,
  defaultNeuroArmed = false,
  defaultNeuroVolume = 0.78,
  prDropEnabled = true,
  isWallboardMode = false,
  onToggleWallboard,
  onSelectTicket,
  onNavigateTicket,
  onClaimTicket,
  onQuickCreateTriage,
}) => {
  // Mode: Simulated Overnight Run vs Live Connected Project State
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all')
  const [logFilterAction, setLogFilterAction] = useState<'ALL' | LogAction>('ALL')
  const [logSearchQuery, setLogSearchQuery] = useState<string>('')
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [pinnedTicketCode, setPinnedTicketCode] = useState<string | null>(null)
  const [showMorningDigest, setShowMorningDigest] = useState<boolean>(false)
  const [copiedDigest, setCopiedDigest] = useState<boolean>(false)
  const [followTail, setFollowTail] = useState<boolean>(true)
  const [liveClock, setLiveClock] = useState<string>(() =>
    new Date().toTimeString().split(' ')[0],
  )

  // Simulation timeline: 0 (23:00) to 480 (07:00 morning)
  const [simStep, setSimStep] = useState<number>(480)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [simSpeed, setSimSpeed] = useState<number>(3)

  // Overnight Token Budget Guardrail & Emergency Circuit Breaker
  const [tokenCeiling, setTokenCeiling] = useState<number>(defaultTokenCeiling)
  const [circuitBreakerTripped, setCircuitBreakerTripped] = useState<boolean>(false)
  const [ceilingOverridden, setCeilingOverridden] = useState<boolean>(false)
  const [breakerReason, setBreakerReason] = useState<string>('')
  const [broadcastHoldSent, setBroadcastHoldSent] = useState<boolean>(false)

  // 174 BPM Neurofunk WebAudio State
  const audioRef = useRef<NeurofunkAudioEngine | null>(null)
  const [audioArmed, setAudioArmed] = useState<boolean>(defaultNeuroArmed)
  const [neuroLoopActive, setNeuroLoopActive] = useState<boolean>(false)
  const [audioVolume, setAudioVolume] = useState<number>(defaultNeuroVolume)

  useEffect(() => {
    setTokenCeiling(defaultTokenCeiling)
  }, [defaultTokenCeiling])

  useEffect(() => {
    setAudioArmed(defaultNeuroArmed)
  }, [defaultNeuroArmed])

  useEffect(() => {
    setAudioVolume(defaultNeuroVolume)
    audioRef.current?.setVolume(defaultNeuroVolume)
  }, [defaultNeuroVolume])
  const [dropFlashLabel, setDropFlashLabel] = useState<string | null>(null)
  const [selectedDropFlavor, setSelectedDropFlavor] = useState<NeuroDropFlavor>('neurofunk')
  const dropFlashTimerRef = useRef<number | null>(null)

  const getLiveSpectrumLevels = useCallback((): number[] => {
    return audioRef.current?.getSpectrumLevels(12) || ZERO_SPECTRUM
  }, [])

  const currentDropMeta = useMemo<DropPresetMeta>(() => {
    return DROP_PRESETS.find((p) => p.id === selectedDropFlavor) || DROP_PRESETS[0]
  }, [selectedDropFlavor])

  const tailContainerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const getAudioEngine = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new NeurofunkAudioEngine()
      audioRef.current.setVolume(audioVolume)
    }
    return audioRef.current
  }, [audioVolume])

  const triggerDropVisual = useCallback((label: string) => {
    setDropFlashLabel(label)
    if (dropFlashTimerRef.current !== null) {
      window.clearTimeout(dropFlashTimerRef.current)
    }
    dropFlashTimerRef.current = window.setTimeout(() => {
      setDropFlashLabel(null)
    }, 3150)
  }, [])

  const triggerManualNeuroDrop = useCallback(() => {
    const eng = getAudioEngine()
    eng.unlock()
    setAudioArmed(true)
    eng.playPrMergeDrop(true, selectedDropFlavor)
    triggerDropVisual(
      `174 BPM DROP · [${currentDropMeta.name.toUpperCase()} · ${currentDropMeta.subLabel.toUpperCase()}] · PR REVIEW PASSED`,
    )
  }, [currentDropMeta, getAudioEngine, selectedDropFlavor, triggerDropVisual])

  const toggleAudioArmed = useCallback(() => {
    setAudioArmed((prev) => {
      const next = !prev
      const eng = getAudioEngine()
      if (next) {
        eng.unlock()
        eng.playDispatchTick()
      } else {
        eng.stopRollingLoop()
        setNeuroLoopActive(false)
      }
      return next
    })
  }, [getAudioEngine])

  const toggleNeuroLoop = useCallback(() => {
    const eng = getAudioEngine()
    eng.unlock()
    setNeuroLoopActive((prev) => {
      const next = !prev
      if (next) {
        setAudioArmed(true)
        eng.startRollingLoop()
      } else {
        eng.stopRollingLoop()
      }
      return next
    })
  }, [getAudioEngine])

  const toggleEmergencyStop = useCallback(() => {
    setCircuitBreakerTripped((prev) => {
      const next = !prev
      if (next) {
        setIsPlaying(false)
        setBreakerReason('Manual operator Emergency Stop engaged — new A2A dispatches frozen')
        if (audioArmed) {
          getAudioEngine().playQuarantineGrowl()
        }
      } else {
        setBreakerReason('')
      }
      return next
    })
  }, [audioArmed, getAudioEngine])

  // Cleanup WebAudio context & timers on unmount
  useEffect(() => {
    return () => {
      if (dropFlashTimerRef.current !== null) {
        window.clearTimeout(dropFlashTimerRef.current)
      }
      audioRef.current?.dispose()
      audioRef.current = null
    }
  }, [])

  // Live wall-clock updater when in Live Board Mode
  useEffect(() => {
    if (!isLiveConnected) return
    const timer = window.setInterval(() => {
      setLiveClock(new Date().toTimeString().split(' ')[0])
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isLiveConnected])

  // Simulation clock ticker
  useEffect(() => {
    if (!isPlaying || isLiveConnected || circuitBreakerTripped) return
    const interval = window.setInterval(() => {
      setSimStep((prev) => {
        if (prev >= 480) {
          setIsPlaying(false)
          return 480
        }
        return Math.min(480, prev + simSpeed)
      })
    }, 110)
    return () => window.clearInterval(interval)
  }, [isPlaying, simSpeed, isLiveConnected, circuitBreakerTripped])

  // Keyboard shortcuts (Space = Play/Pause, F = Wallboard, S = Audio, G = 174 Loop, D = Drop, K = Kill-switch, L = Live, M = Digest, / = Search)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === ' ' && !isLiveConnected) {
        e.preventDefault()
        if (circuitBreakerTripped) return
        setIsPlaying((prev) => {
          if (!prev && simStep >= 480) {
            setSimStep(0)
          }
          return !prev
        })
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        onToggleWallboard?.()
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        toggleAudioArmed()
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        toggleNeuroLoop()
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        triggerManualNeuroDrop()
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        toggleEmergencyStop()
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        setIsLiveConnected((prev) => !prev)
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        setShowMorningDigest((prev) => !prev)
      } else if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === '[' && !isLiveConnected) {
        e.preventDefault()
        setIsPlaying(false)
        setSimStep((prev) => Math.max(0, prev - 15))
      } else if (e.key === ']' && !isLiveConnected) {
        e.preventDefault()
        setIsPlaying(false)
        setSimStep((prev) => Math.min(480, prev + 15))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    circuitBreakerTripped,
    isLiveConnected,
    onToggleWallboard,
    simStep,
    toggleAudioArmed,
    toggleEmergencyStop,
    toggleNeuroLoop,
    triggerManualNeuroDrop,
  ])

  // Derive clock string from simStep (starts at 23:00 = 1380 mins)
  const clockString = useMemo(() => {
    if (isLiveConnected) return liveClock
    const totalMinutes = 23 * 60 + Math.floor(simStep)
    const normalizedMins = totalMinutes % (24 * 60)
    const hours = Math.floor(normalizedMins / 60)
      .toString()
      .padStart(2, '0')
    const mins = (normalizedMins % 60).toString().padStart(2, '0')
    const secs = Math.floor((simStep * 37) % 60)
      .toString()
      .padStart(2, '0')
    return `${hours}:${mins}:${secs}`
  }, [simStep, isLiveConnected, liveClock])

  // Synthesize live board A2A log stream from real A2A SSE events, CLI transcripts, locks & tickets
  const liveBoardEvents = useMemo<A2ALogEntry[]>(() => {
    const entries: A2ALogEntry[] = []
    let seq = 1

    // 1. Real A2A SSE stream events from connected profiles
    agentProfiles.forEach((prof) => {
      const pid = inferProviderId(prof.provider || prof.name)
      const persona = AGENT_PERSONAS.find((p) => p.id === pid) || AGENT_PERSONAS[1]
      ;(prof.a2a_recent_stream_events || []).forEach((sse) => {
        const timePart = sse.timestamp?.includes('T')
          ? sse.timestamp.split('T')[1].slice(0, 8)
          : liveClock
        entries.push({
          id: `sse-${sse.id || seq++}`,
          time: timePart,
          epoch: seq++,
          agentId: persona.id,
          agentName: persona.codeName,
          agentColor: persona.badgeColor,
          ticketCode: sse.task_id?.split('-').pop()?.toUpperCase() || 'A2A',
          ticketTitle: `Live A2A Stream (${prof.name})`,
          action: sse.final ? 'REVIEW' : 'DISPATCH',
          toolCall: `${sse.event_type}(state="${sse.state}")`,
          jsonRpcMethod: 'a2a/tasks/sendSubscribe · SSE',
          message: sse.summary || `A2A ${sse.event_type}: ${sse.state}`,
          tokenCost: Math.max(1200, Math.round((prof.usage_telemetry?.tokens_per_min || 8400) / 4)),
          locAdded: Math.max(0, Math.round((prof.usage_telemetry?.loc_per_min || 12) / 2)),
          locRemoved: 2,
          status: sse.state === 'failed' ? 'blocked' : sse.final ? 'success' : 'running',
        })
      })

      // 2. Real CLI transcript events if available (with structured file paths & shell verbs)
      ;(prof.recent_events || []).slice(-6).forEach((ev, idx) => {
        const timePart = ev.timestamp?.includes('T')
          ? ev.timestamp.split('T')[1].slice(0, 8)
          : liveClock
        const stableKey = `${prof.id}-${ev.timestamp || idx}-${(ev.summary || ev.kind).slice(0, 24)}`
        entries.push({
          id: `cli-${stableKey}`,
          time: timePart,
          epoch: seq++,
          agentId: persona.id,
          agentName: persona.codeName,
          agentColor: persona.badgeColor,
          ticketCode:
            boardAgents.find((ba) => inferProviderId(ba.id) === persona.id)
              ?.current_ticket_code || 'CLI',
          ticketTitle: `${prof.name} Host Transcript`,
          action:
            ev.action === 'error'
              ? 'BLOCKED'
              : ev.action === 'lock'
                ? 'LOCK'
                : ev.action === 'exec' || ev.tools?.some((t) => t.toLowerCase().includes('test'))
                  ? 'TEST'
                  : ev.action === 'write'
                    ? 'WORKTREE'
                    : 'DISPATCH',
          toolCall: ev.tools?.length
            ? ev.tools.join(', ')
            : ev.commands?.length
              ? ev.commands.join(' && ')
              : ev.kind,
          jsonRpcMethod: 'host-transcript/tail',
          filesTouched: ev.files,
          message: ev.summary || `Executed ${ev.kind}`,
          tokenCost: 4200,
          locAdded: ev.action === 'write' ? 28 : 8,
          locRemoved: 4,
          status: ev.status === 'error' || ev.action === 'error' ? 'blocked' : 'running',
        })
      })
    })

    // 2b. Worktree-local .kanbanana-agent.log transcript tails
    ;(worktreesOverview?.worktrees || []).forEach((wt) => {
      const pid = inferProviderId(wt.owner || 'claude')
      const persona = AGENT_PERSONAS.find((p) => p.id === pid) || AGENT_PERSONAS[0]
      ;(wt.git_status.agent_log_tail || []).slice(-4).forEach((wev, idx) => {
        const timePart = wev.timestamp?.includes('T')
          ? wev.timestamp.split('T')[1].slice(0, 8)
          : liveClock
        const stableKey = `${wt.ticket_code}-${wev.timestamp || idx}-${(wev.summary || '').slice(0, 20)}`
        entries.push({
          id: `wtlog-${stableKey}`,
          time: timePart,
          epoch: seq++,
          agentId: persona.id,
          agentName: wt.owner || persona.codeName,
          agentColor: persona.badgeColor,
          ticketCode: wt.ticket_code,
          ticketTitle: wt.ticket_title,
          action: wev.action === 'exec' ? 'TEST' : wev.action === 'write' ? 'WORKTREE' : 'DISPATCH',
          toolCall: wev.tools?.length
            ? wev.tools.join(', ')
            : wev.commands?.length
              ? wev.commands[0]
              : wev.kind,
          jsonRpcMethod: 'worktree-log/tail',
          branch: wt.branch_name || undefined,
          worktreePath: wt.worktree_path || undefined,
          filesTouched: wev.files?.length ? wev.files : wt.git_status.dirty_files,
          message: wev.summary || `Worktree activity in $${wt.ticket_code}`,
          tokenCost: 3600,
          locAdded: wev.action === 'write' ? 24 : 4,
          locRemoved: 2,
          status: wev.status === 'error' ? 'blocked' : 'running',
        })
      })
    })

    // 3. Active lock claims
    locks.forEach((lk) => {
      lk.active_claims.forEach((cl) => {
        const pid = inferProviderId(cl.agent_id)
        const persona = AGENT_PERSONAS.find((p) => p.id === pid) || AGENT_PERSONAS[4]
        const timePart = cl.acquired_at?.includes('T')
          ? cl.acquired_at.split('T')[1].slice(0, 8)
          : liveClock
        entries.push({
          id: `lock-${cl.id}`,
          time: timePart,
          epoch: seq++,
          agentId: persona.id,
          agentName: persona.codeName,
          agentColor: persona.badgeColor,
          ticketCode: cl.ticket_code || 'LOCK',
          ticketTitle: lk.description || `Exclusive lock ${lk.name}`,
          action: 'LOCK',
          toolCall: `acquire_lock(lock_name="${lk.name}")`,
          jsonRpcMethod: 'mcp/tools/call · acquire_lock',
          lockName: `${lk.name} (${lk.wait_queue.length} queued)`,
          message: `Held by ${cl.agent_id}${cl.reason ? ` · ${cl.reason}` : ''}`,
          tokenCost: 3100,
          locAdded: 0,
          locRemoved: 0,
          status: 'success',
        })
      })
    })

    // 4. Real board tickets across lifecycle states
    tickets.forEach((t, idx) => {
      const pid = inferProviderId(t.owner || (t.status === 'blocked' ? 'antigravity' : 'claude'))
      const persona = AGENT_PERSONAS.find((p) => p.id === pid) || AGENT_PERSONAS[0]
      const timePart = t.updated_at?.includes('T')
        ? t.updated_at.split('T')[1].slice(0, 8)
        : `06:${(10 + (idx % 48)).toString().padStart(2, '0')}:00`
      const wtItem = worktreesOverview?.worktrees.find(
        (w) => w.ticket_code.toUpperCase() === t.code.toUpperCase(),
      )

      if (t.status === 'done') {
        entries.push({
          id: `ticket-done-${t.id}`,
          time: timePart,
          epoch: seq++,
          agentId: persona.id,
          agentName: t.owner ? `${t.owner} (${persona.shortName})` : persona.codeName,
          agentColor: persona.badgeColor,
          ticketCode: t.code,
          ticketTitle: t.title,
          action: 'MERGE',
          toolCall: `review_ticket(code="${t.code}", verdict="approve")`,
          jsonRpcMethod: 'mcp/tools/call · review_ticket',
          branch: t.branch_name || `board/${t.code.toLowerCase()}`,
          worktreePath: t.worktree_path || undefined,
          commitSha: t.commit_sha ? t.commit_sha.slice(0, 7) : undefined,
          doneWhen: t.done_when_md || undefined,
          message: `${t.title}${t.commit_sha ? ` · merged @${t.commit_sha.slice(0, 7)}` : ' · completed & verified'}`,
          tokenCost: 42000 + (idx % 5) * 6500,
          locAdded: 160 + (idx % 6) * 42,
          locRemoved: 18 + (idx % 4) * 5,
          status: 'success',
        })
      } else if (t.status === 'review') {
        entries.push({
          id: `ticket-rev-${t.id}`,
          time: timePart,
          epoch: seq++,
          agentId: 'claude',
          agentName: 'Claude "Sonnet" Slammer',
          agentColor: AGENT_PERSONAS[0].badgeColor,
          ticketCode: t.code,
          ticketTitle: t.title,
          action: 'REVIEW',
          toolCall: `inspect_review_ticket(code="${t.code}")`,
          jsonRpcMethod: 'mcp/tools/call · inspect_review_ticket',
          branch: t.branch_name || `board/${t.code.toLowerCase()}`,
          worktreePath: t.worktree_path || undefined,
          doneWhen: t.done_when_md || undefined,
          message: `Awaiting review gate: ${t.title}${wtItem?.git_status.last_commit ? ` (${wtItem.git_status.last_commit})` : ''}`,
          tokenCost: 28400,
          locAdded: 195,
          locRemoved: 24,
          status: 'running',
        })
      } else if (t.status === 'in-progress') {
        entries.push({
          id: `ticket-prog-${t.id}`,
          time: timePart,
          epoch: seq++,
          agentId: persona.id,
          agentName: t.owner || persona.codeName,
          agentColor: persona.badgeColor,
          ticketCode: t.code,
          ticketTitle: t.title,
          action: t.worktree_path ? 'WORKTREE' : 'DISPATCH',
          toolCall: `claim_ticket(code="${t.code}", branch="${t.branch_name || `board/${t.code.toLowerCase()}`}")`,
          jsonRpcMethod: 'a2a/tasks/sendSubscribe',
          branch: t.branch_name || `board/${t.code.toLowerCase()}`,
          worktreePath:
            t.worktree_path ||
            `${project.worktrees_dir || '/workspaces/worktrees'}/${t.code.toLowerCase()}`,
          filesTouched: wtItem?.git_status.dirty_files,
          doneWhen: t.done_when_md || undefined,
          message: `Active execution: ${t.title}${wtItem?.git_status.dirty_count ? ` · ${wtItem.git_status.dirty_count} modified files` : ''}`,
          tokenCost: 54000,
          locAdded: 210,
          locRemoved: 19,
          status: 'running',
        })
      } else if (t.status === 'blocked' || !t.dependencies_satisfied) {
        entries.push({
          id: `ticket-blk-${t.id}`,
          time: timePart,
          epoch: seq++,
          agentId: 'antigravity',
          agentName: 'Isaac "Zero-G" Antigravity',
          agentColor: AGENT_PERSONAS[2].badgeColor,
          ticketCode: t.code,
          ticketTitle: t.title,
          action: 'BLOCKED',
          toolCall: `check_ticket_dependencies(code="${t.code}")`,
          jsonRpcMethod: 'mcp/tools/call · check_dependencies',
          doneWhen: t.done_when_md || undefined,
          message:
            t.blocked_reason ||
            `Waiting on dependencies [${t.depends_on.join(', ')}] before worktree claim`,
          tokenCost: 5200,
          locAdded: 0,
          locRemoved: 0,
          status: 'blocked',
        })
      }
    })

    return entries
  }, [agentProfiles, boardAgents, locks, tickets, worktreesOverview, project.worktrees_dir, liveClock])

  // Active events up to simStep (or real live events)
  const activeEvents = useMemo(() => {
    if (isLiveConnected) {
      return liveBoardEvents
    }
    return HISTORIC_A2A_LOGS.filter((e) => e.epoch <= simStep)
  }, [simStep, isLiveConnected, liveBoardEvents])

  // Auto-scroll `$ tail -f a2a-agents.log` when new events arrive during playback
  useEffect(() => {
    if (!followTail || !tailContainerRef.current) return
    tailContainerRef.current.scrollTop = tailContainerRef.current.scrollHeight
  }, [activeEvents.length, simStep, followTail])

  // Core engineering KPIs
  const stats = useMemo(() => {
    const profileTelemetryTokens = agentProfiles.reduce(
      (acc, p) => acc + (p.usage_telemetry?.total_tokens || 0),
      0,
    )
    const profileTokensPerMin = agentProfiles.reduce(
      (acc, p) => acc + (p.usage_telemetry?.tokens_per_min || 0),
      0,
    )

    let eventTokens = isLiveConnected ? 0 : Math.round(18400 * Math.min(1, simStep / 30))
    let totalLocAdded = 0
    let totalLocRemoved = 0
    let mergedCount = 0
    let blockedCount = 0

    // Avoid double counting LOC when DISPATCH -> MERGE happen on the same ticket in sim mode
    const locByTicket = new Map<string, { add: number; rem: number }>()

    activeEvents.forEach((e) => {
      eventTokens += e.tokenCost
      if (e.locAdded > 0 || e.locRemoved > 0) {
        const prev = locByTicket.get(e.ticketCode)
        locByTicket.set(e.ticketCode, {
          add: Math.max(prev?.add || 0, e.locAdded),
          rem: Math.max(prev?.rem || 0, e.locRemoved),
        })
      }
      if (e.action === 'MERGE') mergedCount += 1
      if (e.action === 'BLOCKED') blockedCount += 1
    })

    locByTicket.forEach((v) => {
      totalLocAdded += v.add
      totalLocRemoved += v.rem
    })

    const totalTokens = isLiveConnected
      ? Math.max(profileTelemetryTokens, eventTokens)
      : eventTokens
    const tokenBudget = tokenCeiling
    const budgetPct = Math.min(100, (totalTokens / Math.max(1, tokenBudget)) * 100)

    const elapsedMinutes = isLiveConnected ? 60 : Math.max(1, simStep)
    const burnTokPerMin = isLiveConnected
      ? profileTokensPerMin || Math.round(totalTokens / Math.max(1, tickets.length * 6))
      : Math.round(totalTokens / elapsedMinutes)

    const inProgressCount = isLiveConnected
      ? tickets.filter((t) => t.status === 'in-progress').length
      : activeEvents.some((e) => e.status === 'running') && simStep < 474
        ? 1
        : 0
    const reviewCount = isLiveConnected
      ? tickets.filter((t) => t.status === 'review').length
      : simStep >= 220 && simStep < 238
        ? 1
        : 0
    const todoCount = isLiveConnected
      ? tickets.filter((t) => t.status === 'todo' || t.status === 'triage').length
      : Math.max(0, 9 - mergedCount - blockedCount)

    return {
      tokens: totalTokens,
      tokenBudget,
      budgetPct,
      burnTokPerMin,
      locAdded: totalLocAdded,
      locRemoved: totalLocRemoved,
      netLoc: totalLocAdded,
      tasks: isLiveConnected ? tickets.length : 18,
      merged: isLiveConnected ? tickets.filter((t) => t.status === 'done').length : mergedCount,
      blocked: isLiveConnected
        ? tickets.filter((t) => t.status === 'blocked' || !t.dependencies_satisfied).length
        : blockedCount,
      inProgress: inProgressCount,
      inReview: reviewCount,
      todo: todoCount,
      heldLocks: isLiveConnected
        ? locks.filter((l) => l.active_claims.length > 0).length
        : simStep >= 112 && simStep < 474
          ? 1
          : 0,
      queuedLocks: isLiveConnected
        ? locks.reduce((acc, l) => acc + l.wait_queue.length, 0)
        : 0,
      activeWorktrees: isLiveConnected
        ? worktreesOverview?.worktrees.filter((w) => w.git_status.exists).length ||
          tickets.filter((t) => Boolean(t.worktree_path)).length
        : Math.min(4, Math.max(1, activeEvents.filter((e) => e.worktreePath).length)),
      lineCount: Math.max(8, activeEvents.length * 11 + Math.floor(simStep / 12)),
    }
  }, [
    activeEvents,
    agentProfiles,
    isLiveConnected,
    locks,
    simStep,
    tickets,
    tokenCeiling,
    worktreesOverview,
  ])

  // Latest headline event for Top HUD & Pipeline Stage highlight
  const latestEvent = activeEvents[activeEvents.length - 1] || null

  // Track already-seen event IDs so newly arriving MERGE / BLOCKED / DISPATCH events trigger cues cleanly
  const seenEventIdsRef = useRef<Set<string>>(
    new Set(HISTORIC_A2A_LOGS.map((e) => e.id)),
  )

  useEffect(() => {
    const currentIds = new Set(activeEvents.map((e) => e.id))
    // Remove rolled-back IDs when scrubbing backward or resetting timeline to 23:00
    seenEventIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        seenEventIdsRef.current.delete(id)
      }
    })

    const newlyArrived = activeEvents.filter((e) => !seenEventIdsRef.current.has(e.id))
    newlyArrived.forEach((e) => seenEventIdsRef.current.add(e.id))
    if (newlyArrived.length === 0) return

    const mergeEvt = [...newlyArrived].reverse().find((e) => e.action === 'MERGE')
    if (mergeEvt) {
      if (prDropEnabled) {
        const ticketFlavor: NeuroDropFlavor =
          mergeEvt.ticketCode === 'T6'
            ? 'liquid'
            : mergeEvt.ticketCode === 'W3'
              ? 'darkstep'
              : mergeEvt.ticketCode === 'A5'
                ? 'techstep'
                : mergeEvt.ticketCode === 'L4'
                  ? 'stadium'
                  : mergeEvt.ticketCode === 'M7'
                    ? 'rave'
                    : selectedDropFlavor

        const meta = DROP_PRESETS.find((p) => p.id === ticketFlavor) || currentDropMeta
        triggerDropVisual(
          `174 BPM DROP · [${meta.name.toUpperCase()} · ${meta.subLabel.toUpperCase()}] · $${mergeEvt.ticketCode} PASSED REVIEW${
            mergeEvt.prNumber ? ` (PR #${mergeEvt.prNumber})` : ''
          }`,
        )
        if (audioArmed) {
          getAudioEngine().playPrMergeDrop(false, ticketFlavor)
        }
      }
      return
    }

    if (!audioArmed) return
    const topNew = newlyArrived[newlyArrived.length - 1]
    if (topNew.action === 'BLOCKED') {
      getAudioEngine().playQuarantineGrowl()
    } else if (topNew.action === 'LOCK') {
      getAudioEngine().playLockClank()
    } else {
      getAudioEngine().playDispatchTick()
    }
  }, [activeEvents, audioArmed, getAudioEngine, triggerDropVisual])

  // Auto-trip Overnight Token Budget Guardrail when token usage crosses ceiling
  useEffect(() => {
    if (ceilingOverridden || circuitBreakerTripped) return
    if (stats.tokens >= tokenCeiling && (isPlaying || isLiveConnected)) {
      setCircuitBreakerTripped(true)
      setIsPlaying(false)
      setBreakerReason(
        `Overnight token ceiling (${(tokenCeiling / 1_000_000).toFixed(2)}M tok) reached at ${clockString} — new A2A dispatches paused`,
      )
      if (audioArmed) {
        getAudioEngine().playQuarantineGrowl()
      }
    }
  }, [
    audioArmed,
    ceilingOverridden,
    circuitBreakerTripped,
    clockString,
    getAudioEngine,
    isLiveConnected,
    isPlaying,
    stats.tokens,
    tokenCeiling,
  ])

  const handleBroadcastGuardrailHold = async () => {
    try {
      await api.postMessage(project.slug, {
        author: 'overnight-hud-guardrail',
        channel: 'general',
        title: `⛔ Overnight Token Ceiling Reached (${(tokenCeiling / 1_000_000).toFixed(2)}M tok)`,
        body_md: `Circuit breaker tripped at **${stats.tokens.toLocaleString()} tok**. Hold new ticket claims until operator resets the ceiling.`,
        pinned: true,
      })
      setBroadcastHoldSent(true)
      window.setTimeout(() => setBroadcastHoldSent(false), 3000)
    } catch {
      // ignore network error in offline preview
    }
  }

  // Per-Agent Roster dynamically computed from real events & live telemetry
  const agentRoster = useMemo<AgentCardItem[]>(() => {
    const totalTokForShare = Math.max(1, stats.tokens)

    return AGENT_PERSONAS.map((persona) => {
      if (persona.id === 'user') {
        const sleepHours = isLiveConnected ? 'On-Call' : `${((simStep / 480) * 8).toFixed(1)}h REM`
        return {
          ...persona,
          tokensUsed: 0,
          tokensPerMin: 0,
          tokenSharePct: 0,
          locShipped: 0,
          mergesCount: stats.merged,
          eventsCount: 0,
          status: 'READING',
          statusBadge: isLiveConnected ? 'OPERATOR' : simStep >= 474 ? 'AWAKE ☕' : sleepHours,
          isOnline: true,
        }
      }

      const myEvents = activeEvents.filter((e) => e.agentId === persona.id)
      const lastMyEvent = myEvents[myEvents.length - 1]
      const matchingLiveProfile = agentProfiles.find(
        (p) => inferProviderId(p.provider || p.name) === persona.id,
      )

      const eventTokens = myEvents.reduce((acc, e) => acc + e.tokenCost, 0)
      const liveTokens = matchingLiveProfile?.usage_telemetry?.total_tokens || 0
      const tokensUsed = isLiveConnected ? Math.max(liveTokens, eventTokens) : eventTokens
      const tokensPerMin = isLiveConnected
        ? matchingLiveProfile?.usage_telemetry?.tokens_per_min || 0
        : latestEvent?.agentId === persona.id
          ? Math.round(latestEvent.tokenCost / 4)
          : 0

      const locShipped = myEvents.reduce((acc, e) => acc + e.locAdded, 0)
      const mergesCount = myEvents.filter(
        (e) => e.action === 'MERGE' || e.action === 'WORKTREE' || e.action === 'DISPATCH',
      ).length

      let status: AgentOperationalStatus = 'STANDBY'
      let statusBadge = 'STANDBY'

      const isCurrentlyActive =
        (isLiveConnected &&
          (matchingLiveProfile?.activity_state === 'active' ||
            matchingLiveProfile?.a2a_stream_active)) ||
        (!isLiveConnected && latestEvent?.agentId === persona.id && simStep < 480)

      if (isCurrentlyActive) {
        if (persona.id === 'claude') {
          status = 'REVIEWING'
          statusBadge = 'MERGING'
        } else if (persona.id === 'kimi') {
          status = 'EXECUTING'
          statusBadge = 'LIVE A2A'
        } else if (persona.id === 'antigravity') {
          status = 'TRIAGING'
          statusBadge = 'GUARDING'
        } else if (persona.id === 'codex') {
          status = 'PLANNING'
          statusBadge = 'WORKTREE'
        } else if (persona.id === 'minimax') {
          status = 'LOCKING'
          statusBadge = 'LOCK HELD'
        } else {
          status = 'AUDITING'
          statusBadge = 'ROASTING'
        }
      } else if (lastMyEvent) {
        status = 'ACTIVE'
        statusBadge =
          lastMyEvent.action === 'MERGE'
            ? 'MERGED'
            : lastMyEvent.action === 'BLOCKED'
              ? 'GUARDED'
              : 'READY'
      }

      return {
        ...persona,
        defaultModel: matchingLiveProfile?.default_model || persona.defaultModel,
        tokensUsed,
        tokensPerMin,
        tokenSharePct: Math.min(100, Math.round((tokensUsed / totalTokForShare) * 100)),
        locShipped,
        mergesCount,
        eventsCount: myEvents.length,
        status,
        statusBadge,
        activeTicketCode: lastMyEvent?.ticketCode,
        isOnline: isLiveConnected
          ? Boolean(
              matchingLiveProfile?.mounted ||
                matchingLiveProfile?.a2a_connected ||
                myEvents.length > 0,
            )
          : true,
      }
    })
  }, [activeEvents, agentProfiles, isLiveConnected, latestEvent, simStep, stats.merged, stats.tokens])

  // Ticker queue pills across the top of the Pipeline Flow card
  const pipelineTickerItems = useMemo(() => {
    if (isLiveConnected && tickets.length > 0) {
      return tickets.slice(0, 4).map((t) => ({
        code: t.code,
        title: t.title,
        badge:
          t.status === 'done'
            ? 'Merged'
            : t.status === 'in-progress'
              ? 'A2A Live'
              : t.status === 'review'
                ? 'In Review'
                : t.status === 'blocked'
                  ? 'Blocked'
                  : 'Ready',
        tone:
          t.status === 'in-progress'
            ? 'cyan'
            : t.status === 'done'
              ? 'emerald'
              : t.status === 'review'
                ? 'amber'
                : t.status === 'blocked'
                  ? 'rose'
                  : 'slate',
      }))
    }

    // Derive dynamic status for 4 featured sprint tickets at current simStep
    const tracked = [
      { code: 'W3', label: 'W3_WORKTREE', title: 'Atomic Git Worktree & Orphan Pruner' },
      { code: 'A5', label: 'A5_SSE_MUX', title: 'Zero-Copy Token Stream & SSE Mux' },
      { code: 'T6', label: 'T6_TOPOSORT', title: 'DAG Cycle Detector & Topo Sort' },
      { code: 'H9', label: 'H9_HUD_V2', title: 'Autonomous HUD & 174 BPM Audio' },
    ]
    return tracked.map((item) => {
      const evs = activeEvents.filter((e) => e.ticketCode === item.code)
      const last = evs[evs.length - 1]
      if (!last) {
        return { code: item.code, title: item.title, badge: 'Queued', tone: 'slate' as const }
      }
      if (last.action === 'MERGE') {
        return {
          code: item.code,
          title: item.title,
          badge: `PR #${last.prNumber || ''} Merged`,
          tone: 'emerald' as const,
        }
      }
      return {
        code: item.code,
        title: item.title,
        badge: `${last.action} · Live`,
        tone: 'cyan' as const,
      }
    })
  }, [activeEvents, isLiveConnected, tickets])

  // Current active / focused task in the Center Task Window
  const currentActiveTask = useMemo(() => {
    // 1. If user pinned a specific ticket code from ticker or logs
    if (pinnedTicketCode) {
      const realMatch = tickets.find(
        (t) => t.code.toUpperCase() === pinnedTicketCode.toUpperCase(),
      )
      if (realMatch) {
        const wt = worktreesOverview?.worktrees.find(
          (w) => w.ticket_code.toUpperCase() === realMatch.code.toUpperCase(),
        )
        const heldLock = locks.find((l) =>
          l.active_claims.some(
            (c) => c.ticket_code.toUpperCase() === realMatch.code.toUpperCase(),
          ),
        )
        return {
          code: realMatch.code,
          title: realMatch.title,
          status: realMatch.status.toUpperCase(),
          branch: realMatch.branch_name || `board/${realMatch.code.toLowerCase()}`,
          worktree:
            realMatch.worktree_path ||
            `${project.worktrees_dir || '/workspaces/worktrees'}/${realMatch.code.toLowerCase()}`,
          assignedAgent: realMatch.owner || 'Unassigned (Ready for A2A Claim)',
          model: 'Auto-select via A2A Card',
          lockHeld: heldLock ? `${heldLock.name} (held)` : 'None required · lock-free',
          locAdded: wt?.git_status.dirty_count ? wt.git_status.dirty_count * 38 : 164,
          locRemoved: 18,
          doneWhen:
            realMatch.done_when_md ||
            realMatch.do_md ||
            'All unit tests & review gate invariants satisfied',
          filesTouched: wt?.git_status.dirty_files || [],
          boardTicket: realMatch,
          isClaimable:
            realMatch.status === 'todo' && realMatch.dependencies_satisfied,
        }
      }

      const simEvents = HISTORIC_A2A_LOGS.filter(
        (e) => e.ticketCode.toUpperCase() === pinnedTicketCode.toUpperCase(),
      )
      const targetEvt =
        simEvents.filter((e) => e.epoch <= simStep).pop() || simEvents[simEvents.length - 1]
      if (targetEvt) {
        const persona = AGENT_PERSONAS.find((p) => p.id === targetEvt.agentId)
        return {
          code: targetEvt.ticketCode,
          title: targetEvt.ticketTitle,
          status:
            targetEvt.action === 'MERGE'
              ? 'MERGED'
              : targetEvt.action === 'BLOCKED'
                ? 'QUARANTINED'
                : 'IN-PROGRESS',
          branch: targetEvt.branch || `board/${targetEvt.ticketCode.toLowerCase()}`,
          worktree:
            targetEvt.worktreePath ||
            `/workspaces/worktrees/${targetEvt.ticketCode.toLowerCase()}`,
          assignedAgent: targetEvt.agentName,
          model: persona?.defaultModel || 'kimi-k2.5-thinking',
          lockHeld: targetEvt.lockName || 'None held · isolated worktree',
          locAdded: targetEvt.locAdded,
          locRemoved: targetEvt.locRemoved,
          doneWhen:
            targetEvt.doneWhen || 'Zero lint/type errors and full pytest suite green',
          filesTouched: targetEvt.filesTouched || [],
          boardTicket: undefined,
          isClaimable: false,
        }
      }
    }

    // 2. Live Connected Mode: prioritize in-progress -> review -> ready todo -> first ticket
    if (isLiveConnected) {
      const candidate =
        tickets.find((t) => t.status === 'in-progress') ||
        tickets.find((t) => t.status === 'review') ||
        tickets.find((t) => t.status === 'todo' && t.dependencies_satisfied) ||
        tickets[0]

      if (candidate) {
        const wt = worktreesOverview?.worktrees.find(
          (w) => w.ticket_code.toUpperCase() === candidate.code.toUpperCase(),
        )
        const heldLock =
          locks.find((l) =>
            l.active_claims.some(
              (c) => c.ticket_code.toUpperCase() === candidate.code.toUpperCase(),
            ),
          ) || locks.find((l) => l.active_claims.length > 0)

        return {
          code: candidate.code,
          title: candidate.title,
          status: candidate.status.toUpperCase(),
          branch: candidate.branch_name || `board/${candidate.code.toLowerCase()}`,
          worktree:
            candidate.worktree_path ||
            `${project.worktrees_dir || '/workspaces/worktrees'}/${candidate.code.toLowerCase()}`,
          assignedAgent: candidate.owner || 'Ready to Dispatch (Click Launch A2A)',
          model: candidate.status === 'review' ? 'Mid-Tier Review Gate' : 'Frontier / Thinking',
          lockHeld: heldLock
            ? `${heldLock.name} (${heldLock.available_slots}/${heldLock.max_slots} free)`
            : locks[0]
              ? `${locks[0].name} (free)`
              : 'No contended locks',
          locAdded: wt?.git_status.dirty_count ? wt.git_status.dirty_count * 42 : 180,
          locRemoved: 22,
          doneWhen:
            candidate.done_when_md ||
            candidate.do_md ||
            'Pass automated test suite and zero-issue code review gate',
          filesTouched: wt?.git_status.dirty_files || [],
          boardTicket: candidate,
          isClaimable:
            candidate.status === 'todo' && candidate.dependencies_satisfied,
        }
      }

      return {
        code: 'READY',
        title: `No active tickets on "${project.name}" yet — add a triage idea to kick off agents`,
        status: 'IDLE',
        branch: 'main',
        worktree: project.worktrees_dir || '/workspaces/worktrees',
        assignedAgent: '6 A2A Workers Standing By',
        model: 'MCP + A2A v0.2.1 Ready',
        lockHeld: locks[0] ? `${locks[0].name} (free)` : 'All locks free',
        locAdded: 0,
        locRemoved: 0,
        doneWhen: 'Create a triage ticket or switch to Simulated Sprint to replay an overnight run',
        filesTouched: [] as string[],
        boardTicket: undefined,
        isClaimable: false,
      }
    }

    // 3. Simulation Mode: track the latest event at `simStep`!
    const focusEvt = latestEvent || HISTORIC_A2A_LOGS[0]
    const persona = AGENT_PERSONAS.find((p) => p.id === focusEvt.agentId)
    return {
      code: focusEvt.ticketCode,
      title: focusEvt.ticketTitle,
      status:
        simStep === 0
          ? 'INITIALIZING'
          : focusEvt.action === 'MERGE'
            ? `MERGED · PR #${focusEvt.prNumber || 107}`
            : focusEvt.action === 'BLOCKED'
              ? 'QUARANTINED'
              : 'IN-PROGRESS',
      branch: focusEvt.branch || `board/${focusEvt.ticketCode.toLowerCase()}`,
      worktree:
        focusEvt.worktreePath || `/workspaces/worktrees/${focusEvt.ticketCode.toLowerCase()}`,
      assignedAgent: focusEvt.agentName,
      model: persona?.defaultModel || 'kimi-k2.5-thinking (high effort)',
      lockHeld: focusEvt.lockName || 'Isolated worktree (no contended lock)',
      locAdded: simStep === 0 ? 0 : focusEvt.locAdded,
      locRemoved: simStep === 0 ? 0 : focusEvt.locRemoved,
      doneWhen:
        focusEvt.doneWhen || 'All unit tests passing and review gate approves clean diff',
      filesTouched: focusEvt.filesTouched || [],
      boardTicket: tickets.find(
        (t) => t.code.toUpperCase() === focusEvt.ticketCode.toUpperCase(),
      ),
      isClaimable: false,
    }
  }, [
    isLiveConnected,
    latestEvent,
    locks,
    pinnedTicketCode,
    project.name,
    project.worktrees_dir,
    simStep,
    tickets,
    worktreesOverview,
  ])

  // Active stage in the 5-stage pipeline highway
  const activePipelineStage: PipelineStageId = useMemo(() => {
    if (isLiveConnected) {
      if (tickets.some((t) => t.status === 'review')) return 'review'
      if (tickets.some((t) => t.status === 'in-progress')) return 'exec'
      if (tickets.some((t) => t.status === 'triage')) return 'triage'
      return 'guard'
    }
    if (simStep === 0) return 'triage'
    if (!latestEvent) return 'guard'
    return actionToStage(latestEvent.action)
  }, [isLiveConnected, latestEvent, simStep, tickets])

  const activePipelineStageIndex = useMemo(() => {
    const idx = PIPELINE_STAGES.findIndex((s) => s.id === activePipelineStage)
    return idx >= 0 ? idx : 0
  }, [activePipelineStage])

  // Filtered A2A logs stream for the bottom window (newest first so latest actions are front & center)
  const displayedA2ALogs = useMemo(() => {
    return [...activeEvents]
      .reverse()
      .filter((log) => {
        if (selectedAgentId !== 'all' && log.agentId !== selectedAgentId) {
          return false
        }
        if (logFilterAction !== 'ALL' && log.action !== logFilterAction) {
          return false
        }
        if (logSearchQuery.trim()) {
          const q = logSearchQuery.toLowerCase()
          const textMatch =
            log.message.toLowerCase().includes(q) ||
            log.ticketCode.toLowerCase().includes(q) ||
            log.ticketTitle.toLowerCase().includes(q) ||
            (log.toolCall && log.toolCall.toLowerCase().includes(q)) ||
            (log.commitSha && log.commitSha.toLowerCase().includes(q)) ||
            (log.lockName && log.lockName.toLowerCase().includes(q)) ||
            (log.worktreePath && log.worktreePath.toLowerCase().includes(q)) ||
            (log.filesTouched && log.filesTouched.some((f) => f.toLowerCase().includes(q))) ||
            log.agentName.toLowerCase().includes(q)
          if (!textMatch) return false
        }
        return true
      })
  }, [activeEvents, selectedAgentId, logFilterAction, logSearchQuery])

  // Morning Standup Digest summary data + Markdown generator
  const morningDigest = useMemo(() => {
    const mergedEvents = activeEvents.filter((e) => e.action === 'MERGE')
    const blockedEvents = activeEvents.filter((e) => e.action === 'BLOCKED')
    const avgTokPerMerge =
      mergedEvents.length > 0 ? Math.round(stats.tokens / mergedEvents.length) : stats.tokens
    const topAgent = [...agentRoster]
      .filter((a) => a.id !== 'user')
      .sort((a, b) => b.tokensUsed - a.tokensUsed)[0]

    const mdLines = [
      `## ☀️ Kanbanana Morning Standup — ${project.name} (\`${project.slug}\`)`,
      `- **Window**: ${isLiveConnected ? `Live Snapshot (${clockString})` : `23:00 → ${clockString.slice(0, 5)}`}`,
      `- **Shipped**: **${stats.merged} PRs merged** (+${stats.locAdded.toLocaleString()} / -${stats.locRemoved.toLocaleString()} LOC) · **0 merge conflicts**`,
      `- **Total Token Usage**: \`${stats.tokens.toLocaleString()} tok\` (${stats.budgetPct.toFixed(1)}% of ${(tokenCeiling / 1_000_000).toFixed(1)}M ceiling · ~${(avgTokPerMerge / 1000).toFixed(1)}k tok/PR)`,
      `- **Quarantined for Human Review**: ${blockedEvents.length}`,
      '',
      '### ✅ Shipped Overnight',
      ...(mergedEvents.length > 0
        ? mergedEvents.map(
            (m) =>
              `- **$${m.ticketCode}** (${m.ticketTitle}) — \`+${m.locAdded} LOC\`${m.commitSha ? ` @ \`${m.commitSha}\`` : ''} · *${m.agentName}*`,
          )
        : ['- *(No merges recorded in window yet)*']),
      '',
      '### 🛡️ Quarantined by Spec / Security Guard',
      ...(blockedEvents.length > 0
        ? blockedEvents.map(
            (b) => `- **$${b.ticketCode}**: ${b.message} (*caught by ${b.agentName}*)`,
          )
        : ['- None — all queued specs satisfied invariants!']),
    ]

    return {
      mergedEvents,
      blockedEvents,
      avgTokPerMerge,
      topAgent,
      markdown: mdLines.join('\n'),
    }
  }, [
    activeEvents,
    agentRoster,
    clockString,
    isLiveConnected,
    project.name,
    project.slug,
    stats.budgetPct,
    stats.locAdded,
    stats.locRemoved,
    stats.merged,
    stats.tokens,
    tokenCeiling,
  ])

  const handleInspectTicketCode = (code: string) => {
    const found = tickets.find((t) => t.code.toUpperCase() === code.toUpperCase())
    if (found && onSelectTicket) {
      onSelectTicket(found)
      return
    }
    if (isLiveConnected && onNavigateTicket) {
      onNavigateTicket(code)
      return
    }
    setPinnedTicketCode((prev) => (prev === code ? null : code))
  }

  const diffBudgetPct = Math.min(
    100,
    Math.round(((currentActiveTask.locAdded + currentActiveTask.locRemoved) / 500) * 100),
  )

  return (
    <div
      className={`w-full ${
        isWallboardMode ? 'max-w-none' : 'max-w-[1560px]'
      } mx-auto flex flex-col gap-4 select-none pb-12 font-sans`}
    >
      {/* ===================================================================== */}
      {/* TOP CONTROL DECK: MODE SWITCH, WALLBOARD, NEURO SYNTH & BUDGET GUARD  */}
      {/* ===================================================================== */}
      <div className="rounded-2xl bg-slate-900/95 border border-slate-800 px-4 py-3 shadow-lg flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  circuitBreakerTripped
                    ? 'bg-rose-500 animate-ping'
                    : 'bg-emerald-400 animate-ping'
                }`}
              />
              <span
                className={`text-xs font-mono font-bold uppercase tracking-wider ${
                  circuitBreakerTripped ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {circuitBreakerTripped ? 'Circuit Breaker Halted' : 'Autonomous Overnight HUD'}
              </span>
            </div>
            <span className="text-xs text-slate-600">|</span>
            <span className="px-2 py-0.5 rounded-md bg-slate-800/90 border border-slate-700 text-[11px] font-mono text-slate-200">
              {project.name}{' '}
              <span className="text-slate-400">({project.slug})</span>
            </span>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              {isLiveConnected
                ? 'Live Board + A2A SSE Telemetry'
                : '8-Hour Autonomous Sprint Replay (23:00 → 07:00)'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Wallboard / Kiosk Fullscreen Mode Toggle (F) */}
            {onToggleWallboard && (
              <button
                type="button"
                onClick={() => onToggleWallboard()}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer ${
                  isWallboardMode
                    ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/60 shadow-sm shadow-indigo-500/20'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:text-white'
                }`}
                title="Toggle Wallboard / Kiosk Fullscreen Mode (Shortcut: F)"
              >
                {isWallboardMode ? (
                  <Minimize2 className="w-3.5 h-3.5 text-indigo-300" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>{isWallboardMode ? 'Exit Wallboard' : 'Wallboard'}</span>
              </button>
            )}

            {/* Morning Standup Digest Toggle */}
            <button
              type="button"
              onClick={() => setShowMorningDigest((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer ${
                showMorningDigest
                  ? 'bg-amber-400/20 text-amber-200 border-amber-400/60 shadow-sm shadow-amber-500/20'
                  : 'bg-slate-800/90 text-amber-300/90 border-amber-500/30 hover:bg-amber-950/40'
              }`}
              title="Toggle Morning Wake-Up Briefing (Shortcut: M)"
            >
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Morning Digest</span>
              {morningDigest.blockedEvents.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black text-[9px] leading-none">
                  {morningDigest.blockedEvents.length} review
                </span>
              )}
            </button>

            {/* Toggle Live Board vs Simulated Overnight Run */}
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false)
                setPinnedTicketCode(null)
                setIsLiveConnected((prev) => !prev)
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer ${
                isLiveConnected
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60 shadow-sm shadow-cyan-500/20'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
              title="Toggle between Live Project Board and Simulated Overnight Replay (Shortcut: L)"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isLiveConnected ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              {isLiveConnected
                ? `Live Board (${tickets.length} tickets)`
                : `Switch to Live Board (${tickets.length})`}
            </button>

            {!isLiveConnected && (
              <>
                {/* Play / Pause */}
                <button
                  type="button"
                  disabled={circuitBreakerTripped}
                  onClick={() => {
                    if (!isPlaying && simStep >= 480) {
                      setSimStep(0)
                    }
                    setIsPlaying((prev) => !prev)
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold shadow-xs transition ${
                    circuitBreakerTripped
                      ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                  }`}
                  title={
                    circuitBreakerTripped
                      ? 'Reset or raise Budget Guardrail to resume'
                      : 'Play / Pause Overnight Replay (Shortcut: Space)'
                  }
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {isPlaying ? 'Pause' : simStep >= 480 ? 'Replay Night' : 'Resume'}
                </button>

                {/* Speed Selector */}
                <div className="inline-flex items-center rounded-xl bg-slate-950 border border-slate-800 p-0.5 text-[10px] font-mono">
                  {[
                    { label: '1x', val: 1 },
                    { label: '3x', val: 3 },
                    { label: '8x', val: 8 },
                  ].map((sp) => (
                    <button
                      key={sp.val}
                      type="button"
                      onClick={() => setSimSpeed(sp.val)}
                      className={`px-2 py-0.5 rounded-lg transition cursor-pointer ${
                        simSpeed === sp.val
                          ? 'bg-slate-800 text-cyan-300 font-bold'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                      title={`Playback speed ${sp.label}`}
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>

                {/* Reset to 23:00 */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false)
                    setSimStep(0)
                  }}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
                  title="Reset timeline to 23:00"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                {/* Jump to 07:00 Morning */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false)
                    setSimStep(480)
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono transition cursor-pointer"
                  title="Fast-forward to 07:00 Morning"
                >
                  <FastForward className="w-3 h-3 text-cyan-400" />
                  07:00
                </button>
              </>
            )}
          </div>
        </div>

        {/* Interactive Night Timeline Scrubber with Event Markers (Simulation Mode) */}
        {!isLiveConnected && (
          <div className="flex items-center gap-3 pt-1 border-t border-slate-800/70">
            <span className="text-[10px] font-mono text-slate-500 shrink-0 w-11">23:00</span>
            <div className="relative flex-1 flex items-center h-6">
              {/* Background Track */}
              <div className="w-full h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-75"
                  style={{ width: `${(simStep / 480) * 100}%` }}
                />
              </div>

              {/* Event Tick Markers Along the 8h Timeline */}
              {HISTORIC_A2A_LOGS.map((ev) => {
                const leftPct = (ev.epoch / 480) * 100
                const reached = ev.epoch <= simStep
                const dotClass =
                  ev.action === 'MERGE'
                    ? 'bg-emerald-400 ring-emerald-500/40'
                    : ev.action === 'BLOCKED'
                      ? 'bg-rose-400 ring-rose-500/40'
                      : ev.action === 'LOCK'
                        ? 'bg-amber-400 ring-amber-500/40'
                        : 'bg-cyan-400 ring-cyan-500/40'
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => {
                      setIsPlaying(false)
                      setSimStep(ev.epoch)
                    }}
                    style={{ left: `${leftPct}%` }}
                    className={`absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 transition transform hover:scale-150 cursor-pointer z-10 ${
                      reached ? dotClass : 'bg-slate-700 ring-slate-800 opacity-50'
                    }`}
                    title={`${ev.time.slice(0, 5)} · [${ev.action}] $${ev.ticketCode} — ${ev.agentName}`}
                  />
                )
              })}

              {/* Native Scrub Range Input */}
              <input
                type="range"
                min={0}
                max={480}
                value={simStep}
                onChange={(e) => {
                  setIsPlaying(false)
                  setSimStep(Number(e.target.value))
                }}
                aria-label="Overnight simulation timeline scrubber"
                className="absolute inset-0 w-full opacity-0 cursor-pointer z-20"
              />
            </div>
            <span className="text-[11px] font-mono font-bold text-amber-300 shrink-0 w-16 text-right">
              {clockString.slice(0, 5)}
            </span>
          </div>
        )}

        {/* 174 BPM Neurofunk WebAudio Deck + Overnight Budget Ceiling & Emergency Stop */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs font-mono">
          {/* Left: 174 BPM Drum & Bass / Neurofunk Reese Audio Synth Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={toggleAudioArmed}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold transition cursor-pointer ${
                audioArmed
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/60 shadow-xs shadow-emerald-500/20'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
              title="Arm WebAudio cues & 174 BPM Neurofunk Reese drop on PR review pass (Shortcut: S)"
            >
              {audioArmed ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{audioArmed ? 'Neuro Audio Armed' : 'Arm Neuro Audio'}</span>
            </button>

            <button
              type="button"
              onClick={toggleNeuroLoop}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold transition cursor-pointer ${
                neuroLoopActive
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60 shadow-xs shadow-cyan-500/20'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
              title="Toggle continuous 174 BPM rolling techstep breakbeat & F1 sub groove (Shortcut: G)"
            >
              <Waves className="w-3.5 h-3.5 text-cyan-400" />
              <span>174 BPM Groove</span>
            </button>

            <button
              type="button"
              onClick={triggerManualNeuroDrop}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-black uppercase tracking-wide transition cursor-pointer ${
                dropFlashLabel
                  ? 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-purple-500 text-slate-950 border-emerald-300 shadow-md shadow-cyan-500/30'
                  : 'bg-purple-950/50 hover:bg-purple-900/60 text-purple-200 border-purple-500/40'
              }`}
              title={`Fire the 174 BPM Drop: ${currentDropMeta.name} (${currentDropMeta.subLabel})`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Drop: {currentDropMeta.name.split(' ')[0]}</span>
            </button>

            {/* 174 BPM Drum & Bass Drop Preset Selector */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-950 border border-slate-800 text-[10px]">
              <span className="text-purple-400 font-bold uppercase tracking-wider">STYLE:</span>
              <select
                value={selectedDropFlavor}
                onChange={(e) => setSelectedDropFlavor(e.target.value as NeuroDropFlavor)}
                className="bg-transparent text-slate-200 text-[10px] font-mono cursor-pointer focus:outline-none"
                aria-label="174 BPM Drum & Bass Drop Preset"
              >
                {DROP_PRESETS.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-950 text-slate-200">
                    {p.name} ({p.subLabel})
                  </option>
                ))}
              </select>
            </div>

            {/* Volume Slider */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-500">VOL</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(audioVolume * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100
                  setAudioVolume(v)
                  audioRef.current?.setVolume(v)
                }}
                aria-label="Neurofunk audio volume"
                className="w-16 accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Live 12-Band Reese Bass & Breakbeat Spectrum Visualizer */}
            <NeuroSpectrumBars
              active={audioArmed || neuroLoopActive || Boolean(dropFlashLabel)}
              getLevels={getLiveSpectrumLevels}
            />
          </div>

          {/* Right: Overnight Budget Guardrail Ceiling + Emergency Stop */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-slate-400 uppercase">Token Ceiling:</span>
            <div className="inline-flex items-center rounded-xl bg-slate-950 border border-slate-800 p-0.5 text-[10px]">
              {[
                { label: '500k', val: 500_000 },
                { label: '800k', val: 800_000 },
                { label: '1.2M', val: 1_200_000 },
                { label: '1.5M', val: 1_500_000 },
                { label: '2.0M', val: 2_000_000 },
              ].map((preset) => (
                <button
                  key={preset.val}
                  type="button"
                  onClick={() => {
                    setTokenCeiling(preset.val)
                    setCeilingOverridden(false)
                    if (stats.tokens < preset.val && circuitBreakerTripped) {
                      setCircuitBreakerTripped(false)
                      setBreakerReason('')
                    }
                  }}
                  className={`px-2 py-0.5 rounded-lg transition cursor-pointer ${
                    tokenCeiling === preset.val
                      ? 'bg-slate-800 text-amber-300 font-bold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleEmergencyStop}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold uppercase transition cursor-pointer ${
                circuitBreakerTripped
                  ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-md shadow-rose-600/30 animate-pulse'
                  : 'bg-rose-950/40 hover:bg-rose-950/70 text-rose-300 border-rose-800/70'
              }`}
              title="Emergency Stop / Circuit Breaker — freezes new A2A dispatches (Shortcut: K)"
            >
              <OctagonAlert className="w-3.5 h-3.5" />
              <span>{circuitBreakerTripped ? 'Reset Breaker' : 'Emergency Stop'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* ACTIVE NEURO DROP BANNER (WHEN PR PASSES REVIEW & MERGES!)            */}
      {/* ===================================================================== */}
      {dropFlashLabel && (
        <div className="rounded-2xl border border-emerald-400/70 bg-gradient-to-r from-emerald-950/90 via-cyan-950/90 to-purple-950/90 px-4 py-2.5 shadow-lg shadow-emerald-500/20 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2 py-0.5 rounded bg-emerald-400 text-slate-950 font-black text-[10px] uppercase tracking-wider shrink-0 flex items-center gap-1">
              <Zap className="w-3 h-3 text-slate-950 fill-current" />
              174 BPM DROP
            </span>
            <span className="font-bold text-emerald-200 tracking-wide truncate">
              {dropFlashLabel}
            </span>
          </div>
          <span className="text-[11px] text-cyan-300 hidden sm:inline shrink-0 font-medium">
            ♫ Style: {currentDropMeta.name} · {currentDropMeta.vibe}
          </span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* OVERNIGHT BUDGET CIRCUIT BREAKER ALERT BANNER                         */}
      {/* ===================================================================== */}
      {circuitBreakerTripped && (
        <div className="rounded-2xl border border-rose-500/70 bg-gradient-to-r from-rose-950/90 via-slate-900 to-amber-950/60 p-4 shadow-xl flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-400/60 flex items-center justify-center text-rose-300 shrink-0">
              <OctagonAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-rose-200 uppercase tracking-wider">
                ⛔ Overnight Guardrail / Circuit Breaker Active
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                {breakerReason ||
                  `Token usage (${stats.tokens.toLocaleString()} tok) reached ceiling (${tokenCeiling.toLocaleString()} tok). New A2A dispatches are frozen.`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setTokenCeiling((prev) => prev + 500_000)
                setCircuitBreakerTripped(false)
                setBreakerReason('')
                if (!isLiveConnected && simStep < 480) {
                  setIsPlaying(true)
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition cursor-pointer"
            >
              +500k Ceiling &amp; Resume
            </button>
            <button
              type="button"
              onClick={() => {
                setCeilingOverridden(true)
                setCircuitBreakerTripped(false)
                setBreakerReason('')
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 font-bold text-[11px] transition cursor-pointer"
            >
              Override Ceiling
            </button>
            {isLiveConnected && (
              <button
                type="button"
                onClick={handleBroadcastGuardrailHold}
                className="px-3 py-1.5 rounded-xl bg-indigo-950 hover:bg-indigo-900 border border-indigo-700 text-indigo-200 font-semibold text-[11px] transition cursor-pointer"
              >
                {broadcastHoldSent ? '✓ Posted to Board!' : 'Broadcast Hold to Agents'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* COLLAPSIBLE MORNING STANDUP DIGEST DRAWER                             */}
      {/* ===================================================================== */}
      {showMorningDigest && (
        <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-slate-900 via-[#10131c] to-amber-950/20 p-5 shadow-xl flex flex-col gap-4 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                <Sun className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Wake-Up Standup Briefing · {project.name}
                  </h2>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                    {stats.merged} PRs Shipped · 0 Conflicts
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  30-second human summary of autonomous execution, token efficiency, and quarantined specs
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(morningDigest.markdown)
                  setCopiedDigest(true)
                  window.setTimeout(() => setCopiedDigest(false), 2000)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 font-semibold transition cursor-pointer"
              >
                {copiedDigest ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Copied Markdown!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-amber-300" />
                    <span>Copy Standup .md</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowMorningDigest(false)}
                className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer"
                title="Close Morning Digest"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Column 1: Shipped PRs */}
            <div className="rounded-xl border border-emerald-500/25 bg-slate-950/70 p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400 uppercase">
                <span className="flex items-center gap-1.5">
                  <GitMerge className="w-3.5 h-3.5" /> Shipped & Merged ({morningDigest.mergedEvents.length})
                </span>
                <span>+{stats.locAdded.toLocaleString()} LOC</span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                {morningDigest.mergedEvents.length === 0 ? (
                  <span className="text-slate-500 text-[11px]">
                    Scrub forward or wait for review gate merges...
                  </span>
                ) : (
                  morningDigest.mergedEvents.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleInspectTicketCode(m.ticketCode)}
                      className="text-left p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800/80 flex items-center justify-between gap-2 transition cursor-pointer"
                    >
                      <span className="truncate text-slate-200">
                        <strong className="text-emerald-300">${m.ticketCode}</strong> · {m.ticketTitle}
                      </span>
                      <span className="text-[10px] text-emerald-400 shrink-0">
                        +{m.locAdded}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Column 2: Needs Human Eyes (Quarantined) */}
            <div className="rounded-xl border border-rose-500/25 bg-slate-950/70 p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-rose-400 uppercase">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" /> Quarantined for You ({morningDigest.blockedEvents.length})
                </span>
                <span>Actionable</span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                {morningDigest.blockedEvents.length === 0 ? (
                  <span className="text-emerald-400/80 text-[11px]">
                    Zero quarantined tickets — every queued spec passed guardrails!
                  </span>
                ) : (
                  morningDigest.blockedEvents.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleInspectTicketCode(b.ticketCode)}
                      className="text-left p-2 rounded-lg bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/50 flex flex-col gap-0.5 transition cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-rose-300">${b.ticketCode}</span>
                        <span className="text-[10px] text-slate-400">
                          caught by {b.agentName.split(' ')[0]}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-300 line-clamp-2">{b.message}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Column 3: Token Efficiency & MVP */}
            <div className="rounded-xl border border-cyan-500/25 bg-slate-950/70 p-3.5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-cyan-300 uppercase">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Night Efficiency
                </span>
                <span>{stats.budgetPct.toFixed(1)}% budget</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">Avg Tokens / PR</div>
                  <div className="text-sm font-bold text-white">
                    {(morningDigest.avgTokPerMerge / 1000).toFixed(1)}k tok
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">Burn Rate</div>
                  <div className="text-sm font-bold text-cyan-300">
                    {stats.burnTokPerMin.toLocaleString()} tok/m
                  </div>
                </div>
              </div>
              {morningDigest.topAgent && (
                <div className="p-2 rounded-lg bg-indigo-950/30 border border-indigo-800/50 text-[11px] flex items-center justify-between">
                  <span className="text-slate-400">Heavy Lifter:</span>
                  <span className="text-indigo-200 font-bold truncate ml-2">
                    {morningDigest.topAgent.codeName} (
                    {(morningDigest.topAgent.tokensUsed / 1000).toFixed(1)}k)
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MAIN TERMINAL SHELL WINDOW                                            */}
      {/* ===================================================================== */}
      <div
        className={`rounded-3xl border border-slate-800/90 bg-[#090b0e] p-5 sm:p-6 text-slate-100 shadow-2xl shadow-black/80 flex flex-col gap-6 relative overflow-hidden ${
          dropFlashLabel ? 'neuro-drop-active' : ''
        }`}
      >
        {/* Ambient Radial Glows */}
        <div className="absolute top-0 right-1/4 w-[520px] h-[300px] bg-cyan-500/5 blur-[120px] pointer-events-none rounded-full" />
        <div className="absolute bottom-0 left-1/4 w-[520px] h-[300px] bg-emerald-500/5 blur-[120px] pointer-events-none rounded-full" />

        {/* Top Window Chrome (Mac Traffic Lights + Title + Shortcut Hints + Status) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 pb-3 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-full bg-rose-500 shadow-xs shadow-rose-500/40 shrink-0" />
            <span className="w-3 h-3 rounded-full bg-amber-500 shadow-xs shadow-amber-500/40 shrink-0" />
            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/40 shrink-0" />
            <span className="ml-2 text-[11px] text-slate-400 truncate">
              kanbanana-hud — {project.slug} · 6 autonomous A2A agents · 174 BPM neuro-gated
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-slate-500 mr-2">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                Space
              </kbd>
              <span>Play</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 ml-1">
                F
              </kbd>
              <span>Wallboard</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 ml-1">
                S / D
              </kbd>
              <span>Neuro / Drop</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 ml-1">
                K
              </kbd>
              <span>Breaker</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 ml-1">
                /
              </kbd>
              <span>Search</span>
            </div>

            {isWallboardMode && onToggleWallboard && (
              <button
                type="button"
                onClick={() => onToggleWallboard(false)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-500/50 text-[10px] font-bold uppercase cursor-pointer"
              >
                <Minimize2 className="w-3 h-3" />
                Exit Wallboard [Esc]
              </button>
            )}

            <span
              className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                circuitBreakerTripped
                  ? 'bg-rose-950/90 text-rose-300 border-rose-500/50'
                  : 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {circuitBreakerTripped
                ? 'guardrail tripped · paused'
                : isLiveConnected
                  ? 'live board · sse connected'
                  : 'autonomous sprint · log first'}
            </span>
          </div>
        </div>

        {/* Top HUD: Reactive Kanbanana Bot Head + Clock + Engineering KPIs */}
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
          {/* Left: Glowing Dancing Yellow Banana Avatar + Live Headline */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggleNeuroLoop}
              className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-b from-amber-400/20 via-yellow-400/10 to-slate-950/80 border border-amber-400/50 p-1.5 shadow-xl flex items-center justify-center shrink-0 transition-all duration-300 cursor-pointer group hover:scale-105 hover:border-yellow-300 hover:shadow-yellow-400/30 ${
                dropFlashLabel
                  ? 'ring-2 ring-emerald-400 shadow-emerald-500/40 bg-yellow-400/30'
                  : latestEvent?.action === 'BLOCKED'
                    ? 'shadow-rose-500/30 border-rose-400/40'
                    : 'shadow-amber-400/25'
              }`}
              title="Dancing Kanbanana! Click to toggle 174 BPM DnB groove (Shortcut: G)"
            >
              {/* Yellow Banana Character SVG */}
              <div
                className={`w-full h-full flex items-center justify-center transition-transform ${
                  dropFlashLabel
                    ? 'banana-dancing-fast'
                    : isPlaying || neuroLoopActive
                      ? 'banana-dancing'
                      : 'group-hover:banana-dancing'
                }`}
              >
                <svg
                  viewBox="0 0 64 64"
                  className="w-full h-full overflow-visible drop-shadow-[0_2px_8px_rgba(234,179,8,0.45)]"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="bananaBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#fef08a" />
                      <stop offset="35%" stopColor="#fde047" />
                      <stop offset="70%" stopColor="#eab308" />
                      <stop offset="100%" stopColor="#ca8a04" />
                    </linearGradient>
                    <linearGradient id="bananaHighlightGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                      <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
                    </linearGradient>
                  </defs>

                  {/* Dancing Arms */}
                  <g className="banana-left-arm">
                    <path
                      d="M 23 32 Q 13 27 11 17"
                      stroke="#ca8a04"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <circle cx="11" cy="16" r="3.2" fill="#fef08a" stroke="#a16207" strokeWidth="1.2" />
                    <circle cx="10" cy="14" r="1.5" fill="#fde047" />
                  </g>
                  <g className="banana-right-arm">
                    <path
                      d="M 41 32 Q 51 27 53 17"
                      stroke="#ca8a04"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <circle cx="53" cy="16" r="3.2" fill="#fef08a" stroke="#a16207" strokeWidth="1.2" />
                    <circle cx="54" cy="14" r="1.5" fill="#fde047" />
                  </g>

                  {/* Main Curved Yellow Banana Body */}
                  <path
                    d="M 33 8
                       C 26 12, 17 22, 17 36
                       C 17 50, 27 58, 35 59
                       C 39 59.5, 42 57, 43 53
                       C 43 47, 40 40, 37 32
                       C 35 24, 36 15, 36 10
                       C 36 8, 34 7, 33 8 Z"
                    fill="url(#bananaBodyGrad)"
                    stroke="#a16207"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />

                  {/* Front Highlight Ridge */}
                  <path
                    d="M 32 11
                       C 26 16, 21 26, 21 37
                       C 21 47, 28 54, 34 56"
                    stroke="url(#bananaHighlightGrad)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />

                  {/* Green Stem at Top */}
                  <path
                    d="M 33 8 C 32 5, 34 2, 36 3 C 37 4, 36 7, 35 9 Z"
                    fill="#84cc16"
                    stroke="#3f6212"
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />

                  {/* Brown Bottom Tip */}
                  <path
                    d="M 34.5 58 C 36 59, 39 58.5, 39.5 56 C 37.5 56.5, 35.5 57, 34.5 58 Z"
                    fill="#78350f"
                  />

                  {/* Dancing Shoes */}
                  <ellipse cx="26" cy="60" rx="4.5" ry="2.2" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
                  <ellipse cx="38" cy="60" rx="4.5" ry="2.2" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />

                  {/* Expressive Banana Face */}
                  <g className="banana-eyes">
                    {/* Left Eye */}
                    <ellipse cx="27" cy="30" rx="2.5" ry="3.5" fill="#1e1b4b" />
                    <circle cx="26" cy="28.8" r="1.1" fill="#ffffff" />
                    <circle cx="27.8" cy="31.8" r="0.6" fill="#ffffff" />

                    {/* Right Eye */}
                    <ellipse cx="35" cy="30" rx="2.5" ry="3.5" fill="#1e1b4b" />
                    <circle cx="34" cy="28.8" r="1.1" fill="#ffffff" />
                    <circle cx="35.8" cy="31.8" r="0.6" fill="#ffffff" />

                    {/* Cheeks */}
                    <ellipse cx="23.5" cy="34" rx="2.2" ry="1.4" fill="#f43f5e" opacity="0.6" />
                    <ellipse cx="38.5" cy="34" rx="2.2" ry="1.4" fill="#f43f5e" opacity="0.6" />

                    {/* Big Joyful Open Grin */}
                    <path
                      d="M 27 35.5 Q 31 43 35 35.5 Z"
                      fill="#dc2626"
                      stroke="#78350f"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                    />
                    <path d="M 28.5 38.5 Q 31 42 33.5 38.5 Z" fill="#fb7185" />
                  </g>

                  {/* Cyber DJ Headphones */}
                  <path
                    d="M 19 28 C 18 14, 42 14, 43 28"
                    stroke="#06b6d4"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <rect x="16" y="24" width="4.5" height="8.5" rx="2" fill="#22d3ee" stroke="#0891b2" strokeWidth="1" />
                  <rect x="41.5" y="24" width="4.5" height="8.5" rx="2" fill="#22d3ee" stroke="#0891b2" strokeWidth="1" />
                </svg>
              </div>

              {/* Status Dot */}
              <span
                className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-slate-950 ${
                  dropFlashLabel
                    ? 'bg-cyan-400 animate-ping'
                    : latestEvent?.action === 'BLOCKED'
                      ? 'bg-amber-400 animate-ping'
                      : 'bg-emerald-400 animate-pulse'
                }`}
              />
            </button>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-mono">
                  Kanbanana Terminal
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-emerald-400/15 text-emerald-300 border border-emerald-400/40 text-[11px] font-mono font-bold">
                  v1.2-neuro
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  {isLiveConnected
                    ? 'live sync'
                    : simStep >= 480
                      ? 'sprint complete'
                      : isPlaying
                        ? 'executing night'
                        : 'paused'}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300 font-bold tracking-wider">{clockString}</span>
                {latestEvent ? (
                  <button
                    type="button"
                    onClick={() => handleInspectTicketCode(latestEvent.ticketCode)}
                    className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase cursor-pointer transition ${
                      latestEvent.action === 'MERGE'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/70 hover:bg-emerald-900/60'
                        : latestEvent.action === 'BLOCKED'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-700/70 hover:bg-rose-900/60'
                          : 'bg-cyan-950/80 text-cyan-300 border-cyan-700/70 hover:bg-cyan-900/60'
                    }`}
                  >
                    {latestEvent.action} · ${latestEvent.ticketCode}
                    {latestEvent.prNumber ? ` (PR #${latestEvent.prNumber})` : ''}
                  </button>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px] font-bold uppercase">
                    READY AT 23:00
                  </span>
                )}
              </div>

              <span className="text-[11px] font-mono text-slate-500">
                atomic claims · isolated git worktrees · FIFO resource locks · A2A JSON-RPC
              </span>
            </div>
          </div>

          {/* Right: Engineering KPIs (Total Token Usage + Budget Bar, Tasks, PRs Merged, Quarantined) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 sm:gap-7 w-full xl:w-auto">
            {/* KPI 1: Total Token Usage */}
            <div className="flex flex-col sm:items-end gap-0.5">
              <span className="text-2xl sm:text-4xl font-black font-mono tracking-tight text-cyan-300">
                {stats.tokens.toLocaleString()}
              </span>
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                total token usage
              </span>
              <div className="w-full sm:w-40 h-1.5 rounded-full bg-slate-900 border border-slate-800 overflow-hidden mt-1">
                <div
                  className={`h-full transition-all duration-300 ${
                    circuitBreakerTripped || stats.budgetPct >= 100
                      ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                      : stats.budgetPct >= 80
                        ? 'bg-gradient-to-r from-cyan-400 to-amber-400'
                        : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                  }`}
                  style={{ width: `${Math.max(3, stats.budgetPct)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                {stats.budgetPct.toFixed(1)}% of{' '}
                {tokenCeiling >= 1_000_000
                  ? `${(tokenCeiling / 1_000_000).toFixed(1)}M`
                  : `${Math.round(tokenCeiling / 1000)}k`}{' '}
                cap · {stats.burnTokPerMin.toLocaleString()} tok/m
              </span>
            </div>

            {/* KPI 2: Board Tasks */}
            <div className="flex flex-col sm:items-end sm:border-l sm:border-slate-800/80 sm:pl-6 gap-0.5">
              <span className="text-2xl sm:text-3xl font-black font-mono text-white">
                {stats.tasks}
              </span>
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                board tasks
              </span>
              <span className="text-[10px] font-mono text-slate-500 mt-1">
                {stats.inProgress} active · {stats.inReview} review · {stats.todo} queued
              </span>
            </div>

            {/* KPI 3: PRs Merged */}
            <div className="flex flex-col sm:items-end sm:border-l sm:border-slate-800/80 sm:pl-6 gap-0.5">
              <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400">
                {stats.merged}
              </span>
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                PRs merged
              </span>
              <span className="text-[10px] font-mono text-emerald-400/80 mt-1">
                +{stats.locAdded.toLocaleString()} / -{stats.locRemoved.toLocaleString()} LOC
              </span>
            </div>

            {/* KPI 4: Quarantined / Blocked */}
            <div className="flex flex-col sm:items-end sm:border-l sm:border-slate-800/80 sm:pl-6 gap-0.5">
              <span className="text-2xl sm:text-3xl font-black font-mono text-amber-300">
                {stats.blocked}
              </span>
              <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                quarantined
              </span>
              <span className="text-[10px] font-mono text-slate-500 mt-1">
                0 merge conflicts
              </span>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* 2-COLUMN WORKSPACE: LEFT ROSTER (4) + RIGHT PIPELINE & STREAM (8)   */}
        {/* =================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ================================================================= */}
          {/* LEFT COLUMN: ACTIVE AGENTS ROSTER WITH EMBLEMS, PUNS & BURN BARS  */}
          {/* ================================================================= */}
          <div className="lg:col-span-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 uppercase px-1">
              <span className="font-bold tracking-wider">ACTIVE AGENTS ROSTER</span>
              <div className="flex items-center gap-2">
                {selectedAgentId !== 'all' ? (
                  <button
                    type="button"
                    onClick={() => setSelectedAgentId('all')}
                    className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700 hover:bg-cyan-900 cursor-pointer"
                  >
                    Filter: {selectedAgentId} ×
                  </button>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                      {agentRoster.filter(a => a.id !== 'user' && (a.tokensPerMin > 0 || a.status === 'EXECUTING' || a.status === 'REVIEWING')).length} ACTIVE
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-cyan-400">+{stats.netLoc.toLocaleString()} LOC</span>
                  </>
                )}
              </div>
            </div>

            {agentRoster.map((ag) => {
              const isSelected = selectedAgentId === ag.id
              const isHighlighted =
                ag.status === 'EXECUTING' ||
                ag.status === 'REVIEWING' ||
                ag.status === 'LOCKING' ||
                ag.status === 'AUDITING'
              const isBurningTokens =
                ag.id !== 'user' &&
                (ag.tokensPerMin > 0 ||
                  ag.status === 'EXECUTING' ||
                  ag.status === 'REVIEWING' ||
                  ag.status === 'TRIAGING' ||
                  ag.status === 'LOCKING' ||
                  (isLiveConnected && ag.tokensUsed > 0 && ag.isOnline))

              return (
                <div
                  key={ag.id}
                  onClick={() =>
                    ag.id === 'user'
                      ? setShowMorningDigest((prev) => !prev)
                      : setSelectedAgentId(selectedAgentId === ag.id ? 'all' : ag.id)
                  }
                  className={`rounded-2xl border p-3 flex flex-col gap-1.5 transition cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? 'bg-slate-900 border-cyan-400 shadow-xl shadow-cyan-500/20 ring-1 ring-cyan-400/50'
                      : isBurningTokens
                        ? 'hud-token-working bg-slate-900/95 border-cyan-400/90 shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/40'
                        : isHighlighted
                          ? 'bg-slate-900/90 border-cyan-500/50 shadow-md shadow-cyan-500/10'
                          : 'bg-slate-900/55 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  {/* Top Line: Provider Emblem + Agentic Name + Live Status Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl border ${ag.iconBg} flex items-center justify-center shrink-0 shadow-inner relative`}
                      >
                        {isBurningTokens && (
                          <span className="absolute -inset-1 rounded-xl border border-cyan-400/70 animate-ping opacity-60 pointer-events-none" />
                        )}
                        <ProviderVectorEmblem provider={ag.provider} className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-sm tracking-tight text-white truncate">
                            {ag.codeName}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono truncate">
                          {ag.realName} · {ag.defaultModel}
                        </span>
                      </div>
                    </div>

                    {isBurningTokens ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] font-black uppercase shrink-0 border bg-cyan-950/90 text-cyan-300 border-cyan-400/80 shadow-xs shadow-cyan-500/40">
                        <Zap className="w-2.5 h-2.5 text-cyan-300 fill-current animate-bounce" />
                        {ag.tokensPerMin > 0 ? `${ag.tokensPerMin.toLocaleString()} TOK/M` : 'SYNTHESIZING'}
                      </span>
                    ) : (
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold uppercase shrink-0 border ${ag.badgeColor}`}
                      >
                        {ag.statusBadge}
                      </span>
                    )}
                  </div>

                  {/* Role + Token Usage + Active Ticket Chip + Live Frequency Equalizer */}
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono pt-0.5">
                    <span className="text-slate-300 font-medium truncate">{ag.role}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isBurningTokens && (
                        <div
                          className="flex items-end gap-0.5 h-3.5 px-1 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/50 shadow-xs shadow-cyan-500/20"
                          title={`Active token generation: ${ag.tokensPerMin > 0 ? `${ag.tokensPerMin.toLocaleString()} tok/min` : 'Streaming tokens'}`}
                        >
                          <span className="w-1 bg-cyan-400 rounded-full hud-equalizer-bar-1" />
                          <span className="w-1 bg-cyan-300 rounded-full hud-equalizer-bar-2" />
                          <span className="w-1 bg-emerald-400 rounded-full hud-equalizer-bar-3" />
                          <span className="w-1 bg-cyan-400 rounded-full hud-equalizer-bar-4" />
                          <span className="w-1 bg-emerald-300 rounded-full hud-equalizer-bar-5" />
                        </div>
                      )}
                      {ag.activeTicketCode && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isBurningTokens
                            ? 'bg-cyan-950/90 border border-cyan-500/60 text-cyan-200 animate-pulse'
                            : 'bg-slate-950 border border-slate-800 text-slate-300'
                        }`}>
                          ${ag.activeTicketCode}
                        </span>
                      )}
                      <span className={`font-bold ${isBurningTokens ? 'text-emerald-300 animate-pulse' : 'text-cyan-300'}`}>
                        {ag.tokensUsed > 0
                          ? `${(ag.tokensUsed / 1000).toFixed(1)}k tok`
                          : ag.id === 'user'
                            ? '0 tok · rested'
                            : '0.0k tok'}
                      </span>
                    </div>
                  </div>

                  {/* Token Share Mini Progress Bar (for AI workers) */}
                  {ag.id !== 'user' && (
                    <div className="flex flex-col gap-1">
                      <div className={`flex-1 h-1.5 rounded-full bg-slate-950 overflow-hidden ${isBurningTokens ? 'hud-shimmer-bar' : ''}`}>
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${isBurningTokens ? 'bg-gradient-to-r from-cyan-400 via-emerald-400 to-indigo-400' : ''}`}
                          style={{
                            width: `${Math.max(ag.tokensUsed > 0 ? 4 : 0, ag.tokenSharePct)}%`,
                            backgroundColor: isBurningTokens ? undefined : ag.accentHex,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[9px] font-mono text-slate-500">
                        <span>
                          {ag.tokenSharePct}% share
                          {ag.locShipped > 0 ? ` · +${ag.locShipped} LOC` : ''}
                        </span>
                        {isBurningTokens && (
                          <span className="text-cyan-300 font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            ACTIVE BURN
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Witty Agentic Pun */}
                  <div className="pt-1 border-t border-slate-800/60 text-[10px] font-mono text-amber-300/90 italic leading-snug">
                    &ldquo;{ag.pun}&rdquo;
                  </div>
                </div>
              )
            })}
          </div>

          {/* ================================================================= */}
          {/* RIGHT COLUMN: 5-STAGE PIPELINE + ACTIVE TASK + TAIL + A2A STREAM  */}
          {/* ================================================================= */}
          <div className="lg:col-span-8 flex flex-col gap-5">
            {/* 1. INTERACTIVE 5-STAGE KANBANANA PIPELINE HIGHWAY */}
            <div className="rounded-2xl border border-slate-800 bg-[#0d1017] p-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400 border-b border-slate-800/70 pb-2">
                <div className="flex flex-wrap items-center gap-2 tracking-wide font-semibold text-slate-300">
                  <span className="text-cyan-400 font-mono font-bold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    LIVE PIPELINE FLOW
                  </span>
                  <span className="text-slate-600 hidden sm:inline">·</span>
                  <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                    <span className={activePipelineStageIndex >= 0 ? 'text-emerald-400' : 'text-slate-500'}>TRIAGE</span>
                    <span className="text-cyan-400 font-bold hud-chevron-1">»</span>
                    <span className={activePipelineStageIndex >= 1 ? 'text-emerald-400' : 'text-slate-500'}>SPEC &amp; LOCK</span>
                    <span className="text-cyan-400 font-bold hud-chevron-2">»</span>
                    <span className={activePipelineStageIndex >= 2 ? 'text-emerald-400' : 'text-slate-500'}>WORKTREE</span>
                    <span className="text-cyan-400 font-bold hud-chevron-3">»</span>
                    <span className={activePipelineStageIndex >= 3 ? 'text-cyan-300 font-bold' : 'text-slate-500'}>A2A EXEC</span>
                    <span className="text-cyan-400 font-bold hud-chevron-1">»</span>
                    <span className={activePipelineStageIndex >= 4 ? 'text-emerald-400 font-bold' : 'text-slate-500'}>REVIEW GATE</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  {pinnedTicketCode && (
                    <button
                      type="button"
                      onClick={() => setPinnedTicketCode(null)}
                      className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700 text-[10px] cursor-pointer hover:bg-indigo-900 transition"
                    >
                      Pinned: ${pinnedTicketCode} ×
                    </button>
                  )}
                  <span className="text-emerald-400 font-medium">{stats.activeWorktrees} worktrees</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-300 font-medium">{stats.heldLocks} lock held</span>
                </div>
              </div>

              {/* Clickable Ticker Queue Pills Across Top */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {pipelineTickerItems.map((item) => {
                  const isPinned =
                    pinnedTicketCode?.toUpperCase() === item.code.toUpperCase()
                  const toneClasses =
                    item.tone === 'cyan'
                      ? 'border-cyan-700/70 bg-cyan-950/25 text-cyan-300'
                      : item.tone === 'emerald'
                        ? 'border-emerald-800/60 bg-emerald-950/15 text-emerald-300'
                        : item.tone === 'amber'
                          ? 'border-amber-800/60 bg-amber-950/20 text-amber-300'
                          : item.tone === 'rose'
                            ? 'border-rose-800/60 bg-rose-950/20 text-rose-300'
                            : 'border-slate-800 bg-slate-900/60 text-slate-300'
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => handleInspectTicketCode(item.code)}
                      title={`Focus or inspect $${item.code}: ${item.title}`}
                      className={`rounded-xl border p-2 flex items-center justify-between text-xs font-mono transition cursor-pointer hover:brightness-125 ${toneClasses} ${
                        isPinned ? 'ring-2 ring-cyan-400' : ''
                      }`}
                    >
                      <span className="font-bold text-white truncate">${item.code}</span>
                      <span className="text-[10px] shrink-0 ml-1">{item.badge}</span>
                    </button>
                  )
                })}
              </div>

              {/* 5-Stage Pipeline Nodes + Animated SVG Flow Connectors */}
              <div className="relative w-full rounded-xl border border-slate-800/90 bg-slate-950/90 px-3 py-4 overflow-hidden">
                {/* Grid backdrop + subtle radar sweep */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293718_1px,transparent_1px),linear-gradient(to_bottom,#1f293718_1px,transparent_1px)] bg-[size:16px_16px]" />
                <div className="hud-radar-beam absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-500/[0.05] to-transparent pointer-events-none" />

                {/* Stage-Aware Animated SVG Energy Conduits with Traveling Photons */}
                <svg
                  className="hidden sm:block absolute left-3 right-3 top-0 w-[calc(100%-1.5rem)] h-[84px] pointer-events-none"
                  viewBox="0 0 1000 84"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <filter id="hudLaserGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    <linearGradient id="hudActiveConduitGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
                      <stop offset="50%" stopColor="#38bdf8" stopOpacity="1" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
                    </linearGradient>
                  </defs>

                  {/* 4 Inter-Stage Energy Conduits Connecting the 5 Stage Centers (100, 300, 500, 700, 900) */}
                  {[0, 1, 2, 3].map((segIdx) => {
                    const x1 = 100 + segIdx * 200
                    const x2 = 300 + segIdx * 200
                    const y = 42
                    const isPassed = segIdx < activePipelineStageIndex
                    const isActive = segIdx === activePipelineStageIndex

                    if (isPassed) {
                      return (
                        <g key={segIdx}>
                          {/* Completed Stage Conduit: Solid Emerald Laser Track */}
                          <line
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            stroke="#065f46"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                          />
                          <line
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            stroke="#10b981"
                            strokeWidth="2"
                            strokeLinecap="round"
                            opacity="0.9"
                          />
                          {/* Steady Midpoint Photon */}
                          <circle cx={(x1 + x2) / 2} cy={y} r="2.5" fill="#34d399" opacity="0.8" />
                        </g>
                      )
                    }

                    if (isActive) {
                      return (
                        <g key={segIdx}>
                          {/* Active Stage Conduit: Glowing Cyan Pulse & Directional Energy */}
                          <line
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            stroke="#0891b2"
                            strokeWidth="4"
                            strokeLinecap="round"
                            opacity="0.5"
                          />
                          <line
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            stroke="url(#hudActiveConduitGrad)"
                            strokeWidth="2.5"
                            strokeDasharray="10 8"
                            strokeLinecap="round"
                            className="hud-flow-line"
                          />
                          {/* Traveling Photon Energy Packet 1 */}
                          <circle cy={y} r="5" fill="#38bdf8" filter="url(#hudLaserGlow)">
                            <animate
                              attributeName="cx"
                              values={`${x1};${x2}`}
                              dur="1.2s"
                              repeatCount="indefinite"
                            />
                            <animate
                              attributeName="opacity"
                              values="0.2;1;1;0.2"
                              dur="1.2s"
                              repeatCount="indefinite"
                            />
                          </circle>
                          <circle cy={y} r="2.5" fill="#ffffff">
                            <animate
                              attributeName="cx"
                              values={`${x1};${x2}`}
                              dur="1.2s"
                              repeatCount="indefinite"
                            />
                          </circle>
                          {/* Secondary trailing photon for rich particle density */}
                          <circle cy={y} r="3" fill="#06b6d4" opacity="0.7">
                            <animate
                              attributeName="cx"
                              values={`${x1};${x2}`}
                              dur="1.2s"
                              begin="0.6s"
                              repeatCount="indefinite"
                            />
                          </circle>
                        </g>
                      )
                    }

                    return (
                      <g key={segIdx}>
                        {/* Upcoming Stage Conduit: Subtle Standby Dashed Track */}
                        <line
                          x1={x1}
                          y1={y}
                          x2={x2}
                          y2={y}
                          stroke="#1e293b"
                          strokeWidth="2"
                          strokeDasharray="6 6"
                          strokeLinecap="round"
                          opacity="0.8"
                        />
                      </g>
                    )
                  })}
                </svg>

                <div className="relative z-10 grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {PIPELINE_STAGES.map((stg, stgIdx) => {
                    const isStageActive = activePipelineStage === stg.id
                    const isStagePassed = stgIdx < activePipelineStageIndex

                    const stageOwner =
                      stg.id === 'triage'
                        ? 'Antigravity'
                        : stg.id === 'guard'
                          ? 'MiniMax + Spec'
                          : stg.id === 'worktree'
                            ? 'Codex Git'
                            : stg.id === 'exec'
                              ? 'Kimi A2A'
                              : 'Claude + Grok'

                    return (
                      <div
                        key={stg.id}
                        className={`rounded-xl border p-2.5 flex flex-col items-center text-center gap-1.5 transition relative overflow-hidden ${
                          isStageActive
                            ? `${stg.colorBg} ${stg.colorBorder} shadow-lg shadow-cyan-500/20 hud-token-working scale-[1.03] z-20`
                            : isStagePassed
                              ? 'bg-slate-900/90 border-emerald-900/60 opacity-95'
                              : 'bg-slate-900/50 border-slate-800/80 opacity-60 text-slate-500'
                        }`}
                      >
                        {/* Top Laser Shimmer Beam on Active Stage */}
                        {isStageActive && (
                          <div className="hud-shimmer-bar absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
                        )}

                        <div className="relative flex items-center justify-center my-0.5">
                          {/* Spinning Dashed Halo & Radar Ping on Active Stage */}
                          {isStageActive && (
                            <>
                              <div className="hud-stage-halo absolute -inset-2 rounded-full border border-dashed border-cyan-400/80 pointer-events-none" />
                              <span className="absolute -inset-1 rounded-full border border-cyan-400/60 animate-ping pointer-events-none" />
                            </>
                          )}

                          {/* Completed Checkmark on Passed Stages */}
                          {isStagePassed && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-[9px] font-black shadow ring-1 ring-emerald-400 z-10">
                              ✓
                            </span>
                          )}

                          <div
                            className={`w-8 h-8 rounded-full border flex items-center justify-center font-mono text-xs font-black transition ${
                              isStageActive
                                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-500/30'
                                : isStagePassed
                                  ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                                  : 'bg-slate-950 border-slate-800 text-slate-500'
                            }`}
                          >
                            {stg.id === 'triage' && <Sparkles className="w-3.5 h-3.5" />}
                            {stg.id === 'guard' && <ShieldCheck className="w-3.5 h-3.5" />}
                            {stg.id === 'worktree' && <GitBranch className="w-3.5 h-3.5" />}
                            {stg.id === 'exec' && <Cpu className="w-3.5 h-3.5" />}
                            {stg.id === 'review' && <GitMerge className="w-3.5 h-3.5" />}
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-mono font-extrabold tracking-wider ${
                            isStageActive
                              ? 'text-cyan-200 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                              : isStagePassed
                                ? 'text-emerald-300'
                                : 'text-slate-400'
                          }`}
                        >
                          {stg.shortLabel}
                        </span>

                        <span
                          className={`text-[9px] font-mono truncate max-w-full ${
                            isStageActive
                              ? 'text-cyan-300/90 font-medium'
                              : isStagePassed
                                ? 'text-emerald-400/70'
                                : 'text-slate-500'
                          }`}
                        >
                          {stageOwner}
                        </span>

                        {isStageActive ? (
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-cyan-400/20 text-cyan-200 font-bold border border-cyan-400/30 flex items-center gap-1 shadow-sm">
                            <Zap className="w-2.5 h-2.5 text-cyan-300 animate-pulse" />
                            <span>${currentActiveTask.code}</span>
                          </span>
                        ) : isStagePassed ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 flex items-center gap-1 font-semibold">
                            ✓ Passed
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded text-slate-500 bg-slate-950/40">
                            {stg.sub}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 4 Engineering Guardrail Mini-Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-purple-400 text-[11px] font-bold">
                    <ShieldAlert className="w-3.5 h-3.5" /> SPEC GUARDED
                  </div>
                  <span className="text-base font-bold text-white">{stats.blocked}</span>
                  <span className="text-[10px] text-slate-500">DAG &amp; security catches</span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-bold">
                    <FolderGit2 className="w-3.5 h-3.5" /> WORKTREES
                  </div>
                  <span className="text-base font-bold text-white">
                    {stats.activeWorktrees} isolated
                  </span>
                  <span className="text-[10px] text-slate-500">500 LOC review cap</span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-amber-400 text-[11px] font-bold">
                    <Lock className="w-3.5 h-3.5" /> FIFO LOCKS
                  </div>
                  <span className="text-base font-bold text-white">
                    {stats.heldLocks} held · {stats.queuedLocks} wait
                  </span>
                  <span className="text-[10px] text-slate-500">lease auto-reclaim</span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-cyan-400 text-[11px] font-bold">
                    <Zap className="w-3.5 h-3.5" /> THROUGHPUT
                  </div>
                  <span className="text-base font-bold text-emerald-400">
                    +{stats.locAdded.toLocaleString()} LOC
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {stats.merged} clean merges
                  </span>
                </div>
              </div>
            </div>

            {/* 1.5 AGENTPLAY LIVE RADIAL SESSION MAP (Constellation + Single-Agent Drill-Down) */}
            <React.Suspense
              fallback={
                <div className="rounded-2xl border border-slate-800 bg-[#070a10] p-6 text-center font-mono text-xs text-slate-400">
                  Loading AgentPlay Radial Constellation...
                </div>
              }
            >
              <AgentPlayRadialMap
                projectName={project.name}
                projectSlug={project.slug}
                agents={agentRoster}
                agentProfiles={agentProfiles}
                worktreesOverview={worktreesOverview}
                tickets={tickets}
                locks={locks}
                events={activeEvents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                onInspectTicketCode={handleInspectTicketCode}
                activeLogFilter={logSearchQuery.trim() ? logSearchQuery.trim() : null}
                onFilterLogByNode={(tok) => setLogSearchQuery(tok || '')}
                isLiveConnected={isLiveConnected}
                isPlaying={isPlaying}
                getSpectrumLevels={getLiveSpectrumLevels}
                dropFlashLabel={dropFlashLabel}
              />
            </React.Suspense>

            {/* 2. CURRENT TASK INSPECTOR (Left) + $ tail -f a2a-agents.log (Right) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* CURRENT TASK BEING WORKED ON */}
              <div className="rounded-2xl border border-slate-800 bg-[#0d1017] p-4 flex flex-col justify-between gap-3 font-mono">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2 text-xs">
                  <span className="text-slate-300 text-[11px] flex items-center gap-1.5 font-bold">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    {pinnedTicketCode ? 'PINNED TASK INSPECTOR' : 'CURRENT TASK BEING WORKED ON'}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${
                      currentActiveTask.status.includes('MERGED') ||
                      currentActiveTask.status === 'DONE'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : currentActiveTask.status === 'QUARANTINED' ||
                            currentActiveTask.status === 'BLOCKED'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    }`}
                  >
                    {currentActiveTask.status}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black text-white">
                      ${currentActiveTask.code}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-bold">
                      {currentActiveTask.model}
                    </span>
                  </div>
                  <span className="text-xs font-extrabold text-emerald-400 shrink-0">
                    +{currentActiveTask.locAdded} / -{currentActiveTask.locRemoved} LOC
                  </span>
                </div>

                <p className="text-xs text-slate-200 font-semibold leading-snug line-clamp-2">
                  {currentActiveTask.title}
                </p>

                {/* Diff Scope Budget Bar (<500 LOC reviewable PR invariant) */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>PR Diff Scope Budget (500 LOC cap)</span>
                    <span
                      className={
                        diffBudgetPct > 85 ? 'text-amber-300 font-bold' : 'text-emerald-400 font-bold'
                      }
                    >
                      {currentActiveTask.locAdded + currentActiveTask.locRemoved} / 500 LOC (
                      {diffBudgetPct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        diffBudgetPct > 85
                          ? 'bg-gradient-to-r from-amber-500 to-rose-400'
                          : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                      }`}
                      style={{ width: `${Math.max(4, diffBudgetPct)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1 text-[11px] pt-1 border-t border-slate-800/60">
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span className="text-slate-500 shrink-0">agent:</span>
                    <span className="text-cyan-300 font-bold truncate">
                      {currentActiveTask.assignedAgent}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span className="text-slate-500 shrink-0">branch:</span>
                    <span className="text-slate-200 truncate">{currentActiveTask.branch}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span className="text-slate-500 shrink-0">worktree:</span>
                    <span className="text-slate-300 truncate">{currentActiveTask.worktree}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span className="text-slate-500 shrink-0">lock:</span>
                    <span className="text-amber-300 font-semibold truncate">
                      {currentActiveTask.lockHeld}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/60 text-[11px] flex flex-col gap-2">
                  <div className="text-slate-400 leading-snug line-clamp-2">
                    <span className="text-amber-400 font-bold">done when:</span>{' '}
                    <span>{currentActiveTask.doneWhen}</span>
                  </div>

                  {/* Interactive Actions for Board Tickets */}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>0 conflicts · review-gated</span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      {currentActiveTask.boardTicket && onSelectTicket && (
                        <button
                          type="button"
                          onClick={() => onSelectTicket(currentActiveTask.boardTicket!)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-200 font-semibold transition cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-cyan-400" />
                          Inspect
                        </button>
                      )}
                      {currentActiveTask.boardTicket &&
                        currentActiveTask.isClaimable &&
                        onClaimTicket && (
                          <button
                            type="button"
                            disabled={circuitBreakerTripped}
                            onClick={() => onClaimTicket(currentActiveTask.boardTicket!)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition ${
                              circuitBreakerTripped
                                ? 'bg-rose-950/60 text-rose-400 border border-rose-800 cursor-not-allowed'
                                : 'bg-gradient-to-r from-amber-500 to-cyan-500 hover:brightness-110 text-slate-950 cursor-pointer'
                            }`}
                            title={
                              circuitBreakerTripped
                                ? 'Circuit breaker active — reset breaker or raise ceiling to dispatch'
                                : 'Claim and dispatch ticket via A2A'
                            }
                          >
                            <Rocket className="w-3 h-3" />
                            {circuitBreakerTripped ? 'Breaker Locked' : 'Dispatch A2A'}
                          </button>
                        )}
                      {isLiveConnected &&
                        tickets.length === 0 &&
                        onQuickCreateTriage && (
                          <button
                            type="button"
                            onClick={onQuickCreateTriage}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-[10px] text-white font-bold transition cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            Add Triage Idea
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              </div>

              {/* $ tail -f a2a-agents.log Live Terminal Card */}
              <div className="rounded-2xl border border-slate-800 bg-[#07090d] p-4 flex flex-col gap-2 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-[11px] text-slate-400">
                  <span className="text-emerald-400 flex items-center gap-1.5 font-bold">
                    <Terminal className="w-3.5 h-3.5" /> $ tail -f a2a-agents.log
                  </span>
                  <div className="flex items-center gap-2">
                    {logSearchQuery.trim() && (
                      <button
                        type="button"
                        onClick={() => setLogSearchQuery('')}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-purple-950/70 text-purple-300 border border-purple-700/60 hover:text-white transition cursor-pointer"
                        title="Clear radial node filter"
                      >
                        <span>{logSearchQuery.trim()}</span>
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFollowTail((prev) => !prev)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border transition cursor-pointer ${
                        followTail
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/70'
                          : 'bg-slate-900 text-slate-500 border-slate-800'
                      }`}
                    >
                      {followTail ? '● follow' : '○ paused'}
                    </button>
                    <span className="text-slate-500">{stats.lineCount} lines</span>
                  </div>
                </div>

                <div
                  ref={tailContainerRef}
                  className="flex-1 flex flex-col gap-1.5 text-[11px] pt-1 max-h-[235px] overflow-y-auto pr-1"
                >
                  {activeEvents.length === 0 ? (
                    <div className="text-slate-500 py-4">
                      23:00:00 [INIT] Mounting git worktrees &amp; polling /.well-known/agent.json...
                    </div>
                  ) : displayedA2ALogs.length === 0 ? (
                    <div className="text-slate-500 py-4">
                      No matching tail lines for filter “{logSearchQuery}”.
                    </div>
                  ) : (
                    [...displayedA2ALogs]
                      .reverse()
                      .slice(-8)
                      .map((evt) => (
                      <div
                        key={evt.id}
                        onClick={() => handleInspectTicketCode(evt.ticketCode)}
                        className="flex items-start gap-2 leading-relaxed hover:bg-slate-900/60 rounded px-1 py-0.5 cursor-pointer transition"
                      >
                        <span className="text-slate-500 shrink-0">
                          {evt.time.substring(0, 5)}
                        </span>
                        <span
                          className={`font-bold shrink-0 ${
                            evt.action === 'MERGE'
                              ? 'text-emerald-400'
                              : evt.action === 'BLOCKED'
                                ? 'text-rose-400'
                                : evt.action === 'LOCK'
                                  ? 'text-amber-400'
                                  : 'text-cyan-400'
                          }`}
                        >
                          [{evt.action}]
                        </span>
                        <span className="text-white font-bold shrink-0">
                          ${evt.ticketCode}
                        </span>
                        <span className="text-slate-400 truncate">{evt.message}</span>
                      </div>
                    ))
                  )}

                  {/* Dynamic Live Cursor Status Line */}
                  <div className="flex items-center gap-1.5 text-emerald-400 pt-1">
                    <span>
                      {clockString.slice(0, 5)}{' '}
                      {isLiveConnected
                        ? `WATCHING ${project.slug} · ${agentProfiles.filter((p) => p.a2a_connected).length} A2A cards online`
                        : simStep >= 480
                          ? `RECONCILED ${stats.merged} PRs merged on ${project.slug} · 0 conflicts`
                          : `STREAMING ${latestEvent ? `$${latestEvent.ticketCode}` : 'night queue'} · ${stats.burnTokPerMin.toLocaleString()} tok/m`}
                    </span>
                    <span className="w-2 h-3.5 bg-emerald-400 animate-pulse inline-block" />
                  </div>
                </div>
              </div>
            </div>

            {/* 3. OVERNIGHT SPRINT PROGRESS (START vs NOW) */}
            <div className="rounded-2xl border border-slate-800 bg-[#0d1017] p-4 flex flex-col gap-3 font-mono">
              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/70 pb-2">
                <span>OVERNIGHT SPRINT PROGRESS · start vs now</span>
                <span className="text-slate-500">
                  {isLiveConnected ? `Project: ${project.slug}` : `23:00 → ${clockString.slice(0, 5)}`}
                </span>
              </div>

              {/* Start Bar */}
              <div className="flex items-center justify-between text-xs gap-4">
                <span className="text-slate-500 w-14 shrink-0">START</span>
                <div className="flex-1 h-2 rounded-full bg-slate-900 border border-slate-800 relative flex items-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                </div>
                <span className="text-slate-400 font-bold w-36 text-right shrink-0">
                  0 PRs · 0 tok
                </span>
              </div>

              {/* Now Bar */}
              <div className="flex items-center justify-between text-xs gap-4">
                <span className="text-cyan-300 font-bold w-14 shrink-0">NOW</span>
                <div className="flex-1 h-2.5 rounded-full bg-slate-900 border border-cyan-800/80 overflow-hidden p-0.5 relative">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 shadow-sm shadow-cyan-400/50 transition-all duration-300"
                    style={{
                      width: `${
                        isLiveConnected
                          ? Math.min(
                              100,
                              Math.max(
                                6,
                                tickets.length > 0
                                  ? (stats.merged / tickets.length) * 100
                                  : 8,
                              ),
                            )
                          : Math.min(100, Math.max(4, (simStep / 480) * 100))
                      }%`,
                    }}
                  />
                </div>
                <span className="text-emerald-400 font-extrabold w-36 text-right shrink-0">
                  {stats.merged} PRs · {(stats.tokens / 1000).toFixed(0)}k tok
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-800/60">
                <span className="text-emerald-400 font-bold">
                  {stats.merged} PRs merged <span className="text-slate-600">·</span>{' '}
                  +{stats.locAdded.toLocaleString()} LOC{' '}
                  <span className="text-slate-600">·</span> {stats.blocked} quarantined{' '}
                  <span className="text-slate-600">·</span> 0 merge conflicts
                </span>
                <span>
                  {project.name} ({project.slug}) reconciled · 100% test gate enforced
                </span>
              </div>
            </div>

            {/* 4. BOTTOM LOG: A2A AGENT LOGS STREAM WITH SEARCH & JSON-RPC TRACE EXPANDER */}
            <div className="rounded-2xl border border-slate-800 bg-[#0d1017] p-4 flex flex-col gap-3 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 pb-2.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-xs text-white font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400" />
                    A2A AGENT LOGS STREAM
                  </span>
                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    click any entry to inspect A2A JSON-RPC / MCP trace &amp; files touched
                  </span>
                </div>

                {/* Keyword Search Input */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    placeholder="Filter ticket, tool, SHA... (/)"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 focus:border-cyan-500/70 focus:outline-none pl-8 pr-7 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
                  />
                  {logSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setLogSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
                      title="Clear search"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Action + Agent Filter Bars */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Agent Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto text-[10px]">
                  <span className="text-slate-500 uppercase mr-0.5">Worker:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedAgentId('all')}
                    className={`px-2 py-0.5 rounded-md border transition cursor-pointer shrink-0 ${
                      selectedAgentId === 'all'
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    All ({activeEvents.length})
                  </button>
                  {agentRoster
                    .filter((a) => a.id !== 'user')
                    .map((ag) => (
                      <button
                        key={ag.id}
                        type="button"
                        onClick={() =>
                          setSelectedAgentId(selectedAgentId === ag.id ? 'all' : ag.id)
                        }
                        className={`px-2 py-0.5 rounded-md border transition cursor-pointer shrink-0 ${
                          selectedAgentId === ag.id
                            ? 'bg-indigo-950 text-indigo-300 border-indigo-600 font-bold'
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {ag.shortName} ({ag.eventsCount})
                      </button>
                    ))}
                </div>

                {/* Action Filter Pills */}
                <div className="flex items-center gap-1 flex-wrap text-[10px]">
                  {(
                    [
                      'ALL',
                      'MERGE',
                      'REVIEW',
                      'DISPATCH',
                      'WORKTREE',
                      'LOCK',
                      'TEST',
                      'BLOCKED',
                    ] as const
                  ).map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setLogFilterAction(act)}
                      className={`px-2 py-0.5 rounded-md border transition cursor-pointer ${
                        logFilterAction === act
                          ? 'bg-slate-700 text-white border-slate-500 font-bold'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live A2A Stream Rows with Expandable Trace Drawer */}
              <div className="flex flex-col divide-y divide-slate-800/60 max-h-[400px] overflow-y-auto pr-1">
                {displayedA2ALogs.length === 0 ? (
                  <div className="py-8 text-center flex flex-col items-center gap-2 text-xs text-slate-500">
                    <span>No A2A log events match the active filters at {clockString}.</span>
                    {(selectedAgentId !== 'all' ||
                      logFilterAction !== 'ALL' ||
                      logSearchQuery) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAgentId('all')
                          setLogFilterAction('ALL')
                          setLogSearchQuery('')
                        }}
                        className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[11px] cursor-pointer"
                      >
                        Reset log filters
                      </button>
                    )}
                  </div>
                ) : (
                  displayedA2ALogs.map((evt) => {
                    const isExpanded = expandedLogId === evt.id
                    return (
                      <div key={evt.id} className="flex flex-col">
                        <div
                          onClick={() =>
                            setExpandedLogId(isExpanded ? null : evt.id)
                          }
                          className={`py-2.5 px-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 text-xs rounded-lg transition cursor-pointer ${
                            isExpanded
                              ? 'bg-slate-900/90'
                              : 'hover:bg-slate-900/45'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-[215px] shrink-0">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            )}
                            <span className="text-slate-500 text-[11px]">
                              {evt.time}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                                evt.action === 'MERGE'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : evt.action === 'REVIEW'
                                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                                    : evt.action === 'DISPATCH' || evt.action === 'WORKTREE'
                                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                      : evt.action === 'LOCK' || evt.action === 'TEST'
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              }`}
                            >
                              {evt.action}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleInspectTicketCode(evt.ticketCode)
                              }}
                              className="font-bold text-white hover:text-cyan-300 tracking-wide cursor-pointer"
                              title={`Inspect $${evt.ticketCode}`}
                            >
                              ${evt.ticketCode}
                            </button>
                          </div>

                          <div className="flex-1 text-[11px] text-slate-300 truncate">
                            <span className="text-slate-500">
                              [{evt.agentName.split(' ')[0]}]:
                            </span>{' '}
                            <span>{evt.message}</span>
                            {evt.toolCall && (
                              <span className="text-slate-500 ml-2 text-[10px]">
                                ({evt.toolCall})
                              </span>
                            )}
                          </div>

                          <div className="text-right shrink-0 text-[11px]">
                            {evt.locAdded > 0 && (
                              <span className="text-emerald-400 font-bold mr-2">
                                +{evt.locAdded} LOC
                              </span>
                            )}
                            <span className="text-cyan-400/90 font-medium">
                              {(evt.tokenCost / 1000).toFixed(1)}k tok
                            </span>
                          </div>
                        </div>

                        {/* Expandable A2A / MCP Trace Inspector Drawer */}
                        {isExpanded && (
                          <div className="mx-2 mb-2.5 p-3 rounded-xl bg-slate-950/95 border border-slate-800 text-[11px] flex flex-col gap-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white">
                                  ${evt.ticketCode} · {evt.ticketTitle}
                                </span>
                                {evt.commitSha && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/70 text-[10px]">
                                    <GitCommit className="w-3 h-3" />
                                    {evt.commitSha}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400">
                                {evt.jsonRpcMethod || 'mcp/tools/call'}
                                {evt.durationSec ? ` · ${evt.durationSec}s` : ''}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
                              <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                                <div className="text-slate-500 uppercase">Tool Invocation</div>
                                <div className="text-cyan-300 break-all mt-0.5">
                                  {evt.toolCall || 'a2a.tasks.sendSubscribe()'}
                                </div>
                              </div>
                              <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                                <div className="text-slate-500 uppercase">
                                  Branch &amp; Worktree
                                </div>
                                <div className="text-slate-200 truncate mt-0.5">
                                  {evt.branch || 'main'} ·{' '}
                                  {evt.worktreePath || '/workspaces/worktrees'}
                                </div>
                              </div>
                              <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                                <div className="text-slate-500 uppercase">Token Breakdown</div>
                                <div className="text-slate-200 mt-0.5">
                                  Prompt {(evt.tokenCost * 0.58 / 1000).toFixed(1)}k · Think{' '}
                                  {(evt.tokenCost * 0.27 / 1000).toFixed(1)}k · Out{' '}
                                  {(evt.tokenCost * 0.15 / 1000).toFixed(1)}k
                                </div>
                              </div>
                            </div>

                            {evt.filesTouched && evt.filesTouched.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                <span className="text-slate-500 flex items-center gap-1">
                                  <FileCode className="w-3 h-3 text-indigo-400" /> Files:
                                </span>
                                {evt.filesTouched.map((f) => (
                                  <span
                                    key={f}
                                    className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                                  >
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
