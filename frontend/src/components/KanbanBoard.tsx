import React, { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  GitBranch,
  GitPullRequest,
  HelpCircle,
  Layers,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  User,
} from 'lucide-react'
import type { Section, Ticket, TicketStatus } from '../types'

export interface SendItAnimationState {
  ticket: Ticket
  fromStatus: TicketStatus
  toStatus: TicketStatus
  owner: string
  phase: 'launching' | 'landing'
}

interface KanbanBoardProps {
  tickets: Ticket[]
  sections: Section[]
  onSelectTicket: (ticket: Ticket) => void
  onQuickCreateTriage: () => void
  onQuickClaim: (ticket: Ticket) => void
  sendItAnimation?: SendItAnimationState | null
}

const COLUMNS: Array<{
  status: TicketStatus
  label: string
  accent: string
  badgeBg: string
}> = [
  {
    status: 'triage',
    label: 'Triage & Grill',
    accent: 'border-purple-500/50',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  },
  {
    status: 'todo',
    label: 'Todo',
    accent: 'border-sky-500/50',
    badgeBg: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  },
  {
    status: 'in-progress',
    label: 'In Progress',
    accent: 'border-amber-500/50',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
  {
    status: 'review',
    label: 'Review',
    accent: 'border-indigo-500/50',
    badgeBg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  },
  {
    status: 'blocked',
    label: 'Blocked',
    accent: 'border-rose-500/50',
    badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  },
  {
    status: 'done',
    label: 'Done',
    accent: 'border-emerald-500/50',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
]

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tickets,
  sections,
  onSelectTicket,
  onQuickCreateTriage,
  onQuickClaim,
  sendItAnimation,
}) => {
  const [selectedSection, setSelectedSection] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [onlyClaimable, setOnlyClaimable] = useState<boolean>(false)
  const [viewMode, setViewMode] = useState<'columns' | 'sections'>('columns')

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (selectedSection !== 'all' && t.section_code !== selectedSection) {
        return false
      }
      if (onlyClaimable && !(t.status === 'todo' && t.dependencies_satisfied)) {
        return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const hay = `${t.code} ${t.title} ${t.owner || ''} ${t.files_md} ${t.do_md} ${t.branch_name}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tickets, selectedSection, onlyClaimable, searchQuery])

  const activeSectionObj = useMemo(
    () => sections.find((s) => s.code === selectedSection),
    [sections, selectedSection],
  )

  const renderCard = (t: Ticket, animMode?: 'launching' | 'landing') => {
    const noteCount = t.notes ? t.notes.length : t.note_count || 0
    const hasHandoff = t.notes?.some((n) => n.kind === 'handoff')
    const hasQuestions = t.triage_state === 'needs-info'
    const hasProposals = (t.proposals?.filter((p) => p.status === 'pending').length || 0) > 0
    const isLaunching = animMode === 'launching'
    const isLanding = animMode === 'landing'

    return (
      <div
        key={`${t.id}-${animMode || 'normal'}`}
        onClick={() => onSelectTicket(t)}
        className={`group relative rounded-xl border p-3.5 shadow-sm transition-all cursor-pointer flex flex-col gap-2.5 ${
          isLaunching
            ? 'send-it-launching border-amber-400 bg-slate-900 ring-2 ring-cyan-400/80'
            : isLanding
              ? 'send-it-landing border-emerald-400 bg-slate-900 ring-2 ring-amber-400/70'
              : t.is_held
                ? 'border-dashed border-amber-500/40 bg-amber-950/15 opacity-80 hover:border-amber-500/70 hover:opacity-100 hover:bg-slate-900'
                : 'border-slate-800 bg-slate-900/90 hover:border-indigo-500/50 hover:bg-slate-900'
        }`}
      >
        {/* "SEND IT!" Launching Overlay Stamp */}
        {isLaunching && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-xl bg-slate-950/75 backdrop-blur-[2px] p-2">
            <div className="send-it-stamp px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-cyan-400 text-slate-950 font-black text-base tracking-widest uppercase shadow-xl border-2 border-white flex items-center gap-1.5">
              <span>🚀 SEND IT!</span>
            </div>
            <div className="mt-1.5 text-[10px] font-mono font-bold text-cyan-200 uppercase tracking-wider bg-slate-900/90 px-2 py-0.5 rounded border border-cyan-500/40">
              {sendItAnimation?.owner || t.owner} → {sendItAnimation?.toStatus.toUpperCase()}
            </div>
          </div>
        )}

        {/* "SENT IT!" Landing Banner */}
        {isLanding && (
          <div className="flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/25 via-emerald-500/25 to-cyan-500/25 border border-amber-400/50 text-[10px] font-mono font-bold text-amber-200">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-300" />
              🚀 SENT IT!
            </span>
            <span className="text-emerald-300 truncate">
              {sendItAnimation?.owner || t.owner}
            </span>
          </div>
        )}
        {/* Top Row: Code + Section + Triage/Dependency Badges */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
              {t.code}
            </span>
            {t.section_code && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400">
                Sec {t.section_code}
              </span>
            )}
            {t.is_held && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Pause className="w-2.5 h-2.5 text-amber-400" />
                HOLD
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {t.status === 'triage' && (
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                  hasQuestions
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                    : hasProposals
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                }`}
              >
                {t.triage_state}
              </span>
            )}
            {hasHandoff && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Handoff Ready
              </span>
            )}
          </div>
        </div>

        {/* Title */}
        <h4 className="text-sm font-semibold text-slate-100 group-hover:text-indigo-200 leading-snug">
          {t.title}
        </h4>

        {/* Snippet of Do / Files */}
        {t.do_md && (
          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
            {t.do_md}
          </p>
        )}

        {/* Dependencies */}
        {t.depends_on.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Deps:</span>
            {t.depends_on.map((dep) => {
              const st = t.dependency_statuses[dep] || 'unknown'
              const ok = st === 'done' || st === 'review'
              return (
                <span
                  key={dep}
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                    ok
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                      : 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                  }`}
                  title={`Dependency ${dep}: ${st}`}
                >
                  {dep} ({st})
                </span>
              )
            })}
          </div>
        )}

        {/* Git Branch / PR Metadata */}
        {(t.branch_name || t.pr_url) && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 pt-0.5">
            {t.branch_name && (
              <span className="inline-flex items-center gap-1 font-mono bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800 truncate max-w-[190px]">
                <GitBranch className="w-3 h-3 text-indigo-400 shrink-0" />
                {t.branch_name}
              </span>
            )}
            {t.pr_url && (
              <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/50">
                <GitPullRequest className="w-3 h-3" />
                PR
              </span>
            )}
          </div>
        )}

        {/* Footer: Owner + Note count + Quick Claim */}
        <div className="flex items-center justify-between pt-2 mt-auto border-t border-slate-800/80 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 truncate">
            {t.owner ? (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950/70 text-indigo-300 border border-indigo-800/60 font-mono text-[11px] truncate max-w-[130px]">
                  <User className="w-3 h-3 shrink-0" />
                  <span className="truncate">{t.owner}</span>
                </span>
                {(t.status === 'in-progress' || t.status === 'review') && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-700/50 font-mono text-[9px] shrink-0"
                    title="Connected via A2A v0.2.1 · SSE Stream (tasks/sendSubscribe)"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    A2A·SSE
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500 text-[11px]">Unclaimed</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {noteCount > 0 && (
              <span className="inline-flex items-center gap-1 text-slate-400 text-[11px]">
                <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                {noteCount}
              </span>
            )}
            {t.is_held ? (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/70 text-amber-300/90 border border-amber-800/60"
                title="Ticket is on hold. Open ticket to resume."
              >
                <Pause className="w-2.5 h-2.5 text-amber-400" />
                On Hold
              </span>
            ) : (
              ((t.status === 'todo' && t.dependencies_satisfied) ||
                t.status === 'triage' ||
                t.status === 'review' ||
                t.status === 'blocked') && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onQuickClaim(t)
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    t.status === 'blocked'
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                      : 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30'
                  }`}
                  title={
                    t.status === 'blocked'
                      ? 'Handover & resume blocked story with an agent'
                      : 'Scan & assign available A2A agent to this ticket'
                  }
                >
                  <Play className="w-2.5 h-2.5" />
                  {t.status === 'review'
                    ? 'Review (A2A)'
                    : t.status === 'blocked'
                      ? 'Handover'
                      : 'Claim'}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/70 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedSection('all')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
              selectedSection === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            All Sections ({tickets.length})
          </button>
          {sections.map((s) => {
            const count = tickets.filter((t) => t.section_code === s.code).length
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSection(s.code)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                  selectedSection === s.code
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {s.title.split('(')[0].trim()} ({count})
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none bg-slate-800/70 px-2.5 py-1.5 rounded-lg border border-slate-700/70">
            <input
              type="checkbox"
              checked={onlyClaimable}
              onChange={(e) => setOnlyClaimable(e.target.checked)}
              className="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500"
            />
            Ready to Claim Only
          </label>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter ID, title, owner, branch..."
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
            />
          </div>

          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('columns')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'columns' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Kanban Columns
            </button>
            <button
              type="button"
              onClick={() => setViewMode('sections')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'sections' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              By Section
            </button>
          </div>
        </div>
      </div>

      {/* Section Background Banner when a specific section with notes is selected */}
      {activeSectionObj && activeSectionObj.description_md && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3.5 text-xs text-slate-300">
          <div className="font-semibold text-indigo-300 mb-1 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            {activeSectionObj.title} — Section Notes & Hardware Constraints
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto">
            {activeSectionObj.description_md}
          </pre>
        </div>
      )}

      {/* Kanban Columns View */}
      {viewMode === 'columns' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5 items-start">
          {COLUMNS.map((col) => {
            let colTickets = filteredTickets.filter((t) => t.status === col.status)

            // If a ticket is currently in the "launching" phase of SEND IT!,
            // render it launching out of `fromStatus` and hold it from `toStatus` until landing!
            const isLaunchingFromHere =
              sendItAnimation &&
              sendItAnimation.phase === 'launching' &&
              sendItAnimation.fromStatus === col.status &&
              sendItAnimation.fromStatus !== sendItAnimation.toStatus

            const isLaunchingIntoHere =
              sendItAnimation &&
              sendItAnimation.phase === 'launching' &&
              sendItAnimation.toStatus === col.status &&
              sendItAnimation.fromStatus !== sendItAnimation.toStatus

            if (isLaunchingIntoHere && sendItAnimation) {
              colTickets = colTickets.filter(
                (t) => t.code.toUpperCase() !== sendItAnimation.ticket.code.toUpperCase(),
              )
            }

            if (
              isLaunchingFromHere &&
              sendItAnimation &&
              !colTickets.some(
                (t) => t.code.toUpperCase() === sendItAnimation.ticket.code.toUpperCase(),
              )
            ) {
              colTickets = [sendItAnimation.ticket, ...colTickets]
            }

            return (
              <div
                key={col.status}
                className={`rounded-xl border bg-slate-900/40 ${col.accent} flex flex-col max-h-[calc(100vh-230px)] overflow-visible`}
              >
                <div className="p-3 border-b border-slate-800/80 flex items-center justify-between sticky top-0 bg-slate-900/95 rounded-t-xl z-10">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${col.badgeBg}`}>
                      {col.label}
                    </span>
                    <span className="text-xs font-mono text-slate-400">{colTickets.length}</span>
                  </div>
                  {col.status === 'triage' && (
                    <button
                      type="button"
                      onClick={onQuickCreateTriage}
                      className="p-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 transition"
                      title="Add new Triage Idea"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="p-2.5 flex flex-col gap-2.5 overflow-y-auto overflow-x-visible">
                  {colTickets.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-600">
                      No tickets in {col.label}
                    </div>
                  ) : (
                    colTickets.map((t) => {
                      const matchesSendIt =
                        sendItAnimation &&
                        t.code.toUpperCase() === sendItAnimation.ticket.code.toUpperCase()
                      const mode = matchesSendIt ? sendItAnimation.phase : undefined
                      return renderCard(t, mode)
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* Section-grouped View */
        <div className="flex flex-col gap-6">
          {sections.map((sec) => {
            const secTickets = filteredTickets.filter((t) => t.section_code === sec.code)
            if (secTickets.length === 0) return null
            return (
              <div
                key={sec.id}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">{sec.title}</h3>
                    {sec.description_md && (
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-slate-400 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                        {sec.description_md}
                      </pre>
                    )}
                  </div>
                  <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">
                    {secTickets.length} tasks
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {secTickets.map((t) => renderCard(t))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
