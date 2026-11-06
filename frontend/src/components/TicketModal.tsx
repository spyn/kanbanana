import React, { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  MessageSquarePlus,
  Mic,
  Pause,
  Play,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  X,
} from 'lucide-react'
import { api } from '../api'
import { GrillMeDrawer } from './GrillMeDrawer'
import type { NoteKind, Section, Ticket, TicketStatus } from '../types'

interface TicketModalProps {
  projectSlug: string
  ticket: Ticket
  sections: Section[]
  onClose: () => void
  onUpdated: (t: Ticket) => void
  onNavigateTicket: (code: string) => void
  onQuickClaim?: (ticket: Ticket) => void
}

const STATUS_OPTIONS: TicketStatus[] = [
  'triage',
  'todo',
  'in-progress',
  'review',
  'blocked',
  'done',
]

export const TicketModal: React.FC<TicketModalProps> = ({
  projectSlug,
  ticket,
  sections,
  onClose,
  onUpdated,
  onNavigateTicket,
  onQuickClaim,
}) => {
  const [status, setStatus] = useState<TicketStatus>(ticket.status)
  const [owner, setOwner] = useState<string>(ticket.owner || '')
  const [branchName, setBranchName] = useState<string>(ticket.branch_name || '')
  const [worktreePath, setWorktreePath] = useState<string>(ticket.worktree_path || '')
  const [prUrl, setPrUrl] = useState<string>(ticket.pr_url || '')
  const [commitSha, setCommitSha] = useState<string>(ticket.commit_sha || '')
  const [doMd, setDoMd] = useState<string>(ticket.do_md || '')
  const [doneWhenMd, setDoneWhenMd] = useState<string>(ticket.done_when_md || '')
  const [filesMd, setFilesMd] = useState<string>(ticket.files_md || '')
  const [editingSpec, setEditingSpec] = useState<boolean>(false)
  const [isHeld, setIsHeld] = useState<boolean>(ticket.is_held ?? false)
  const [togglingHold, setTogglingHold] = useState<boolean>(false)
  const [showGrillDrawer, setShowGrillDrawer] = useState<boolean>(false)

  const [noteAuthor, setNoteAuthor] = useState<string>('user')
  const [noteKind, setNoteKind] = useState<NoteKind>(
    ticket.status === 'triage' && ticket.triage_state === 'needs-info' ? 'answer' : 'note',
  )
  const [noteContent, setNoteContent] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  // Code & Security Review Skill state (for 'review' tickets)
  const [showReviewPanel, setShowReviewPanel] = useState<boolean>(ticket.status === 'review')
  const [reviewerId, setReviewerId] = useState<string>('reviewer-agent')
  const [reviewerModel, setReviewerModel] = useState<string>('claude-sonnet-4-5')
  const [codeIssuesText, setCodeIssuesText] = useState<string>('')
  const [securityIssuesText, setSecurityIssuesText] = useState<string>('')
  const [reviewSummaryMd, setReviewSummaryMd] = useState<string>('')
  const [mergeIfClean, setMergeIfClean] = useState<boolean>(true)
  const [prescanData, setPrescanData] = useState<{
    diff_stat: string
    code_warnings: string[]
    security_warnings: string[]
  } | null>(null)

  useEffect(() => {
    if (showReviewPanel) {
      api
        .inspectReviewTicket(projectSlug, ticket.code)
        .then((res) => {
          setPrescanData({
            diff_stat: res.diff_stat,
            code_warnings: res.static_prescan.code_warnings,
            security_warnings: res.static_prescan.security_warnings,
          })
        })
        .catch(() => {})
    }
  }, [showReviewPanel, projectSlug, ticket.code])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const parsedCodeIssues = codeIssuesText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const parsedSecurityIssues = securityIssuesText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const hasAnyReviewIssues = parsedCodeIssues.length > 0 || parsedSecurityIssues.length > 0

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const updated = await api.submitTicketReview(projectSlug, ticket.code, {
        reviewer_agent_id: reviewerId.trim() || 'reviewer-agent',
        reviewer_model: reviewerModel,
        verdict: hasAnyReviewIssues ? 'request-changes' : 'approve',
        code_issues: parsedCodeIssues,
        security_issues: parsedSecurityIssues,
        review_md:
          reviewSummaryMd.trim() ||
          (hasAnyReviewIssues
            ? 'Code/security issues identified during mid-tier model review.'
            : 'Checked against CODE_REVIEW_SKILL.md: 0 code issues, 0 security issues.'),
        commit_sha: commitSha || undefined,
        merge_if_clean: !hasAnyReviewIssues && mergeIfClean,
      })
      setStatus(updated.status)
      onUpdated(updated)
    } catch (e: any) {
      setError(e.message || 'Failed to submit review')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleHold = async () => {
    setTogglingHold(true)
    setError('')
    try {
      if (isHeld) {
        const updated = await api.resumeTicket(projectSlug, ticket.code)
        setIsHeld(false)
        onUpdated(updated)
      } else {
        const reason = window.prompt(`Reason for putting ${ticket.code} on hold (optional):`, '')
        const updated = await api.holdTicket(projectSlug, ticket.code, reason || '')
        setIsHeld(true)
        onUpdated(updated)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to update hold status')
    } finally {
      setTogglingHold(false)
    }
  }

  const handleSaveMeta = async () => {
    setSaving(true)
    setError('')
    try {
      const updated = await api.updateTicket(projectSlug, ticket.code, {
        status,
        owner: owner.trim() || '—',
        branch_name: branchName,
        worktree_path: worktreePath,
        pr_url: prUrl,
        commit_sha: commitSha,
        do_md: doMd,
        done_when_md: doneWhenMd,
        files_md: filesMd,
        is_held: isHeld,
      })
      onUpdated(updated)
      setEditingSpec(false)
    } catch (e: any) {
      setError(e.message || 'Failed to update ticket')
    } finally {
      setSaving(false)
    }
  }

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteContent.trim()) return
    setSaving(true)
    setError('')
    try {
      const updated = await api.addNote(projectSlug, ticket.code, {
        author: noteAuthor.trim() || 'user',
        kind: noteKind,
        content_md: noteContent,
      })
      setNoteContent('')
      onUpdated(updated)
    } catch (e: any) {
      setError(e.message || 'Failed to add note')
    } finally {
      setSaving(false)
    }
  }

  const handleApproveProposals = async () => {
    setSaving(true)
    setError('')
    try {
      const updated = await api.approveProposals(projectSlug, ticket.code)
      onUpdated(updated)
    } catch (e: any) {
      setError(e.message || 'Failed to approve proposals')
    } finally {
      setSaving(false)
    }
  }

  const kindBadge = (k: NoteKind) => {
    switch (k) {
      case 'review':
        return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
      case 'question':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      case 'answer':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      case 'handoff':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40'
      case 'system':
        return 'bg-slate-700/40 text-slate-300 border-slate-600'
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/60 px-6 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold px-2.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {ticket.code}
              </span>
              {ticket.section_title && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {ticket.section_title}
                </span>
              )}
              {ticket.status === 'triage' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Triage: {ticket.triage_state}
                </span>
              )}
              <span className="text-xs text-slate-500 font-mono">
                Updated: {ticket.updated_at?.slice(0, 10)}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white mt-1">{ticket.title}</h2>
          </div>

          <div className="flex items-center gap-2">
            {ticket.status === 'triage' && (
              <button
                type="button"
                onClick={() => setShowGrillDrawer(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/50 transition cursor-pointer shadow-sm shadow-violet-600/20"
                title="Open interactive technical alignment interview"
              >
                <Mic className="w-3.5 h-3.5 text-violet-400" />
                Grill Me
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleHold}
              disabled={togglingHold}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                isHeld
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 shadow-sm shadow-amber-500/30'
                  : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/40'
              }`}
              title={isHeld ? 'Resume ticket execution' : 'Put ticket on hold'}
            >
              {isHeld ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Resume Work
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Hold Ticket
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex flex-col gap-5">
          {error && (
            <div className="rounded-lg bg-rose-950/80 border border-rose-700 px-4 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {/* On Hold Callout Banner */}
          {isHeld && (
            <div className="rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-950/60 via-amber-900/30 to-slate-900/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md shadow-amber-950/30">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 mt-0.5">
                  <Pause className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-200">Ticket is Currently On Hold</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      is_held = true
                    </span>
                  </div>
                  <p className="text-xs text-amber-100/80 mt-0.5">
                    Autonomous agents cannot claim, pick, or auto-dispatch this ticket while it is on hold. Resume the ticket when ready to continue work.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleHold}
                disabled={togglingHold}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/20 transition cursor-pointer shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Resume Work
              </button>
            </div>
          )}

          {/* Blocked / Quota Handover Callout */}
          {ticket.status === 'blocked' && (
            <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-slate-900/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md shadow-amber-950/30">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-200">Story Blocked / Quota Handover</span>
                    {ticket.owner && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        Prior Agent: {ticket.owner}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-amber-100/80 mt-0.5 font-mono">
                    {ticket.blocked_reason || 'Quota/usage exhausted. Awaiting handover.'}
                  </p>
                </div>
              </div>
              {onQuickClaim && !isHeld && (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onQuickClaim(ticket)
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/20 transition cursor-pointer shrink-0"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Handover / Resume Story
                </button>
              )}
            </div>
          )}

          {/* Status, Owner & Git Worktree Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-950/70 border border-slate-800/90 rounded-xl p-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                Owner (Agent ID)
              </label>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="unclaimed (—)"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                Git Branch (`board/...`)
              </label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="board/q1-quantise-once"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                Worktree Path
              </label>
              <input
                type="text"
                value={worktreePath}
                onChange={(e) => setWorktreePath(e.target.value)}
                placeholder="/workspaces/worktrees/q1 or D:\code\worktrees\q1"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                PR URL
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={prUrl}
                  onChange={(e) => setPrUrl(e.target.value)}
                  placeholder="https://gitea.lan.spyn.dev/..."
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                />
                {prUrl && /^https?:\/\//i.test(prUrl.trim()) && (
                  <a
                    href={prUrl.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300"
                    title="Open PR"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                  Commit SHA
                </label>
                <input
                  type="text"
                  value={commitSha}
                  onChange={(e) => setCommitSha(e.target.value)}
                  placeholder="16b3958"
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveMeta}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>

          {/* Dependencies */}
          {ticket.depends_on.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap bg-slate-950/40 border border-slate-800/80 rounded-xl px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-400">Depends on:</span>
              {ticket.depends_on.map((dep) => {
                const st = ticket.dependency_statuses[dep] || 'unknown'
                const ok = st === 'done' || st === 'review'
                return (
                  <button
                    key={dep}
                    type="button"
                    onClick={() => onNavigateTicket(dep)}
                    className={`font-mono text-xs px-2.5 py-1 rounded-md border transition hover:scale-105 cursor-pointer ${
                      ok
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                        : 'bg-rose-950/60 text-rose-300 border-rose-700/60'
                    }`}
                  >
                    {dep} · {st}
                  </button>
                )
              })}
              <span className="ml-auto text-xs text-slate-400">
                {ticket.dependencies_satisfied
                  ? '✅ All dependencies satisfied'
                  : '⏳ Waiting on dependencies'}
              </span>
            </div>
          )}

          {/* Specification: Files, Do, Done when */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Task Specification
              </h3>
              <button
                type="button"
                onClick={() => setEditingSpec(!editingSpec)}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                {editingSpec ? 'Cancel Edit' : 'Edit Spec'}
              </button>
            </div>

            {editingSpec ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Files</label>
                  <input
                    type="text"
                    value={filesMd}
                    onChange={(e) => setFilesMd(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Do</label>
                  <textarea
                    rows={4}
                    value={doMd}
                    onChange={(e) => setDoMd(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Done when</label>
                  <textarea
                    rows={2}
                    value={doneWhenMd}
                    onChange={(e) => setDoneWhenMd(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveMeta}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                  >
                    Save Specification
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 text-xs">
                {ticket.files_md && (
                  <div>
                    <span className="font-semibold text-slate-400">Files: </span>
                    <span className="font-mono text-indigo-200">{ticket.files_md}</span>
                  </div>
                )}
                {ticket.do_md && (
                  <div>
                    <span className="font-semibold text-slate-400 block mb-1">Do:</span>
                    <div className="whitespace-pre-wrap text-slate-200 bg-slate-900/90 p-3 rounded-lg border border-slate-800/80 leading-relaxed">
                      {ticket.do_md}
                    </div>
                  </div>
                )}
                {ticket.done_when_md && (
                  <div>
                    <span className="font-semibold text-emerald-400 block mb-1">Done when:</span>
                    <div className="whitespace-pre-wrap text-slate-200 bg-emerald-950/20 p-3 rounded-lg border border-emerald-800/40 leading-relaxed">
                      {ticket.done_when_md}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Triage Sub-Ticket Proposals (if any) */}
          {ticket.proposals && ticket.proposals.length > 0 && (
            <div className="rounded-xl border border-purple-500/40 bg-purple-950/15 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-bold text-purple-200">
                    Proposed Breakdown Sub-Tickets ({ticket.proposals.length})
                  </h3>
                </div>
                {ticket.proposals.some((p) => p.status === 'pending') && (
                  <button
                    type="button"
                    onClick={handleApproveProposals}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve All & Promote to TODO
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2.5">
                {ticket.proposals.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/90 p-3 text-xs flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-300 bg-slate-800 px-2 py-0.5 rounded">
                          {p.code}
                        </span>
                        <span className="font-semibold text-white">{p.title}</span>
                        <span className="text-slate-400">(Sec {p.section_code})</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          p.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : p.status === 'rejected'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    {p.do_md && <p className="text-slate-300">{p.do_md}</p>}
                    {p.done_when_md && (
                      <p className="text-emerald-300/90">
                        <strong>Done when:</strong> {p.done_when_md}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Code & Security Review Skill (Mid-Tier Model + Merge Gate) */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {hasAnyReviewIssues ? (
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                )}
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  Code & Security Review Skill (`CODE_REVIEW_SKILL.md` · Mid-Tier Model Gate)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReviewPanel(!showReviewPanel)}
                className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 cursor-pointer"
              >
                {showReviewPanel ? 'Hide Review Gate' : 'Open Review & Merge Gate'}
              </button>
            </div>

            {showReviewPanel && (
              <form onSubmit={handleSubmitReview} className="flex flex-col gap-3 mt-1">
                {prescanData &&
                  (prescanData.code_warnings.length > 0 ||
                    prescanData.security_warnings.length > 0) && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs flex flex-col gap-1">
                      <span className="font-bold text-amber-300">
                        Automated Static Pre-Scan Warnings:
                      </span>
                      {prescanData.security_warnings.map((w, i) => (
                        <div key={`sec-${i}`} className="text-rose-300 font-mono">
                          🔒 {w}
                        </div>
                      ))}
                      {prescanData.code_warnings.map((w, i) => (
                        <div key={`code-${i}`} className="text-amber-200 font-mono">
                          ⚠️ {w}
                        </div>
                      ))}
                    </div>
                  )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                      Reviewer Agent ID
                    </label>
                    <input
                      type="text"
                      value={reviewerId}
                      onChange={(e) => setReviewerId(e.target.value)}
                      placeholder="reviewer-sonnet"
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                      Mid-Tier Reviewer Model
                    </label>
                    <select
                      value={reviewerModel}
                      onChange={(e) => setReviewerModel(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                    >
                      <option value="claude-sonnet-4-5">claude-sonnet-4-5 (Anthropic Mid-Tier)</option>
                      <option value="gemini-2.5-flash">gemini-2.5-flash (Google Mid-Tier)</option>
                      <option value="gpt-4.1-mini">gpt-4.1-mini (OpenAI Mid-Tier)</option>
                      <option value="o4-mini">o4-mini (OpenAI Fast Reasoning)</option>
                      <option value="kimi-k2">kimi-k2 (Kimi Mid-Tier)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-amber-300 mb-1">
                      Code Issues Found (1 per line — leave empty if 0)
                    </label>
                    <textarea
                      rows={2}
                      value={codeIssuesText}
                      onChange={(e) => setCodeIssuesText(e.target.value)}
                      placeholder="e.g. src/engine.rs:412 unguarded unwrap() on decode batch..."
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-rose-300 mb-1">
                      Security Issues Found (1 per line — leave empty if 0)
                    </label>
                    <textarea
                      rows={2}
                      value={securityIssuesText}
                      onChange={(e) => setSecurityIssuesText(e.target.value)}
                      placeholder="e.g. hip/src/kernels.cpp:88 missing bounds check on blockIdx..."
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">
                    Review Summary & Verification Notes
                  </label>
                  <textarea
                    rows={2}
                    value={reviewSummaryMd}
                    onChange={(e) => setReviewSummaryMd(e.target.value)}
                    placeholder="Summary of diff audit, exactness rule check, and unit/benchmark verification..."
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2 text-xs font-mono text-white"
                  />
                </div>

                <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hasAnyReviewIssues && mergeIfClean}
                      disabled={hasAnyReviewIssues}
                      onChange={(e) => setMergeIfClean(e.target.checked)}
                      className="rounded border-slate-700"
                    />
                    <span>
                      Auto-merge MR/PR (`{ticket.pr_url || ticket.branch_name || `board/${ticket.code.toLowerCase()}`}`) when 0 code & security issues are found
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition cursor-pointer ${
                      hasAnyReviewIssues
                        ? 'bg-rose-600 hover:bg-rose-500'
                        : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    {hasAnyReviewIssues
                      ? `Block Merge & Flag ${parsedCodeIssues.length + parsedSecurityIssues.length} Issue(s) → In-Progress`
                      : mergeIfClean
                        ? 'Approve (0 Issues) & Merge MR/PR → Done'
                        : 'Approve Review → Done'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Chronological Notes, Reviews, Triage Q&A & Handoffs */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Agent Notes, Reviews & Q&A Thread ({ticket.notes?.length || 0})
            </h3>

            {ticket.notes && ticket.notes.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {ticket.notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 text-xs flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-300">{n.author}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${kindBadge(
                            n.kind,
                          )}`}
                        >
                          {n.kind}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {n.created_at.replace('T', ' ').slice(0, 16)}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-xs text-slate-200 leading-relaxed overflow-x-auto">
                      {n.content_md}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic py-3">
                No notes or reviews recorded on this ticket yet.
              </div>
            )}

            {/* Add Note / Answer Form */}
            <form
              onSubmit={handleAddNote}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 flex flex-col gap-2.5 mt-1"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-300">Post to Thread:</span>
                <input
                  type="text"
                  value={noteAuthor}
                  onChange={(e) => setNoteAuthor(e.target.value)}
                  placeholder="Author (e.g. user, reviewer)"
                  className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs font-mono text-white w-40"
                />
                <select
                  value={noteKind}
                  onChange={(e) => setNoteKind(e.target.value as NoteKind)}
                  className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-white"
                >
                  <option value="note">Note / Measured Result</option>
                  <option value="answer">Answer Triage Question</option>
                  <option value="question">Clarifying Question</option>
                  <option value="review">Code Review</option>
                  <option value="handoff">Handoff</option>
                </select>
              </div>
              <textarea
                rows={3}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && noteContent.trim()) {
                    e.preventDefault()
                    handleAddNote(e as any)
                  }
                }}
                placeholder="Write a note, answer an agent's triage question, or flag a review finding... (Ctrl+Enter to post)"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 p-2.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">
                  <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">Esc</kbd> close • <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">Ctrl+Enter</kbd> submit
                </span>
                <button
                  type="submit"
                  disabled={saving || !noteContent.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Append to Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {showGrillDrawer && (
        <GrillMeDrawer
          isOpen={showGrillDrawer}
          ticket={ticket}
          projectSlug={projectSlug}
          onClose={() => setShowGrillDrawer(false)}
          onProposalsCreated={(updated) => onUpdated(updated)}
        />
      )}
    </div>
  )
}
