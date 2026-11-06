import React, { useState } from 'react'
import {
  Bot,
  Check,
  Compass,
  FlaskConical,
  Link2,
  Mic,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { api } from '../api'
import { GrillMeDrawer } from './GrillMeDrawer'
import type { AgentProfile, Section, Ticket } from '../types'

interface TriagePanelProps {
  projectSlug: string
  tickets: Ticket[]
  sections: Section[]
  agentProfiles?: AgentProfile[]
  onRefresh: () => void
  onSelectTicket: (t: Ticket) => void
}

type TriageTemplateMode = 'external-scan' | 'feature-research' | 'freeform'

export const TriagePanel: React.FC<TriagePanelProps> = ({
  projectSlug,
  tickets,
  sections,
  agentProfiles = [],
  onRefresh,
  onSelectTicket,
}) => {
  const triageTickets = tickets.filter((t) => t.status === 'triage')
  const [grillTicket, setGrillTicket] = useState<Ticket | null>(null)

  // Triage Creation Template Mode
  const [templateMode, setTemplateMode] = useState<TriageTemplateMode>('external-scan')

  // Mode 1: "X is using Y to do Z, let's look into that"
  const [extSourceX, setExtSourceX] = useState('')
  const [extMechanismY, setExtMechanismY] = useState('')
  const [extOutcomeZ, setExtOutcomeZ] = useState('')
  const [extRefPath, setExtRefPath] = useState('')
  const [extNotes, setExtNotes] = useState('')

  // Mode 2: "Research into this feature / bottleneck"
  const [featTopic, setFeatTopic] = useState('')
  const [featTargetHw, setFeatTargetHw] = useState('')
  const [featQuestions, setFeatQuestions] = useState('')

  // Mode 3: Freeform
  const [title, setTitle] = useState('')
  const [doMd, setDoMd] = useState('')
  const [filesMd, setFilesMd] = useState('')
  const [assignAgentOnCreate, setAssignAgentOnCreate] = useState('')
  const [creating, setCreating] = useState(false)

  // Answer state per triage ticket
  const [answers, setAnswers] = useState<Record<string, string>>({})

  // Quick proposal builder for a triage ticket
  const [activeProposalTicket, setActiveProposalTicket] = useState<string | null>(null)
  const [propCode, setPropCode] = useState('Q16')
  const [propTitle, setPropTitle] = useState('')
  const [propSection, setPropSection] = useState('1')
  const [propDeps, setPropDeps] = useState('')
  const [propFiles, setPropFiles] = useState('')
  const [propDo, setPropDo] = useState('')
  const [propDoneWhen, setPropDoneWhen] = useState('')
  const [propRationale, setPropRationale] = useState('')

  // Research findings / Cross-post / Close state per triage ticket
  const [activeFindingsTicket, setActiveFindingsTicket] = useState<string | null>(null)
  const [findingsText, setFindingsText] = useState('')
  const [findingsGain, setFindingsGain] = useState('')
  const [findingsExactness, setFindingsExactness] = useState('exact')
  const [findingsRec, setFindingsRec] = useState<
    'attach-to-existing' | 'not-worth-it' | 'needs-decision'
  >('attach-to-existing')
  const [findingsTargetTickets, setFindingsTargetTickets] = useState('')

  const handleCreateTriage = async (e: React.FormEvent) => {
    e.preventDefault()
    let finalTitle = title.trim()
    let finalDo = doMd.trim()
    const finalFiles = filesMd.trim()

    if (templateMode === 'external-scan') {
      if (!extSourceX.trim() || !extMechanismY.trim()) return
      finalTitle = `${extSourceX.trim()} uses ${extMechanismY.trim()}${
        extOutcomeZ.trim() ? ` to ${extOutcomeZ.trim()}` : ''
      } — investigate for our stack`
      const lines = [
        `**Pattern:** *${extSourceX.trim()}* is using **${extMechanismY.trim()}**${
          extOutcomeZ.trim() ? ` to achieve **${extOutcomeZ.trim()}**` : ''
        }.`,
      ]
      if (extRefPath.trim()) {
        lines.push(`**External Reference / Repo / PR:** \`${extRefPath.trim()}\``)
      }
      lines.push(
        '',
        '**Orchestrator Investigation Checklist (Frontier Model):**',
        '1. Inspect how the external implementation works and map exact symbols/files in our codebase.',
        '2. Decide whether ROI justifies building (`not-worth-it` if negative) and check exactness impact (`exact`, `distribution-exact`, or `lossy` behind `[experimental]`).',
        '3. Right-size any breakdown: emit 1 ticket if cohesive (1–2 files / <150 LOC); split into 2–5 stories only across distinct layers or disjoint parallel files.',
        '4. Write mid-range-worker-ready specs: exact Modify/Reference paths in `files_md`, exact signatures + ordered steps + `Out-of-Scope` in `do_md`, and runnable verification commands in `done_when_md`.',
      )
      if (extNotes.trim()) {
        lines.push('', `**Additional Context:**\n${extNotes.trim()}`)
      }
      finalDo = lines.join('\n')
    } else if (templateMode === 'feature-research') {
      if (!featTopic.trim()) return
      finalTitle = `Research into: ${featTopic.trim()}`
      const lines = [
        `**Research Topic:** ${featTopic.trim()}`,
      ]
      if (featTargetHw.trim()) {
        lines.push(`**Target Hardware / Architecture:** ${featTargetHw.trim()}`)
      }
      lines.push(
        '',
        '**Orchestrator Investigation Checklist (Frontier Model):**',
        '1. Check memory pages, local memory notes, and query any graph index if available.',
        '2. Resolve all design ambiguities upfront (`ask_triage_questions`) so downstream mid-range workers never guess.',
        '3. Avoid over-decomposition (1 ticket if <150 LOC / 1–2 files) and write worker-ready `files_md` (exact Modify/Reference paths), `do_md` (exact signatures, steps, Out-of-Scope), and `done_when_md` (runnable test commands).',
      )
      if (featQuestions.trim()) {
        lines.push('', `**Specific Questions / Hypothesis:**\n${featQuestions.trim()}`)
      }
      finalDo = lines.join('\n')
    } else {
      if (!finalTitle) return
    }

    setCreating(true)
    try {
      await api.createTicket(projectSlug, {
        title: finalTitle,
        status: 'triage',
        triage_state: assignAgentOnCreate ? 'researching' : 'new',
        owner: assignAgentOnCreate || null,
        do_md: finalDo,
        done_when_md:
          'Research findings recorded (source analyzed, codebase mapping, estimated gain, exactness impact) and either promoted to TODO ticket(s), cross-posted to an existing board ticket, or closed as not worth doing.',
        files_md: finalFiles,
      })
      setTitle('')
      setDoMd('')
      setFilesMd('')
      setExtSourceX('')
      setExtMechanismY('')
      setExtOutcomeZ('')
      setExtRefPath('')
      setExtNotes('')
      setFeatTopic('')
      setFeatQuestions('')
      onRefresh()
    } finally {
      setCreating(false)
    }
  }

  const handleSendAnswer = async (code: string) => {
    const text = answers[code]?.trim()
    if (!text) return
    await api.addNote(projectSlug, code, {
      author: 'user',
      kind: 'answer',
      content_md: text,
    })
    setAnswers((prev) => ({ ...prev, [code]: '' }))
    onRefresh()
  }

  const handleAssignAgent = async (code: string, agentId: string) => {
    await api.updateTicket(projectSlug, code, {
      owner: agentId || '—',
      triage_state: agentId ? 'researching' : 'new',
    })
    onRefresh()
  }

  const handleAddProposal = async (triageCode: string, autoPromote: boolean) => {
    if (!propTitle.trim() || !propCode.trim()) return
    const deps = propDeps
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await api.proposeTickets(projectSlug, triageCode, {
      proposed_by: 'triage-agent',
      auto_promote: autoPromote,
      proposals: [
        {
          code: propCode.trim(),
          title: propTitle.trim(),
          section_code: propSection,
          depends_on: deps,
          files_md: propFiles.trim(),
          do_md: propDo.trim(),
          done_when_md: propDoneWhen.trim(),
          rationale_md: propRationale.trim(),
        },
      ],
    })
    setPropTitle('')
    setPropDo('')
    setPropDoneWhen('')
    setPropRationale('')
    setActiveProposalTicket(null)
    onRefresh()
  }

  const handleSubmitFindings = async (triageCode: string, owner?: string | null) => {
    if (!findingsText.trim()) return
    const targets = findingsTargetTickets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await api.submitResearchFindings(projectSlug, triageCode, {
      agent_id: owner || 'research-agent',
      findings_md: findingsText.trim(),
      estimated_gain: findingsGain.trim(),
      exactness_impact: findingsExactness,
      recommendation: findingsRec,
      attach_to_ticket_codes: targets,
    })
    setFindingsText('')
    setFindingsGain('')
    setFindingsTargetTickets('')
    setActiveFindingsTicket(null)
    onRefresh()
  }

  const handleApproveAll = async (triageCode: string) => {
    await api.approveProposals(projectSlug, triageCode)
    onRefresh()
  }

  const handleRejectProposal = async (triageCode: string, proposalId: string) => {
    await api.rejectProposal(projectSlug, triageCode, proposalId)
    onRefresh()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Left Column: Research-First Triage Ticket Builder */}
      <div className="rounded-2xl border border-purple-500/30 bg-slate-900/75 p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              New Research / Triage Investigation
            </h3>
            <p className="text-xs text-slate-400">
              Frame an external scan (<em>&quot;X uses Y to do Z&quot;</em>) or a feature investigation for an agent to research, grill, and break down.
            </p>
          </div>
        </div>

        {/* 3 Preset Mode Switcher */}
        <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setTemplateMode('external-scan')}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
              templateMode === 'external-scan'
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-3 h-3" />
            X uses Y → Z
          </button>
          <button
            type="button"
            onClick={() => setTemplateMode('feature-research')}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
              templateMode === 'feature-research'
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FlaskConical className="w-3 h-3" />
            Feature Research
          </button>
          <button
            type="button"
            onClick={() => setTemplateMode('freeform')}
            className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
              templateMode === 'freeform'
                ? 'bg-purple-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Freeform
          </button>
        </div>

        <form onSubmit={handleCreateTriage} className="flex flex-col gap-3">
          {templateMode === 'external-scan' && (
            <>
              <div className="rounded-xl bg-purple-950/20 border border-purple-500/30 p-2.5 text-[11px] text-purple-200">
                <strong>Pattern:</strong> &ldquo;<em>X</em> is using <em>Y</em> to do <em>Z</em> — let&apos;s look into that.&rdquo;
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Who / External Project / PR (X) *
                </label>
                <input
                  type="text"
                  required
                  value={extSourceX}
                  onChange={(e) => setExtSourceX(e.target.value)}
                  placeholder="e.g. FlyDSL PR #1205, hipfire v0.4.3, llama.cpp #30481"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  What Technique / Mechanism They Use (Y) *
                </label>
                <input
                  type="text"
                  required
                  value={extMechanismY}
                  onChange={(e) => setExtMechanismY(e.target.value)}
                  placeholder="e.g. tagged-pair mailboxes with device-side step counter"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Claimed Outcome / Goal (Z)
                </label>
                <input
                  type="text"
                  value={extOutcomeZ}
                  onChange={(e) => setExtOutcomeZ(e.target.value)}
                  placeholder="e.g. collapse decode launch overhead 2.63x inside HIP graph replay"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  External Repo Path / URL / Paper Reference
                </label>
                <input
                  type="text"
                  value={extRefPath}
                  onChange={(e) => setExtRefPath(e.target.value)}
                  placeholder="e.g. ~/.graphify/repos/warpfront/hipfire or PR link"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Extra Notes / What to Check in Our Stack
                </label>
                <textarea
                  rows={2}
                  value={extNotes}
                  onChange={(e) => setExtNotes(e.target.value)}
                  placeholder="e.g. Check if this applies to B1 or B6 on gfx1201..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </>
          )}

          {templateMode === 'feature-research' && (
            <>
              <div className="rounded-xl bg-purple-950/20 border border-purple-500/30 p-2.5 text-[11px] text-purple-200">
                <strong>Pattern:</strong> &ldquo;Research into this feature / bottleneck before committing to a full build.&rdquo;
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Feature / Bottleneck to Research *
                </label>
                <input
                  type="text"
                  required
                  value={featTopic}
                  onChange={(e) => setFeatTopic(e.target.value)}
                  placeholder="e.g. LDS tiling for f16/int8 WMMA GEMM on gfx12"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Target Hardware / Models
                </label>
                <input
                  type="text"
                  value={featTargetHw}
                  onChange={(e) => setFeatTargetHw(e.target.value)}
                  placeholder="e.g. Production Cluster, GPU A100, ARM Neoverse, etc."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Hypothesis & Open Questions to Grill
                </label>
                <textarea
                  rows={3}
                  value={featQuestions}
                  onChange={(e) => setFeatQuestions(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateTriage(e as any)
                    }
                  }}
                  placeholder="What measurements or code paths should the agent inspect first? (Ctrl+Enter to queue)"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </>
          )}

          {templateMode === 'freeform' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Idea / Research Title *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Research into persistent cache routing"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Initial Context / Hypothesis / Questions
                </label>
                <textarea
                  rows={4}
                  value={doMd}
                  onChange={(e) => setDoMd(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateTriage(e as any)
                    }
                  }}
                  placeholder="Describe what you want researched... (Ctrl+Enter to queue)"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Our Relevant Files / Modules (Optional)
            </label>
            <input
              type="text"
              value={filesMd}
              onChange={(e) => setFilesMd(e.target.value)}
              placeholder="e.g. src/engine.rs, packages/core"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          {agentProfiles.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Assign Research Agent (Optional)
              </label>
              <select
                value={assignAgentOnCreate}
                onChange={(e) => setAssignAgentOnCreate(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
              >
                <option value="">-- Leave Unclaimed for Next Triage Agent --</option>
                {agentProfiles.map((p) => (
                  <option key={p.id} value={`${p.provider}-scan`}>
                    {p.name} (`{p.provider}-scan`)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Research / Triage Ticket
            </button>
            <span className="text-[10px] text-center text-slate-500">
              <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">Ctrl+Enter</kbd> to quickly submit
            </span>
          </div>
        </form>
      </div>

      {/* Right 2 Columns: Active Triage Research Queue, Findings & Sub-Ticket Proposals */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white">
            Active Triage & Research Queue ({triageTickets.length})
          </h3>
        </div>

        {triageTickets.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-400">
            No tickets are currently in Triage. Use the research templates on the left (e.g. <em>&quot;X uses Y to do Z&quot;</em>) to queue an investigation!
          </div>
        ) : (
          triageTickets.map((t) => {
            const pendingProposals = t.proposals?.filter((p) => p.status === 'pending') || []
            return (
              <div
                key={t.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {t.code}
                      </span>
                      <span
                        className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                          t.triage_state === 'needs-info'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : t.triage_state === 'proposed'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        State: {t.triage_state}
                      </span>
                      {agentProfiles.length > 0 && (
                        <select
                          value={t.owner || ''}
                          onChange={(e) => handleAssignAgent(t.code, e.target.value)}
                          className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-0.5 text-[11px] font-mono text-indigo-300"
                        >
                          <option value="">Unassigned Agent</option>
                          {agentProfiles.map((p) => (
                            <option key={p.id} value={`${p.provider}-scan`}>
                              Agent: {p.name} ({p.provider}-scan)
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <h4
                      onClick={() => onSelectTicket(t)}
                      className="text-base font-bold text-white mt-1.5 hover:text-indigo-300 cursor-pointer"
                    >
                      {t.title}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setGrillTicket(t)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/30 hover:bg-violet-600/50 text-xs font-semibold text-violet-200 border border-violet-500/50 shadow-sm shadow-violet-600/20 transition cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5 text-violet-400" />
                      🎙️ Grill Me Interview
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFindingsTicket(
                          activeFindingsTicket === t.code ? null : t.code,
                        )
                        setActiveProposalTicket(null)
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-xs font-medium text-purple-200 border border-purple-500/40 transition cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Record Findings / Cross-Post
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProposalTicket(
                          activeProposalTicket === t.code ? null : t.code,
                        )
                        setActiveFindingsTicket(null)
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition cursor-pointer"
                    >
                      + Propose TODO Ticket(s)
                    </button>
                  </div>
                </div>

                {t.do_md && (
                  <div className="text-xs text-slate-300 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 whitespace-pre-wrap leading-relaxed">
                    {t.do_md}
                  </div>
                )}

                {/* Record Research Findings / Cross-Post to Existing Ticket Panel */}
                {activeFindingsTicket === t.code && (
                  <div className="rounded-xl border border-purple-500/40 bg-purple-950/15 p-4 flex flex-col gap-3">
                    <div className="text-xs font-bold text-purple-200">
                      Record Research Conclusion for {t.code}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Outcome / Recommendation
                        </label>
                        <select
                          value={findingsRec}
                          onChange={(e) => setFindingsRec(e.target.value as any)}
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value="attach-to-existing">
                            Attach Findings to Existing Ticket(s) & Close
                          </option>
                          <option value="not-worth-it">
                            Not Worth Doing (Record & Close so nobody redoes it)
                          </option>
                          <option value="needs-decision">
                            Needs User Decision (Set to needs-info)
                          </option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Estimated Gain / Roofline Impact
                        </label>
                        <input
                          type="text"
                          value={findingsGain}
                          onChange={(e) => setFindingsGain(e.target.value)}
                          placeholder="e.g. ~5-10% decode on 9B, or 2.63x layer"
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">
                          Cross-Post to Board Tickets (Optional)
                        </label>
                        <input
                          type="text"
                          value={findingsTargetTickets}
                          onChange={(e) => setFindingsTargetTickets(e.target.value)}
                          placeholder="e.g. B1, B6"
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                        />
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={findingsText}
                      onChange={(e) => setFindingsText(e.target.value)}
                      placeholder="Write research findings (e.g. how X's implementation works, what transfers to our code, and why)..."
                      className="rounded-lg bg-slate-950 border border-slate-700 p-2.5 text-xs font-mono text-white"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSubmitFindings(t.code, t.owner)}
                        className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white cursor-pointer"
                      >
                        Save Research Findings
                      </button>
                    </div>
                  </div>
                )}

                {/* Q&A / Notes Thread */}
                {t.notes && t.notes.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold text-slate-400">
                      Research & Grill Thread:
                    </div>
                    {t.notes.map((n) => (
                      <div
                        key={n.id}
                        className={`rounded-xl p-3 text-xs border ${
                          n.kind === 'question'
                            ? 'bg-amber-950/25 border-amber-700/50 text-amber-100'
                            : n.kind === 'answer'
                              ? 'bg-emerald-950/25 border-emerald-700/50 text-emerald-100'
                              : 'bg-slate-950/70 border-slate-800 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono font-bold text-[11px]">
                            {n.author} ({n.kind})
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {n.created_at.slice(0, 16).replace('T', ' ')}
                          </span>
                        </div>
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                          {n.content_md}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply / Answer Input */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={answers[t.code] || ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [t.code]: e.target.value }))
                    }
                    placeholder="Answer agent's grill questions or add research direction..."
                    className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleSendAnswer(t.code)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Reply
                  </button>
                </div>

                {/* Inline Sub-Ticket Proposal Builder */}
                {activeProposalTicket === t.code && (
                  <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/15 p-4 flex flex-col gap-3">
                    <div className="text-xs font-bold text-indigo-300">
                      Propose Actionable TODO Sub-Ticket from {t.code}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        value={propCode}
                        onChange={(e) => setPropCode(e.target.value)}
                        placeholder="Task ID (e.g. Q16)"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                      />
                      <select
                        value={propSection}
                        onChange={(e) => setPropSection(e.target.value)}
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      >
                        {sections.map((s) => (
                          <option key={s.id} value={s.code}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={propDeps}
                        onChange={(e) => setPropDeps(e.target.value)}
                        placeholder="Depends on (e.g. M0, Q10)"
                        className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                      />
                    </div>
                    <input
                      type="text"
                      value={propTitle}
                      onChange={(e) => setPropTitle(e.target.value)}
                      placeholder="Actionable TODO Ticket Title"
                      className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                    />
                    <input
                      type="text"
                      value={propFiles}
                      onChange={(e) => setPropFiles(e.target.value)}
                      placeholder="Files — exact Modify/Create + Reference paths (e.g. Modify: src/foo.py; Reference: src/bar.py)"
                      className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <textarea
                      rows={3}
                      value={propDo}
                      onChange={(e) => setPropDo(e.target.value)}
                      placeholder="Worker-ready Do blueprint: exact function/type signatures, numbered edit steps, edge cases, and explicit Out-of-Scope (Do NOT Touch)..."
                      className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <textarea
                      rows={2}
                      value={propDoneWhen}
                      onChange={(e) => setPropDoneWhen(e.target.value)}
                      placeholder="Deterministic Done-When gate: exact runnable test/build commands + expected assertions..."
                      className="rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleAddProposal(t.code, false)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
                      >
                        Add Proposal for Review
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddProposal(t.code, true)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer"
                      >
                        Add & Auto-Promote to TODO
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending Proposals List */}
                {t.proposals && t.proposals.length > 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-3.5 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">
                        Proposed Sub-Tickets ({t.proposals.length})
                      </span>
                      {pendingProposals.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleApproveAll(t.code)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve & Create {pendingProposals.length} TODO Ticket(s)
                        </button>
                      )}
                    </div>

                    {t.proposals.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs flex items-start justify-between gap-3"
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-indigo-300">{p.code}</span>
                            <span className="font-semibold text-white">{p.title}</span>
                            <span className="text-slate-400">(Sec {p.section_code})</span>
                          </div>
                          {p.do_md && <p className="text-slate-300">{p.do_md}</p>}
                          {p.done_when_md && (
                            <p className="text-emerald-300/90">
                              <strong>Done when:</strong> {p.done_when_md}
                            </p>
                          )}
                        </div>
                        {p.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleRejectProposal(t.code, p.id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400"
                            title="Reject proposal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {grillTicket && (
        <GrillMeDrawer
          isOpen={Boolean(grillTicket)}
          ticket={grillTicket}
          projectSlug={projectSlug}
          onClose={() => setGrillTicket(null)}
          onProposalsCreated={() => onRefresh()}
        />
      )}
    </div>
  )
}
