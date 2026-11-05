import React, { useState } from 'react'
import {
  AlertTriangle,
  BatteryWarning,
  Cpu,
  Lock,
  Plus,
  RefreshCw,
  Unlock,
  Users,
} from 'lucide-react'
import { api } from '../api'
import type { AgentInfo, FeatureLock } from '../types'

interface LocksAndAgentsProps {
  projectSlug: string
  locks: FeatureLock[]
  agents: AgentInfo[]
  onRefresh: () => void
}

export const LocksAndAgents: React.FC<LocksAndAgentsProps> = ({
  projectSlug,
  locks,
  agents,
  onRefresh,
}) => {
  // Lock creation state
  const [newLockName, setNewLockName] = useState('')
  const [newLockSlots, setNewLockSlots] = useState(1)
  const [newLockDesc, setNewLockDesc] = useState('')

  // Acquire lock modal/inline state
  const [acquiringLock, setAcquiringLock] = useState<string | null>(null)
  const [acqAgent, setAcqAgent] = useState('agent-1')
  const [acqReason, setAcqReason] = useState('Integration test / benchmark execution')
  const [acqMinutes, setAcqMinutes] = useState(30)
  const [acqTicket, setAcqTicket] = useState('')

  // Usage Exhaustion Handoff form
  const [exhaustAgent, setExhaustAgent] = useState('')
  const [exhaustReset, setExhaustReset] = useState('2026-10-27T04:00:00Z')
  const [exhaustSummary, setExhaustSummary] = useState('')
  const [exhaustBranch, setExhaustBranch] = useState('')
  const [exhaustWorktree, setExhaustWorktree] = useState('')
  const [exhaustRelease, setExhaustRelease] = useState(true)

  const handleCreateLock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLockName.trim()) return
    await api.createOrUpdateLock({
      name: newLockName.trim(),
      project_slug: projectSlug,
      max_slots: Number(newLockSlots) || 1,
      description: newLockDesc.trim(),
    })
    setNewLockName('')
    setNewLockDesc('')
    onRefresh()
  }

  const handleAcquire = async (lockName: string) => {
    if (!acqAgent.trim()) return
    await api.acquireLock(lockName, {
      agent_id: acqAgent.trim(),
      reason: acqReason.trim(),
      expected_minutes: Number(acqMinutes) || 30,
      ticket_code: acqTicket.trim(),
      enqueue_if_busy: true,
    })
    setAcquiringLock(null)
    onRefresh()
  }

  const handleRelease = async (lockName: string, agentId: string) => {
    await api.releaseLock(lockName, agentId)
    onRefresh()
  }

  const handleHeartbeat = async (lockName: string, agentId: string) => {
    await api.heartbeatLock(lockName, agentId, 15)
    onRefresh()
  }

  const handleReportUsageExhausted = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!exhaustAgent.trim() || !exhaustSummary.trim()) return
    await api.reportUsageExhausted({
      project_slug: projectSlug,
      agent_id: exhaustAgent.trim(),
      usage_reset_at: exhaustReset.trim() || undefined,
      handoff_summary_md: exhaustSummary.trim(),
      release_ticket: exhaustRelease,
      branch_name: exhaustBranch.trim() || undefined,
      worktree_path: exhaustWorktree.trim() || undefined,
    })
    setExhaustSummary('')
    onRefresh()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Left Column: Flexible Feature & GPU Locks */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">
              Flexible Feature & GPU Locks ({locks.length})
            </h3>
          </div>
        </div>

        {/* Locks Cards */}
        <div className="flex flex-col gap-3">
          {locks.map((lk) => {
            const isFree = lk.available_slots > 0
            return (
              <div
                key={lk.id}
                className={`rounded-2xl border p-4 flex flex-col gap-3 ${
                  isFree
                    ? 'border-emerald-500/30 bg-slate-900/75'
                    : 'border-amber-500/40 bg-amber-950/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                      {lk.name}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                        isFree
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      {isFree
                        ? `FREE (${lk.available_slots}/${lk.max_slots} slots)`
                        : `HELD (${lk.active_claims.length}/${lk.max_slots})`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setAcquiringLock(acquiringLock === lk.name ? null : lk.name)
                    }
                    className="px-3 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-xs font-semibold text-white transition cursor-pointer"
                  >
                    {isFree ? 'Claim Lock' : 'Join Wait Queue'}
                  </button>
                </div>

                {lk.description && (
                  <p className="text-xs text-slate-400">{lk.description}</p>
                )}

                {/* Active Claims */}
                {lk.active_claims.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                      Active Holders:
                    </span>
                    {lk.active_claims.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-xl border border-amber-500/30 bg-slate-950/90 p-3 text-xs flex items-center justify-between gap-3 flex-wrap"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-amber-300">
                              {c.agent_id}
                            </span>
                            {c.ticket_code && (
                              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300">
                                Ticket: {c.ticket_code}
                              </span>
                            )}
                          </div>
                          <span className="text-slate-300">{c.reason}</span>
                          <span className="text-[11px] font-mono text-slate-500">
                            Expires: {c.expires_at.replace('T', ' ').slice(0, 19)} UTC
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleHeartbeat(lk.name, c.agent_id)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] cursor-pointer"
                          >
                            +15m TTL
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRelease(lk.name, c.agent_id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-[11px] font-medium cursor-pointer"
                          >
                            <Unlock className="w-3 h-3" />
                            Release
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Wait Queue */}
                {lk.wait_queue.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                      FIFO Wait Queue ({lk.wait_queue.length}):
                    </span>
                    {lk.wait_queue.map((q, idx) => (
                      <div
                        key={q.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs flex items-center justify-between"
                      >
                        <div>
                          <span className="font-mono text-sky-300 font-bold mr-2">
                            #{idx + 1} {q.agent_id}
                          </span>
                          <span className="text-slate-400">({q.reason})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRelease(lk.name, q.agent_id)}
                          className="text-[11px] text-rose-400 hover:text-rose-300"
                        >
                          Leave Queue
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Inline Acquire / Queue Form */}
                {acquiringLock === lk.name && (
                  <div className="rounded-xl border border-indigo-500/40 bg-slate-950 p-3 flex flex-col gap-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={acqAgent}
                        onChange={(e) => setAcqAgent(e.target.value)}
                        placeholder="Agent ID (e.g. bg-200fdbe0)"
                        className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                      />
                      <input
                        type="text"
                        value={acqTicket}
                        onChange={(e) => setAcqTicket(e.target.value)}
                        placeholder="Ticket Code (e.g. Q1)"
                        className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                      />
                      <input
                        type="number"
                        value={acqMinutes}
                        onChange={(e) => setAcqMinutes(Number(e.target.value))}
                        placeholder="TTL Minutes"
                        className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                      />
                    </div>
                    <input
                      type="text"
                      value={acqReason}
                      onChange={(e) => setAcqReason(e.target.value)}
                      placeholder="Reason (e.g. test suite or benchmark run)"
                      className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleAcquire(lk.name)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
                      >
                        Confirm Claim / Queue
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Create New Feature Lock / Semaphore */}
        <form
          onSubmit={handleCreateLock}
          className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 flex flex-col gap-3"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            + Create Custom Feature Lock or Multi-Slot Semaphore
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={newLockName}
              onChange={(e) => setNewLockName(e.target.value)}
              placeholder="Name (e.g. gpu:chopper, rpc:abi)"
              className="sm:col-span-2 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
            <input
              type="number"
              min={1}
              value={newLockSlots}
              onChange={(e) => setNewLockSlots(Number(e.target.value))}
              placeholder="Max Slots (1 = mutex)"
              className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
          </div>
          <input
            type="text"
            value={newLockDesc}
            onChange={(e) => setNewLockDesc(e.target.value)}
            placeholder="Description (when agents must acquire this lock)..."
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
          />
          <button
            type="submit"
            className="self-end px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
          >
            Add Feature Lock
          </button>
        </form>
      </div>

      {/* Right Column: Agent Registry & Usage/Quota Exhaustion Handoff */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base font-bold text-white">
            Agent Fleet & Usage Quota Status ({agents.length})
          </h3>
        </div>

        {/* Agent Usage Exhaustion Handoff Card */}
        <form
          onSubmit={handleReportUsageExhausted}
          className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <BatteryWarning className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Agent Usage / Quota Exhaustion Handoff
            </h4>
          </div>
          <p className="text-xs text-slate-400">
            When an agent runs out of usage, it calls <code className="text-slate-200">report_agent_usage_exhausted</code> (or you can trigger it here) to release all held GPU locks, attach a branch/worktree handoff note to its ticket, and return the ticket to TODO for another agent.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={exhaustAgent}
              onChange={(e) => setExhaustAgent(e.target.value)}
              placeholder="Agent ID (e.g. bg-200fdbe0)"
              className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
            <input
              type="text"
              value={exhaustReset}
              onChange={(e) => setExhaustReset(e.target.value)}
              placeholder="Quota Reset Time (ISO or HH:MM)"
              className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
            <input
              type="text"
              value={exhaustBranch}
              onChange={(e) => setExhaustBranch(e.target.value)}
              placeholder="Branch (optional, e.g. board/r3-span)"
              className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
            <input
              type="text"
              value={exhaustWorktree}
              onChange={(e) => setExhaustWorktree(e.target.value)}
              placeholder="Worktree path (optional)"
              className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
          </div>
          <textarea
            rows={2}
            value={exhaustSummary}
            onChange={(e) => setExhaustSummary(e.target.value)}
            placeholder="Handoff summary: what is committed, what tests pass, and what the next agent needs to finish..."
            className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
          />
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={exhaustRelease}
                onChange={(e) => setExhaustRelease(e.target.checked)}
              />
              Return active ticket to TODO so another agent can claim it
            </label>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white cursor-pointer"
            >
              Trigger Usage Handoff
            </button>
          </div>
        </form>

        {/* Agent List */}
        <div className="flex flex-col gap-2.5">
          {agents.map((ag) => (
            <div
              key={ag.id}
              className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 text-xs flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-indigo-300">{ag.id}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      ag.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : ag.status === 'out-of-usage'
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {ag.status}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  Last seen: {ag.last_seen_at.slice(0, 16).replace('T', ' ')}
                </span>
              </div>

              <div className="flex items-center gap-3 flex-wrap text-slate-300">
                {ag.current_ticket_code && (
                  <span>
                    Active Ticket:{' '}
                    <strong className="font-mono text-white">{ag.current_ticket_code}</strong>
                  </span>
                )}
                {ag.branch_name && (
                  <span>
                    Branch: <code className="text-indigo-300">{ag.branch_name}</code>
                  </span>
                )}
                {ag.held_locks.length > 0 && (
                  <span>
                    Locks:{' '}
                    {ag.held_locks.map((l) => (
                      <code
                        key={l}
                        className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300"
                      >
                        {l}
                      </code>
                    ))}
                  </span>
                )}
              </div>

              {ag.status === 'out-of-usage' && (
                <div className="mt-1 rounded-lg bg-rose-950/30 border border-rose-800/50 p-2 text-rose-200">
                  <div>
                    <strong>Quota Reset:</strong> {ag.usage_reset_at || 'unspecified'}
                  </div>
                  {ag.handoff_note && <div className="mt-0.5">{ag.handoff_note}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
