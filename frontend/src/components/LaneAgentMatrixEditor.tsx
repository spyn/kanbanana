import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  Cpu,
  Edit3,
  Eye,
  GitMerge,
  Globe,
  Grid,
  Columns,
  Layers,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type {
  A2AModelSpec,
  AgentLaneRule,
  AgentProfile,
  ConfigurableLane,
  CustomModelSpec,
  LaneConfig,
  SkillCatalogItem,
} from '../types'

export const LANE_META: Array<{
  lane: ConfigurableLane
  label: string
  subtitle: string
  accentBorder: string
  badgeClass: string
  headerBg: string
}> = [
  {
    lane: 'triage',
    label: 'Triage & Grill',
    subtitle: 'Frontier Orchestrator — research, spikes & worker-ready specs',
    accentBorder: 'border-purple-500/40',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    headerBg: 'from-purple-950/50 to-slate-900/80',
  },
  {
    lane: 'todo',
    label: 'Todo',
    subtitle: 'Mid-Tier / Local Worker — bounded stories ready for execution',
    accentBorder: 'border-sky-500/40',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    headerBg: 'from-sky-950/50 to-slate-900/80',
  },
  {
    lane: 'in-progress',
    label: 'In Progress',
    subtitle: 'Mid-Tier Worker (high/max care) — scoped coding & 2-strike escalation',
    accentBorder: 'border-amber-500/40',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    headerBg: 'from-amber-950/40 to-slate-900/80',
  },
  {
    lane: 'review',
    label: 'Review & QA Gate',
    subtitle: 'Cross-Vendor Reviewer — adversarial QA, security & merge gate',
    accentBorder: 'border-indigo-500/40',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    headerBg: 'from-indigo-950/50 to-slate-900/80',
  },
  {
    lane: 'blocked',
    label: 'Blocked',
    subtitle: 'Frontier Diagnostician — escalated failure root-cause tier',
    accentBorder: 'border-rose-500/40',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    headerBg: 'from-rose-950/40 to-slate-900/80',
  },
]

export const STANDARD_FLEET_AGENTS: Array<{
  id: string
  name: string
  provider: string
}> = [
  { id: 'claude-code', name: 'Claude Code', provider: 'claude' },
  { id: 'grok-cli', name: 'Grok CLI', provider: 'grok' },
  { id: 'antigravity', name: 'Google Antigravity (agy)', provider: 'antigravity' },
  { id: 'codex-cli', name: 'OpenAI Codex CLI', provider: 'codex' },
  { id: 'kimi-code', name: 'Kimi Code', provider: 'kimi' },
  { id: 'minimax-code', name: 'MiniMax Code', provider: 'minimax' },
  { id: 'cursor-agent', name: 'Cursor Agent', provider: 'cursor' },
  { id: 'opencode', name: 'OpenCode', provider: 'opencode' },
]

function emptyLaneConfig(inheritGlobal: boolean): LaneConfig {
  return {
    inherit_global: inheritGlobal,
    auto_dispatch: false,
    preferred_agent: '',
    fallback_agent: '',
    prevent_self_review: true,
    triage_breakdown_policy: 'stage-for-approval',
    review_merge_policy: 'auto-merge-clean',
    default_skills: [],
    agent_rules: {},
  }
}

interface LaneAgentMatrixEditorProps {
  scope: 'global' | 'project'
  laneConfigs: Record<string, LaneConfig>
  globalLaneConfigs?: Record<string, LaneConfig>
  onChange: (nextLaneConfigs: Record<string, LaneConfig>) => void
  agentProfiles: AgentProfile[]
  skillsCatalog: SkillCatalogItem[]
  providerModelCatalog?: Record<string, A2AModelSpec[]>
  customModels?: Record<string, CustomModelSpec[]>
}

export const LaneAgentMatrixEditor: React.FC<LaneAgentMatrixEditorProps> = ({
  scope,
  laneConfigs,
  globalLaneConfigs,
  onChange,
  agentProfiles,
  skillsCatalog,
  providerModelCatalog = {},
  customModels = {},
}) => {
  const [viewMode, setViewMode] = useState<'columns' | 'matrix'>('columns')

  // Modal state for editing/creating an Agent × Lane rule
  const [editingCell, setEditingCell] = useState<{
    lane: ConfigurableLane
    agentKey: string
    isNew: boolean
  } | null>(null)
  const [draftRule, setDraftRule] = useState<AgentLaneRule | null>(null)
  const [customModelInput, setCustomModelInput] = useState<string>('')
  const [skillSearch, setSkillSearch] = useState<string>('')

  // Modal state for editing lane-wide default skills
  const [editingLaneDefaults, setEditingLaneDefaults] = useState<ConfigurableLane | null>(null)

  const agentOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; provider: string; active: boolean }>()
    for (const std of STANDARD_FLEET_AGENTS) {
      map.set(std.id, { ...std, active: false })
    }
    for (const p of agentProfiles) {
      map.set(p.id, {
        id: p.id,
        name: p.name,
        provider: p.provider || 'custom',
        active: p.mounted || p.activity_state === 'active' || Boolean(p.a2a_connected),
      })
    }
    return Array.from(map.values())
  }, [agentProfiles])

  const skillById = useMemo(() => {
    const m = new Map<string, SkillCatalogItem>()
    for (const s of skillsCatalog) {
      m.set(s.id, s)
    }
    return m
  }, [skillsCatalog])

  const getEffectiveLane = (lane: ConfigurableLane): LaneConfig => {
    const localLane = laneConfigs[lane] || emptyLaneConfig(scope === 'project')
    if (scope === 'global' || !globalLaneConfigs) {
      return localLane
    }
    const gLane = globalLaneConfigs[lane] || emptyLaneConfig(false)
    const mergedRules: Record<string, AgentLaneRule> = {}
    for (const [k, r] of Object.entries(gLane.agent_rules || {})) {
      mergedRules[k] = { ...r, source: 'global' }
    }
    for (const [k, r] of Object.entries(localLane.agent_rules || {})) {
      mergedRules[k] = { ...r, source: 'project' }
    }
    if (localLane.inherit_global) {
      return {
        ...gLane,
        inherit_global: true,
        lane_source: 'global',
        agent_rules: mergedRules,
      }
    }
    return {
      ...localLane,
      inherit_global: false,
      lane_source: 'project',
      agent_rules: mergedRules,
    }
  }

  const updateLane = (lane: ConfigurableLane, updater: (prev: LaneConfig) => LaneConfig) => {
    const current = laneConfigs[lane] || emptyLaneConfig(scope === 'project')
    onChange({
      ...laneConfigs,
      [lane]: updater(current),
    })
  }

  const handleToggleInheritGlobal = (lane: ConfigurableLane, inherit: boolean) => {
    const gLane = globalLaneConfigs?.[lane] || emptyLaneConfig(false)
    const current = laneConfigs[lane] || emptyLaneConfig(true)
    if (!inherit) {
      // Seed project lane fields from global so toggling "Customize" keeps sensible starting values
      onChange({
        ...laneConfigs,
        [lane]: {
          ...gLane,
          inherit_global: false,
          agent_rules: { ...(current.agent_rules || {}) },
        },
      })
    } else {
      onChange({
        ...laneConfigs,
        [lane]: {
          ...current,
          inherit_global: true,
        },
      })
    }
  }

  const getModelsForAgentKey = (agentKey: string): Array<{ id: string; name: string; tier: string }> => {
    const opt = agentOptions.find((a) => a.id === agentKey)
    const prof = agentProfiles.find((p) => p.id === agentKey)
    const provider = (opt?.provider || prof?.provider || 'a2a').toLowerCase()

    const list: Array<{ id: string; name: string; tier: string }> = []
    const seen = new Set<string>()
    const pushModel = (id: string, name: string, tier: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      list.push({ id, name, tier })
    }

    for (const m of prof?.supported_models || []) {
      pushModel(m.id, m.name, m.tier)
    }
    for (const m of providerModelCatalog[provider] || []) {
      pushModel(m.id, m.name, m.tier)
    }
    for (const cm of customModels[provider] || []) {
      pushModel(cm.id, cm.name, cm.tier || 'custom')
    }
    for (const cm of customModels[agentKey] || []) {
      pushModel(cm.id, cm.name, cm.tier || 'custom')
    }
    for (const cm of customModels['*'] || []) {
      pushModel(cm.id, cm.name, cm.tier || 'custom')
    }
    // Fallback across all providers if custom/unknown agent
    if (list.length === 0) {
      for (const models of Object.values(providerModelCatalog)) {
        for (const m of models) {
          pushModel(m.id, m.name, m.tier)
        }
      }
    }
    return list
  }

  const openRuleEditor = (lane: ConfigurableLane, agentKey?: string) => {
    const effLane = getEffectiveLane(lane)
    const chosenKey = agentKey || agentOptions[0]?.id || 'claude-code'
    const existing = effLane.agent_rules?.[chosenKey]
    const agentMeta = agentOptions.find((a) => a.id === chosenKey)
    const models = getModelsForAgentKey(chosenKey)

    setEditingCell({
      lane,
      agentKey: chosenKey,
      isNew: !existing,
    })
    setDraftRule(
      existing
        ? {
            ...existing,
            skills: [...(existing.skills || [])],
          }
        : {
            agent_key: chosenKey,
            agent_label: agentMeta?.name || chosenKey,
            model: models[0]?.id || '',
            effort: 'high',
            skills: [...(effLane.default_skills || [])],
            custom_instructions: '',
            enabled: true,
          },
    )
    setCustomModelInput('')
    setSkillSearch('')
  }

  const handleSaveDraftRule = () => {
    if (!editingCell || !draftRule) return
    const { lane } = editingCell
    const finalModel = customModelInput.trim() || draftRule.model
    const agentMeta = agentOptions.find((a) => a.id === draftRule.agent_key)
    const cleanRule: AgentLaneRule = {
      ...draftRule,
      agent_label: agentMeta?.name || draftRule.agent_label || draftRule.agent_key,
      model: finalModel,
    }
    updateLane(lane, (prev) => ({
      ...prev,
      agent_rules: {
        ...(prev.agent_rules || {}),
        [cleanRule.agent_key]: cleanRule,
      },
    }))
    setEditingCell(null)
    setDraftRule(null)
  }

  const handleDeleteRule = (lane: ConfigurableLane, agentKey: string) => {
    updateLane(lane, (prev) => {
      const nextRules = { ...(prev.agent_rules || {}) }
      delete nextRules[agentKey]
      return {
        ...prev,
        agent_rules: nextRules,
      }
    })
  }

  const toggleSkillInList = (list: string[], skillId: string): string[] => {
    if (list.includes(skillId)) {
      return list.filter((s) => s !== skillId)
    }
    return [...list, skillId]
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header Controls & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <h4 className="text-sm font-bold text-white">
              {scope === 'global'
                ? 'Global Fleet Baseline — Agent × Lane Routing'
                : 'Project Agent × Lane Routing (Inherits Global + Per-Project Overrides)'}
            </h4>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {scope === 'global'
              ? 'Define which model, reasoning effort, and skills each coding agent runs when picking up tickets in each Kanban column.'
              : 'Customize auto-dispatch, self-review guards, and per-agent model & skill assignments for this repository.'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setViewMode('columns')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              viewMode === 'columns'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            Kanban Lane Columns
          </button>
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              viewMode === 'matrix'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            2D Matrix Summary
          </button>
        </div>
      </div>

      {/* VIEW 1: 5 VISUAL KANBAN LANE COLUMNS */}
      {viewMode === 'columns' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3.5 items-start">
          {LANE_META.map((meta) => {
            const eff = getEffectiveLane(meta.lane)
            const localLane = laneConfigs[meta.lane] || emptyLaneConfig(scope === 'project')
            const isInheriting = scope === 'project' && localLane.inherit_global
            const rulesList = Object.values(eff.agent_rules || {})

            return (
              <div
                key={meta.lane}
                className={`rounded-2xl border ${meta.accentBorder} bg-slate-900/80 flex flex-col overflow-hidden shadow-lg`}
              >
                {/* Column Header */}
                <div className={`bg-gradient-to-b ${meta.headerBg} px-3.5 py-3 border-b border-slate-800/90`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                    {scope === 'project' && (
                      <button
                        type="button"
                        onClick={() => handleToggleInheritGlobal(meta.lane, !isInheriting)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition cursor-pointer ${
                          isInheriting
                            ? 'bg-slate-900/90 text-slate-300 border-slate-700 hover:border-indigo-400'
                            : 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                        }`}
                        title={
                          isInheriting
                            ? 'Inheriting lane policy from Global Settings (click to customize for this project)'
                            : 'Using project-specific lane policy (click to revert to Global baseline)'
                        }
                      >
                        {isInheriting ? (
                          <>
                            <Globe className="w-2.5 h-2.5 text-sky-400" />
                            Global Policy
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                            Custom Policy
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">{meta.subtitle}</p>
                </div>

                {/* Lane Orchestration & Policy Controls */}
                <div className="p-3 border-b border-slate-800/80 bg-slate-950/50 flex flex-col gap-2.5 text-xs">
                  {/* Auto-Dispatch Toggle */}
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="inline-flex items-center gap-1.5 text-slate-200 font-medium">
                      <Zap
                        className={`w-3.5 h-3.5 ${
                          eff.auto_dispatch ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      />
                      Auto-dispatch on entry
                    </span>
                    <input
                      type="checkbox"
                      checked={eff.auto_dispatch}
                      disabled={isInheriting}
                      onChange={(e) =>
                        updateLane(meta.lane, (prev) => ({
                          ...prev,
                          inherit_global: false,
                          auto_dispatch: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 disabled:opacity-50"
                    />
                  </label>

                  {/* Preferred Agent */}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                      Preferred / Auto-Pickup Agent
                    </label>
                    <select
                      value={eff.preferred_agent || ''}
                      disabled={isInheriting}
                      onChange={(e) =>
                        updateLane(meta.lane, (prev) => ({
                          ...prev,
                          inherit_global: false,
                          preferred_agent: e.target.value,
                        }))
                      }
                      className="w-full rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1.5 text-xs text-white disabled:opacity-60"
                    >
                      <option value="">None (Any claiming agent)</option>
                      {agentOptions.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.name} ({ag.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Triage-specific Story Breakdown Policy */}
                  {meta.lane === 'triage' && (
                    <div className="rounded-lg border border-purple-500/25 bg-purple-950/20 p-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-1">
                        Story Breakdown Exit Policy
                      </label>
                      <select
                        value={eff.triage_breakdown_policy || 'stage-for-approval'}
                        disabled={isInheriting}
                        onChange={(e) =>
                          updateLane('triage', (prev) => ({
                            ...prev,
                            inherit_global: false,
                            triage_breakdown_policy: e.target.value as
                              | 'stage-for-approval'
                              | 'auto-promote-todo',
                          }))
                        }
                        className="w-full rounded bg-slate-950 border border-purple-500/30 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                      >
                        <option value="stage-for-approval">Stage sub-stories for approval</option>
                        <option value="auto-promote-todo">Auto-promote sub-stories to Todo</option>
                      </select>
                    </div>
                  )}

                  {/* Review-specific Self-Review Guard & Merge Gate */}
                  {meta.lane === 'review' && (
                    <div className="rounded-lg border border-indigo-500/25 bg-indigo-950/20 p-2 flex flex-col gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-indigo-300 mb-1">
                          Clean Review Merge Policy
                        </label>
                        <select
                          value={eff.review_merge_policy || 'auto-merge-clean'}
                          disabled={isInheriting}
                          onChange={(e) =>
                            updateLane('review', (prev) => ({
                              ...prev,
                              inherit_global: false,
                              review_merge_policy: e.target.value as
                                | 'auto-merge-clean'
                                | 'human-gate',
                            }))
                          }
                          className="w-full rounded bg-slate-950 border border-indigo-500/30 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                        >
                          <option value="auto-merge-clean">Auto-merge PR if 0 issues</option>
                          <option value="human-gate">Human merge gate (hold in Review)</option>
                        </select>
                      </div>

                      <label className="flex items-center justify-between gap-2 cursor-pointer pt-0.5">
                        <span className="inline-flex items-center gap-1 text-[11px] text-indigo-200">
                          <ShieldAlert className="w-3 h-3 text-amber-400" />
                          Prevent self-review
                        </span>
                        <input
                          type="checkbox"
                          checked={eff.prevent_self_review}
                          disabled={isInheriting}
                          onChange={(e) =>
                            updateLane('review', (prev) => ({
                              ...prev,
                              inherit_global: false,
                              prevent_self_review: e.target.checked,
                            }))
                          }
                          className="rounded border-slate-700 bg-slate-900 text-indigo-500 disabled:opacity-50"
                        />
                      </label>

                      {eff.prevent_self_review && (
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-0.5">
                            Fallback Reviewer (if author = preferred)
                          </label>
                          <select
                            value={eff.fallback_agent || ''}
                            disabled={isInheriting}
                            onChange={(e) =>
                              updateLane('review', (prev) => ({
                                ...prev,
                                inherit_global: false,
                                fallback_agent: e.target.value,
                              }))
                            }
                            className="w-full rounded bg-slate-950 border border-slate-800 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                          >
                            <option value="">Await manual pickup</option>
                            {agentOptions.map((ag) => (
                              <option key={ag.id} value={ag.id}>
                                {ag.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lane Default Skills */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">
                        Default Lane Skills
                      </span>
                      {!isInheriting && (
                        <button
                          type="button"
                          onClick={() => setEditingLaneDefaults(meta.lane)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(eff.default_skills || []).length > 0 ? (
                        eff.default_skills.map((sid) => (
                          <span
                            key={sid}
                            className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700 font-mono text-[10px]"
                          >
                            {sid}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">None</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Per-Agent Routing Cards */}
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Agent Rules ({rulesList.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => openRuleEditor(meta.lane)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Agent Rule
                    </button>
                  </div>

                  {rulesList.map((rule) => {
                    const isLocalOverride =
                      scope === 'project' && Boolean(localLane.agent_rules?.[rule.agent_key])
                    return (
                      <div
                        key={rule.agent_key}
                        className={`rounded-xl border p-2.5 transition group ${
                          isLocalOverride
                            ? 'border-amber-500/40 bg-amber-950/15'
                            : 'border-slate-800 bg-slate-950/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="text-xs font-bold text-white truncate">
                                {rule.agent_label || rule.agent_key}
                              </span>
                              {scope === 'project' && (
                                <span
                                  className={`px-1 py-0.2 rounded text-[9px] font-mono border ${
                                    isLocalOverride
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                      : 'bg-slate-900 text-slate-400 border-slate-800'
                                  }`}
                                >
                                  {isLocalOverride ? 'override' : 'global'}
                                </span>
                              )}
                            </div>

                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono text-[10px]">
                                {rule.model || 'default-model'}
                              </span>
                              {rule.effort && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-900 text-emerald-300 border border-slate-700 font-mono text-[9px] uppercase">
                                  {rule.effort}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => openRuleEditor(meta.lane, rule.agent_key)}
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                              title="Edit agent model & skills for this lane"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            {(scope === 'global' || isLocalOverride) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteRule(meta.lane, rule.agent_key)}
                                className="p-1 rounded hover:bg-rose-950/60 text-slate-500 hover:text-rose-300 cursor-pointer"
                                title={
                                  scope === 'project'
                                    ? 'Remove project override (revert to global)'
                                    : 'Delete rule'
                                }
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Assigned Skills Chips */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(rule.skills || []).map((sid) => {
                            const sk = skillById.get(sid)
                            return (
                              <span
                                key={sid}
                                title={sk?.description || sid}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 font-mono text-[10px]"
                              >
                                <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                                {sid}
                              </span>
                            )
                          })}
                        </div>

                        {rule.custom_instructions && (
                          <p className="mt-1.5 text-[10px] text-slate-400 line-clamp-2 italic">
                            “{rule.custom_instructions}”
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* VIEW 2: COMPACT 2D MATRIX SUMMARY (AGENTS × LANES) */
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80">
                <th className="py-3 px-4 font-bold text-slate-300">Agent Fleet</th>
                {LANE_META.map((m) => (
                  <th key={m.lane} className="py-3 px-3 font-bold text-slate-200">
                    <span className={`px-2 py-0.5 rounded border text-[11px] ${m.badgeClass}`}>
                      {m.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {agentOptions.map((ag) => (
                <tr key={ag.id} className="hover:bg-slate-900/90">
                  <td className="py-2.5 px-4 font-semibold text-white whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-cyan-400" />
                      <div>
                        <div>{ag.name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{ag.id}</div>
                      </div>
                    </div>
                  </td>
                  {LANE_META.map((m) => {
                    const eff = getEffectiveLane(m.lane)
                    const rule = eff.agent_rules?.[ag.id]
                    const isPreferred = eff.preferred_agent === ag.id
                    return (
                      <td key={m.lane} className="py-2.5 px-3 align-top">
                        <button
                          type="button"
                          onClick={() => openRuleEditor(m.lane, ag.id)}
                          className={`w-full text-left rounded-xl border p-2 transition cursor-pointer ${
                            rule
                              ? 'border-slate-700 bg-slate-950 hover:border-indigo-500/60'
                              : 'border-dashed border-slate-800/80 bg-slate-950/30 hover:border-slate-700 text-slate-500'
                          }`}
                        >
                          {rule ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[10px] text-indigo-300 truncate">
                                  {rule.model || 'default'}
                                </span>
                                {isPreferred && (
                                  <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                                    PREF
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {(rule.skills || []).slice(0, 2).map((s) => (
                                  <span
                                    key={s}
                                    className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-300 font-mono text-[9px]"
                                  >
                                    {s}
                                  </span>
                                ))}
                                {(rule.skills || []).length > 2 && (
                                  <span className="text-[9px] text-slate-400">
                                    +{rule.skills.length - 2}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[10px] italic">
                              Inherit lane defaults ({(eff.default_skills || []).length} skills) · Click to customize
                            </span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: EDIT AGENT × LANE RULE */}
      {editingCell && draftRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center gap-2.5">
                <Cpu className="w-5 h-5 text-indigo-400" />
                <div>
                  <h4 className="text-sm font-bold text-white">
                    Configure Agent × Lane Rule —{' '}
                    <span className="text-indigo-300 uppercase">{editingCell.lane}</span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Choose the exact model, reasoning effort, and skills to activate when this agent picks up a{' '}
                    <code className="text-slate-200">{editingCell.lane}</code> ticket.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingCell(null)
                  setDraftRule(null)
                }}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4">
              {/* Agent Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Target Coding Agent
                  </label>
                  <select
                    value={draftRule.agent_key}
                    onChange={(e) => {
                      const nextKey = e.target.value
                      const ag = agentOptions.find((a) => a.id === nextKey)
                      const nextModels = getModelsForAgentKey(nextKey)
                      setDraftRule({
                        ...draftRule,
                        agent_key: nextKey,
                        agent_label: ag?.name || nextKey,
                        model: nextModels[0]?.id || '',
                      })
                      setCustomModelInput('')
                    }}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
                  >
                    {agentOptions.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name} ({ag.id}){ag.active ? ' · ONLINE' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Reasoning Effort Tier
                  </label>
                  <select
                    value={draftRule.effort || ''}
                    onChange={(e) => setDraftRule({ ...draftRule, effort: e.target.value })}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white"
                  >
                    <option value="">Provider Default</option>
                    <option value="low">Low (Fast / economical)</option>
                    <option value="medium">Medium (Balanced QA / mid-tier)</option>
                    <option value="high">High (Deep reasoning)</option>
                    <option value="max">Max (Extended frontier thinking)</option>
                  </select>
                </div>
              </div>

              {/* Model Picker (Preset Catalog + Custom Model Slug Input) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Preset / Catalog Model
                  </label>
                  <select
                    value={draftRule.model}
                    onChange={(e) => {
                      setDraftRule({ ...draftRule, model: e.target.value })
                      setCustomModelInput('')
                    }}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                  >
                    <option value="">Agent Default Model</option>
                    {getModelsForAgentKey(draftRule.agent_key).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.id}) · [{m.tier}]
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Or Custom Model Slug Override
                  </label>
                  <input
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    placeholder="e.g. grok-4-fast-qa or openrouter/deepseek-r1"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              {/* Unified Multi-Skill Picker */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Assigned Skills ({draftRule.skills.length} selected)
                  </label>
                  <input
                    type="text"
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    placeholder="Filter skills..."
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1 text-xs text-white w-48"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/90 p-2.5">
                  {skillsCatalog
                    .filter((sk) => {
                      const q = skillSearch.trim().toLowerCase()
                      if (!q) return true
                      return (
                        sk.id.toLowerCase().includes(q) ||
                        sk.name.toLowerCase().includes(q) ||
                        sk.description.toLowerCase().includes(q)
                      )
                    })
                    .map((sk) => {
                      const checked = draftRule.skills.includes(sk.id)
                      const matchesLane = sk.lane_tags.includes(editingCell.lane)
                      return (
                        <button
                          key={sk.id}
                          type="button"
                          onClick={() =>
                            setDraftRule({
                              ...draftRule,
                              skills: toggleSkillInList(draftRule.skills, sk.id),
                            })
                          }
                          className={`text-left rounded-lg border p-2 transition cursor-pointer ${
                            checked
                              ? 'border-emerald-500/60 bg-emerald-950/30'
                              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-mono text-[11px] font-bold text-white truncate">
                              {sk.id}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {matchesLane && (
                                <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-semibold">
                                  {editingCell.lane}
                                </span>
                              )}
                              <span className="px-1 py-0.2 rounded bg-slate-800 text-slate-400 text-[9px]">
                                {sk.source}
                              </span>
                              {checked && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                            {sk.description}
                          </p>
                        </button>
                      )
                    })}
                </div>
              </div>

              {/* Optional Custom Role Prompt */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Extra Role / Lane Instructions (Optional)
                </label>
                <textarea
                  rows={2}
                  value={draftRule.custom_instructions}
                  onChange={(e) =>
                    setDraftRule({ ...draftRule, custom_instructions: e.target.value })
                  }
                  placeholder="e.g. Break epic into stories <= 200 LOC each and tag API schema dependencies."
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingCell(null)
                  setDraftRule(null)
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDraftRule}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Apply Agent × Lane Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT LANE DEFAULT SKILLS */}
      {editingLaneDefaults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <h4 className="text-sm font-bold text-white">
                Default Skills for <span className="text-indigo-300 uppercase">{editingLaneDefaults}</span> Lane
              </h4>
              <button
                type="button"
                onClick={() => setEditingLaneDefaults(null)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto flex flex-col gap-2">
              {skillsCatalog.map((sk) => {
                const eff = getEffectiveLane(editingLaneDefaults)
                const selected = (eff.default_skills || []).includes(sk.id)
                return (
                  <button
                    key={sk.id}
                    type="button"
                    onClick={() =>
                      updateLane(editingLaneDefaults, (prev) => ({
                        ...prev,
                        inherit_global: false,
                        default_skills: toggleSkillInList(eff.default_skills || [], sk.id),
                      }))
                    }
                    className={`text-left rounded-xl border p-2.5 transition cursor-pointer flex items-start justify-between gap-2 ${
                      selected
                        ? 'border-emerald-500/60 bg-emerald-950/30'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-mono font-bold text-white">{sk.id}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{sk.description}</div>
                    </div>
                    {selected && <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex justify-end">
              <button
                type="button"
                onClick={() => setEditingLaneDefaults(null)}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
