import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Cpu,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Layers,
  Network,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { api, getClientApiToken, setClientApiToken } from '../api'
import { LaneAgentMatrixEditor, LANE_META } from './LaneAgentMatrixEditor'
import type {
  AgentProfile,
  ConfigurableLane,
  CustomModelSpec,
  GlobalSettings,
  ManagedSkillSpec,
  SkillCatalogItem,
} from '../types'

interface GlobalSettingsPageProps {
  globalSettings: GlobalSettings
  agentProfiles: AgentProfile[]
  skillsCatalog: SkillCatalogItem[]
  onSaved: (updated: GlobalSettings) => void
  onClose: () => void
}

type GlobalSubTab = 'matrix' | 'systemone' | 'skills-models' | 'network' | 'hud'

const PROVIDER_KEYS = [
  { key: 'claude', label: 'Claude (Anthropic)' },
  { key: 'grok', label: 'Grok (xAI)' },
  { key: 'antigravity', label: 'Google Antigravity (Gemini)' },
  { key: 'codex', label: 'OpenAI Codex' },
  { key: 'kimi', label: 'Kimi (Moonshot AI)' },
  { key: 'minimax', label: 'MiniMax' },
  { key: 'cursor', label: 'Cursor Agent' },
  { key: 'opencode', label: 'OpenCode' },
  { key: '*', label: 'All Providers (*)' },
]

function slugifySkillId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const GlobalSettingsPage: React.FC<GlobalSettingsPageProps> = ({
  globalSettings,
  agentProfiles,
  skillsCatalog,
  onSaved,
  onClose,
}) => {
  const [subTab, setSubTab] = useState<GlobalSubTab>('matrix')
  const [draft, setDraft] = useState<GlobalSettings>(globalSettings)
  const [dirty, setDirty] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [resetting, setResetting] = useState<boolean>(false)
  const [copiedUri, setCopiedUri] = useState<string>('')
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info'
    text: string
  } | null>(null)

  // Local client API Bearer token (stored in browser localStorage)
  const [apiTokenInput, setApiTokenInput] = useState<string>(() => getClientApiToken())
  const [showApiToken, setShowApiToken] = useState<boolean>(false)
  const [newEndpointInput, setNewEndpointInput] = useState<string>('')

  // Managed skill editor modal state
  const [editingSkill, setEditingSkill] = useState<{
    isNew: boolean
    spec: ManagedSkillSpec
  } | null>(null)

  // Custom model form state
  const [newModelProvider, setNewModelProvider] = useState<string>('grok')
  const [newModelId, setNewModelId] = useState<string>('')
  const [newModelName, setNewModelName] = useState<string>('')
  const [newModelTier, setNewModelTier] = useState<string>('frontier')
  const [newModelSupportsEffort, setNewModelSupportsEffort] = useState<boolean>(true)
  const [newModelDefaultEffort, setNewModelDefaultEffort] = useState<string>('high')

  // SystemOne router test state
  const [s1Testing, setS1Testing] = useState<boolean>(false)
  const [s1TestResult, setS1TestResult] = useState<{
    success: boolean
    latency_ms?: number
    model?: string
    error?: string
  } | null>(null)
  const [showS1ApiKey, setShowS1ApiKey] = useState<boolean>(false)

  const testSystemOne = async () => {
    const s1 = draft.systemone_config || {
      enabled: false,
      url: 'https://api.typesafe.ai',
      api_key: '',
      model: 'jev-latest',
    }
    setS1Testing(true)
    setS1TestResult(null)
    try {
      const res = await api.testSystemOneConnection({
        url: s1.url || 'https://api.typesafe.ai',
        api_key: s1.api_key || null,
        model: s1.model || 'jev-latest',
        timeout_seconds: s1.timeout_seconds || 5.0,
      })
      setS1TestResult(res)
    } catch (err: any) {
      setS1TestResult({
        success: false,
        error: err.message || 'Connection test failed',
      })
    } finally {
      setS1Testing(false)
    }
  }

  useEffect(() => {
    setDraft(globalSettings)
    setDirty(false)
  }, [globalSettings])

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text })
    window.setTimeout(() => setToast(null), 4000)
  }

  const updateDraft = (patch: Partial<GlobalSettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }

  const handleSaveGlobal = async () => {
    setSaving(true)
    try {
      const updated = await api.updateGlobalSettings({
        mcp_url: draft.mcp_url,
        a2a_scan_endpoints: draft.a2a_scan_endpoints,
        auto_scan_a2a: draft.auto_scan_a2a,
        default_dispatch_via_a2a: draft.default_dispatch_via_a2a,
        default_auto_create_worktree: draft.default_auto_create_worktree,
        default_launch_subprocess: draft.default_launch_subprocess,
        default_token_ceiling: draft.default_token_ceiling,
        hud_neuro_audio_armed_default: draft.hud_neuro_audio_armed_default,
        hud_neuro_volume: draft.hud_neuro_volume,
        hud_pr_drop_enabled: draft.hud_pr_drop_enabled,
        fighter_avatars_enabled: draft.fighter_avatars_enabled,
        custom_models: draft.custom_models,
        managed_skills: draft.managed_skills,
        lane_configs: draft.lane_configs,
      })
      setDraft(updated)
      setDirty(false)
      onSaved(updated)
      showToast('success', 'Global fleet settings saved across all boards')
    } catch (e: any) {
      showToast('error', `Failed to save global settings: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleResetDefaults = async () => {
    if (
      !window.confirm(
        'Reset all Global Settings (fleet lane routing defaults, built-in role skills, custom models, and HUD defaults) back to factory defaults?',
      )
    ) {
      return
    }
    setResetting(true)
    try {
      const fresh = await api.resetGlobalSettings()
      setDraft(fresh)
      setDirty(false)
      onSaved(fresh)
      showToast('info', 'Global settings restored to factory defaults')
    } catch (e: any) {
      showToast('error', `Reset failed: ${e.message}`)
    } finally {
      setResetting(false)
    }
  }

  const handleSaveApiToken = () => {
    setClientApiToken(apiTokenInput)
    showToast(
      'success',
      apiTokenInput.trim()
        ? 'API Bearer token saved in browser storage'
        : 'API Bearer token cleared from browser storage',
    )
  }

  // Merge catalog view so newly added/edited draft.managed_skills appear immediately in the matrix editor
  const effectiveSkillsCatalog = useMemo<SkillCatalogItem[]>(() => {
    const byId = new Map<string, SkillCatalogItem>()
    for (const item of skillsCatalog) {
      byId.set(item.id, item)
    }
    for (const ms of draft.managed_skills || []) {
      byId.set(ms.id, {
        id: ms.id,
        name: ms.name,
        description: ms.description,
        source: ms.built_in ? 'built-in' : 'global-custom',
        lane_tags: ms.lane_tags || [],
        uri: `skill://global/${ms.id}/SKILL.md`,
        http_url: `/api/skills/${ms.id}/SKILL.md`,
        editable: true,
        built_in: Boolean(ms.built_in),
        installed_on_agents: byId.get(ms.id)?.installed_on_agents || [],
        content_md: ms.content_md,
      })
    }
    return Array.from(byId.values())
  }, [skillsCatalog, draft.managed_skills])

  const discoveredExternalSkills = useMemo(
    () =>
      skillsCatalog.filter(
        (s) =>
          s.source === 'agent-config' ||
          s.source === 'a2a-card' ||
          s.source === 'repo',
      ),
    [skillsCatalog],
  )

  const handleOpenNewSkill = () => {
    setEditingSkill({
      isNew: true,
      spec: {
        id: '',
        name: '',
        description: '',
        lane_tags: ['review'],
        content_md:
          '# Custom Role Skill\n\n## Checklist\n1. Inspect repository conventions and ticket acceptance criteria.\n2. Execute focused verification commands and report concrete findings.\n',
        built_in: false,
      },
    })
  }

  const handleSaveSkillModal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingSkill) return
    const cleanId = slugifySkillId(editingSkill.spec.id || editingSkill.spec.name)
    if (!cleanId) return
    const normalized: ManagedSkillSpec = {
      ...editingSkill.spec,
      id: cleanId,
      name: editingSkill.spec.name.trim() || cleanId,
      description: editingSkill.spec.description.trim(),
    }
    const existing = draft.managed_skills || []
    const idx = existing.findIndex((s) => s.id === cleanId)
    const nextList =
      idx >= 0
        ? existing.map((s, i) => (i === idx ? normalized : s))
        : [...existing, normalized]
    updateDraft({ managed_skills: nextList })
    setEditingSkill(null)
  }

  const handleDeleteManagedSkill = (skillId: string) => {
    updateDraft({
      managed_skills: (draft.managed_skills || []).filter((s) => s.id !== skillId),
    })
  }

  const handleAddCustomModel = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanId = newModelId.trim()
    if (!cleanId) return
    const spec: CustomModelSpec = {
      id: cleanId,
      name: newModelName.trim() || cleanId,
      tier: newModelTier,
      supports_effort: newModelSupportsEffort,
      effort_levels: newModelSupportsEffort ? ['low', 'medium', 'high'] : [],
      default_effort: newModelSupportsEffort ? newModelDefaultEffort : null,
    }
    const prevProviderList = draft.custom_models?.[newModelProvider] || []
    const filtered = prevProviderList.filter((m) => m.id !== cleanId)
    updateDraft({
      custom_models: {
        ...(draft.custom_models || {}),
        [newModelProvider]: [...filtered, spec],
      },
    })
    setNewModelId('')
    setNewModelName('')
  }

  const handleRemoveCustomModel = (provider: string, modelId: string) => {
    const prevList = draft.custom_models?.[provider] || []
    const nextList = prevList.filter((m) => m.id !== modelId)
    const nextMap = { ...(draft.custom_models || {}) }
    if (nextList.length > 0) {
      nextMap[provider] = nextList
    } else {
      delete nextMap[provider]
    }
    updateDraft({ custom_models: nextMap })
  }

  const handleAddEndpoint = () => {
    const trimmed = newEndpointInput.trim()
    if (!trimmed) return
    if (!(draft.a2a_scan_endpoints || []).includes(trimmed)) {
      updateDraft({
        a2a_scan_endpoints: [...(draft.a2a_scan_endpoints || []), trimmed],
      })
    }
    setNewEndpointInput('')
  }

  const copyUri = (uri: string) => {
    navigator.clipboard.writeText(uri)
    setCopiedUri(uri)
    window.setTimeout(() => setCopiedUri(''), 1800)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header Banner */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/50 via-slate-900/90 to-slate-900/90 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition cursor-pointer"
            title="Back to Project Board"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Globe className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Global Fleet Settings
              </h2>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                Fleet-Wide Baseline
              </span>
              {dirty && (
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Unsaved Changes
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Configure default Agent × Lane model/skill rules, reusable custom models, role skills, A2A discovery endpoints, and Overnight HUD guardrails inherited by all Kanbanana projects.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleResetDefaults}
            disabled={resetting || saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 border border-slate-700 transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            {resetting ? 'Resetting...' : 'Reset Defaults'}
          </button>
          <button
            type="button"
            onClick={handleSaveGlobal}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Global Settings'}
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSubTab('matrix')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'matrix'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Fleet Lane × Agent Baseline
        </button>

        <button
          type="button"
          onClick={() => setSubTab('systemone')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'systemone'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 text-purple-400" />
          SystemOne Router
          {draft.systemone_config?.enabled ? (
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono">
              ENABLED
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[9px] font-mono">
              OFF
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('skills-models')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'skills-models'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Global Skill Library &amp; Models ({(draft.managed_skills || []).length})
        </button>

        <button
          type="button"
          onClick={() => setSubTab('network')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'network'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          Coordinator, Auth &amp; A2A Network
        </button>

        <button
          type="button"
          onClick={() => setSubTab('hud')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'hud'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Overnight HUD &amp; UI Defaults
        </button>
      </div>

      {/* SUB-TAB 1: Fleet Lane × Agent Baseline */}
      {subTab === 'matrix' && (
        <LaneAgentMatrixEditor
          scope="global"
          laneConfigs={draft.lane_configs || {}}
          onChange={(nextLanes) => updateDraft({ lane_configs: nextLanes })}
          agentProfiles={agentProfiles}
          skillsCatalog={effectiveSkillsCatalog}
          providerModelCatalog={draft.provider_model_catalog || {}}
          customModels={draft.custom_models || {}}
        />
      )}

      {/* SUB-TAB: SystemOne Dynamic Router */}
      {subTab === 'systemone' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-5 h-5 text-purple-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      SystemOne Dynamic Model &amp; Effort Router
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      TypeSafe AI System One decision engine for intelligent task-to-model routing and reasoning effort sizing.
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={draft.systemone_config?.enabled ?? false}
                    onChange={(e) => {
                      const enabled = e.target.checked
                      const cur = draft.systemone_config || {
                        enabled: false,
                        url: 'https://api.typesafe.ai',
                        api_key: '',
                        model: 'jev-latest',
                        timeout_seconds: 5.0,
                      }
                      updateDraft({
                        systemone_config: { ...cur, enabled },
                      })
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Endpoint URL */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>API Base URL / Endpoint</span>
                  <span className="text-[10px] text-slate-500 font-normal">Default: https://api.typesafe.ai</span>
                </label>
                <input
                  type="text"
                  value={draft.systemone_config?.url ?? 'https://api.typesafe.ai'}
                  onChange={(e) => {
                    const cur = draft.systemone_config || {
                      enabled: false,
                      url: 'https://api.typesafe.ai',
                      api_key: '',
                      model: 'jev-latest',
                      timeout_seconds: 5.0,
                    }
                    updateDraft({
                      systemone_config: { ...cur, url: e.target.value },
                    })
                  }}
                  placeholder="https://api.typesafe.ai"
                  className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                />
                <p className="text-[11px] text-slate-500">
                  Must point to a TypeSafe AI System One compatible host. Automatically formats to <code className="text-purple-300 font-mono">/v1/systemone</code>.
                </p>
              </div>

              {/* API Key (Optional) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>API Key <span className="text-slate-500 font-normal">(Optional if self-hosted / local)</span></span>
                </label>
                <div className="relative">
                  <input
                    type={showS1ApiKey ? 'text' : 'password'}
                    value={draft.systemone_config?.api_key ?? ''}
                    onChange={(e) => {
                      const cur = draft.systemone_config || {
                        enabled: false,
                        url: 'https://api.typesafe.ai',
                        api_key: '',
                        model: 'jev-latest',
                        timeout_seconds: 5.0,
                      }
                      updateDraft({
                        systemone_config: { ...cur, api_key: e.target.value },
                      })
                    }}
                    placeholder="ts-live-..."
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-3 pr-9 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowS1ApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showS1ApiKey ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Model & Timeout Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    SystemOne Model / Engine
                  </label>
                  <input
                    type="text"
                    value={draft.systemone_config?.model ?? 'jev-latest'}
                    onChange={(e) => {
                      const cur = draft.systemone_config || {
                        enabled: false,
                        url: 'https://api.typesafe.ai',
                        api_key: '',
                        model: 'jev-latest',
                        timeout_seconds: 5.0,
                      }
                      updateDraft({
                        systemone_config: { ...cur, model: e.target.value },
                      })
                    }}
                    placeholder="jev-latest"
                    className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                  <p className="text-[10px] text-slate-500">e.g. jev-latest, jev-turbo, or custom checkpoint</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Timeout (Seconds)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={0.5}
                    value={draft.systemone_config?.timeout_seconds ?? 5.0}
                    onChange={(e) => {
                      const cur = draft.systemone_config || {
                        enabled: false,
                        url: 'https://api.typesafe.ai',
                        api_key: '',
                        model: 'jev-latest',
                        timeout_seconds: 5.0,
                      }
                      updateDraft({
                        systemone_config: {
                          ...cur,
                          timeout_seconds: parseFloat(e.target.value) || 5.0,
                        },
                      })
                    }}
                    className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                  />
                  <p className="text-[10px] text-slate-500">Strict cutoff before fallback triggers</p>
                </div>
              </div>

              {/* Test Connection Probe */}
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={testSystemOne}
                  disabled={s1Testing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer shadow-sm shadow-purple-600/30"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  {s1Testing ? 'Pinging SystemOne...' : 'Test Connection'}
                </button>

                {s1TestResult && (
                  <div
                    className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-2 ${
                      s1TestResult.success
                        ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-700/50 text-rose-300'
                    }`}
                  >
                    {s1TestResult.success ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Connected! {s1TestResult.latency_ms}ms · {s1TestResult.model}</span>
                      </>
                    ) : (
                      <>
                        <X className="w-3.5 h-3.5 text-rose-400" />
                        <span>{s1TestResult.error}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right 5 cols: Architecture & Behavioral Notes */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col gap-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400">
                How SystemOne Routing Works
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Rather than relying on free-form LLM text generation to decide routing, SystemOne evaluates mathematical choice criteria across candidate models and reasoning efforts:
              </p>
              <ul className="text-xs text-slate-400 space-y-2 list-disc pl-4">
                <li>
                  <strong className="text-slate-200">Per-Rule Activation:</strong> In the <strong className="text-slate-200">Lane × Agent Matrix</strong>, switch on "SystemOne Routing" for any rule (e.g. In Progress, Review).
                </li>
                <li>
                  <strong className="text-slate-200">Task Scope Ingestion:</strong> Before an agent spawns, Kanbanana serializes the story files, do/done-when criteria, and token ceiling into SystemOne.
                </li>
                <li>
                  <strong className="text-slate-200">Cost &amp; Quality Optimization:</strong> SystemOne outputs the highest-confidence model that can solve the ticket without wasting reasoning effort or token budget.
                </li>
                <li>
                  <strong className="text-slate-200">Resilient Fallback:</strong> If the endpoint times out or is unreachable, the system automatically falls back to your rule's default tier without halting execution.
                </li>
                <li>
                  <strong className="text-slate-200">Audit Logged:</strong> The routing decision, confidence, and latency are recorded directly in the ticket activity stream.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Global Skill Library & Custom Models */}
      {subTab === 'skills-models' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left 7 cols: Managed Global Role Skills + Auto-Discovered Host Skills */}
          <div className="xl:col-span-7 flex flex-col gap-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    Managed Role Skills (`skill://global/*/SKILL.md`)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Built-in and custom role skills served via MCP and injected into A2A prompts &amp; agent profiles.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenNewSkill}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Global Skill
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {(draft.managed_skills || []).map((skill) => {
                  const uri = `skill://global/${skill.id}/SKILL.md`
                  return (
                    <div
                      key={skill.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white">
                              {skill.name}
                            </span>
                            <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-indigo-300 border border-slate-800">
                              {skill.id}
                            </code>
                            <span
                              className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                                skill.built_in
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                              }`}
                            >
                              {skill.built_in ? 'built-in editable' : 'global custom'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {skill.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyUri(uri)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 cursor-pointer"
                            title="Copy MCP Skill Resource URI"
                          >
                            {copiedUri === uri ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            URI
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingSkill({ isNew: false, spec: { ...skill } })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-[11px] font-semibold text-indigo-200 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          {!skill.built_in && (
                            <button
                              type="button"
                              onClick={() => handleDeleteManagedSkill(skill.id)}
                              className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/60 text-rose-300 cursor-pointer"
                              title="Remove custom global skill"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-slate-800/70">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] text-slate-500 mr-1">
                            Recommended lanes:
                          </span>
                          {(skill.lane_tags || []).map((lt) => (
                            <span
                              key={lt}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800"
                            >
                              {lt}
                            </span>
                          ))}
                        </div>
                        <code className="text-[10px] font-mono text-slate-500">
                          {uri}
                        </code>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Discovered Host & A2A Skills */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-cyan-400" />
                  Auto-Discovered Agent Config &amp; A2A Skills ({discoveredExternalSkills.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automatically indexed from mounted agent config folders (`~/.claude/skills`, `/agent-configs/*`), repository `.agents/skills`, and remote A2A Agent Cards.
                </p>
              </div>

              {discoveredExternalSkills.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400">
                  No external host or A2A skills discovered yet. Mount agent config folders or scan A2A endpoints to populate.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
                  {discoveredExternalSkills.map((sk) => (
                    <div
                      key={`${sk.source}-${sk.id}`}
                      className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-semibold text-white truncate">
                          {sk.name}
                        </span>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shrink-0">
                          {sk.source}
                        </span>
                      </div>
                      <code className="text-[10px] font-mono text-indigo-300 truncate">
                        {sk.id}
                      </code>
                      {sk.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-2">
                          {sk.description}
                        </p>
                      )}
                      {sk.installed_on_agents.length > 0 && (
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          Agents: {sk.installed_on_agents.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 cols: Custom Reusable Provider Models */}
          <div className="xl:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-amber-400" />
                Reusable Custom Models per Provider
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Register new or fine-tuned model IDs (e.g., <code className="text-slate-200">grok-4.2-heavy</code>, <code className="text-slate-200">claude-opus-4-7</code>) so they appear in Agent Cards and Lane × Agent dropdowns across every project.
              </p>
            </div>

            <form
              onSubmit={handleAddCustomModel}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col gap-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Provider
                  </label>
                  <select
                    value={newModelProvider}
                    onChange={(e) => setNewModelProvider(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                  >
                    {PROVIDER_KEYS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Tier Classification
                  </label>
                  <select
                    value={newModelTier}
                    onChange={(e) => setNewModelTier(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="frontier">frontier (deep reasoning)</option>
                    <option value="mid-tier">mid-tier (balanced / review)</option>
                    <option value="fast">fast (high throughput)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Model Slug / CLI `--model` ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    placeholder="e.g. grok-4.2-reasoning"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder="e.g. Grok 4.2 Reasoning"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newModelSupportsEffort}
                    onChange={(e) => setNewModelSupportsEffort(e.target.checked)}
                  />
                  Supports `--effort` (`low` / `medium` / `high`)
                </label>

                {newModelSupportsEffort && (
                  <select
                    value={newModelDefaultEffort}
                    onChange={(e) => setNewModelDefaultEffort(e.target.value)}
                    className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-mono text-amber-300"
                  >
                    <option value="low">Default: low</option>
                    <option value="medium">Default: medium</option>
                    <option value="high">Default: high</option>
                  </select>
                )}
              </div>

              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-semibold text-amber-200 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Custom Model to Provider Catalog
              </button>
            </form>

            {/* Existing Custom Models List */}
            <div className="flex flex-col gap-2.5">
              {Object.entries(draft.custom_models || {}).length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
                  No custom provider models added yet. Built-in presets for Claude, Grok, Gemini/Antigravity, Codex, Kimi, and MiniMax are active by default.
                </div>
              ) : (
                Object.entries(draft.custom_models || {}).map(([prov, models]) => (
                  <div
                    key={prov}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex flex-col gap-2"
                  >
                    <div className="text-xs font-bold uppercase tracking-wider text-indigo-300 font-mono">
                      Provider: {prov}
                    </div>
                    {models.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-white">
                              {m.name}
                            </span>
                            <code className="text-[10px] font-mono text-purple-300">
                              {m.id}
                            </code>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                              {m.tier}
                            </span>
                            {m.supports_effort && (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                                effort: {m.default_effort || 'medium'}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomModel(prov, m.id)}
                          className="p-1 rounded hover:bg-rose-950 text-slate-400 hover:text-rose-300 cursor-pointer"
                          title="Delete custom model"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Coordinator, Auth & A2A Network */}
      {subTab === 'network' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: Client Bearer Auth + MCP Coordinator URL */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">
                Browser API Authentication &amp; MCP Coordinator Endpoint
              </h3>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col gap-2.5">
              <label className="text-xs font-semibold text-slate-200">
                Client Bearer Token (`KANBANANA_API_TOKEN`)
              </label>
              <p className="text-[11px] text-slate-400">
                Stored locally in your browser (`localStorage`) and sent via `Authorization: Bearer` on REST &amp; WebSocket requests when the backend requires authentication.
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showApiToken ? 'text' : 'password'}
                    value={apiTokenInput}
                    onChange={(e) => setApiTokenInput(e.target.value)}
                    placeholder="Leave blank when running local unauthenticated mode"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 pl-3 pr-9 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showApiToken ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSaveApiToken}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white cursor-pointer shrink-0"
                >
                  Save Token
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 font-semibold mb-1">
                Default MCP HTTP Endpoint URL (injected into Agent Profiles)
              </label>
              <input
                type="text"
                value={draft.mcp_url || ''}
                onChange={(e) => updateDraft({ mcp_url: e.target.value })}
                placeholder="http://localhost:8765/mcp"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white"
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5 flex flex-col gap-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Fleet-Wide Dispatch &amp; Worktree Defaults
              </div>
              <label className="inline-flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.default_dispatch_via_a2a}
                  onChange={(e) =>
                    updateDraft({ default_dispatch_via_a2a: e.target.checked })
                  }
                />
                Dispatch claimed tasks via A2A JSON-RPC 2.0 (`tasks/send`) by default
              </label>
              <label className="inline-flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.default_auto_create_worktree}
                  onChange={(e) =>
                    updateDraft({ default_auto_create_worktree: e.target.checked })
                  }
                />
                Auto-provision isolated `git worktree` when claiming implementation tickets
              </label>
              <label className="inline-flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.default_launch_subprocess}
                  onChange={(e) =>
                    updateDraft({ default_launch_subprocess: e.target.checked })
                  }
                />
                Spawn local Agent CLI subprocess automatically during lane auto-dispatch
              </label>
            </div>
          </div>

          {/* Right: Remote A2A Discovery Endpoints */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                Remote A2A Discovery Endpoints (`/.well-known/agent.json`)
              </h3>
            </div>

            <p className="text-xs text-slate-400">
              Configure persistent remote agent sidecar URLs probed during A2A discovery scans alongside local Docker/host agent profiles.
            </p>

            <label className="inline-flex items-center gap-2.5 text-xs text-cyan-300 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={draft.auto_scan_a2a}
                onChange={(e) => updateDraft({ auto_scan_a2a: e.target.checked })}
              />
              Auto-scan A2A endpoints when opening the Claim / Dispatch modal
            </label>

            <div className="flex gap-2">
              <input
                type="text"
                value={newEndpointInput}
                onChange={(e) => setNewEndpointInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddEndpoint()
                  }
                }}
                placeholder="http://remote-agent-1:8090"
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
              />
              <button
                type="button"
                onClick={handleAddEndpoint}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add URL
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {(draft.a2a_scan_endpoints || []).length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-400">
                  No persistent remote A2A URLs configured. Local &amp; Docker-mounted agent profiles remain auto-detected.
                </div>
              ) : (
                (draft.a2a_scan_endpoints || []).map((ep) => (
                  <div
                    key={ep}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2"
                  >
                    <code className="text-xs font-mono text-cyan-300 truncate">
                      {ep}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        updateDraft({
                          a2a_scan_endpoints: (draft.a2a_scan_endpoints || []).filter(
                            (x) => x !== ep,
                          ),
                        })
                      }
                      className="p-1 rounded hover:bg-rose-950 text-slate-400 hover:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Overnight HUD & UI Defaults */}
      {subTab === 'hud' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Token Budget Guardrail */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                Default Overnight Token Ceiling &amp; Circuit Breaker
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              Sets the default fleet token budget guardrail in the Overnight HUD before auto-pausing new dispatches (individual projects can override this in Project Settings).
            </p>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold">
                  Fleet Token Ceiling
                </span>
                <span className="text-sm font-mono font-bold text-emerald-300">
                  {(draft.default_token_ceiling / 1_000_000).toFixed(2)}M tokens
                </span>
              </div>
              <input
                type="range"
                min={250_000}
                max={10_000_000}
                step={250_000}
                value={draft.default_token_ceiling}
                onChange={(e) =>
                  updateDraft({ default_token_ceiling: Number(e.target.value) })
                }
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex items-center gap-2 flex-wrap">
                {[500_000, 1_000_000, 1_500_000, 2_500_000, 5_000_000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => updateDraft({ default_token_ceiling: preset })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer ${
                      draft.default_token_ceiling === preset
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    {(preset / 1_000_000).toFixed(1)}M
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-2.5">
              <div className="text-xs font-semibold text-white">
                Visual Fighter Avatars
              </div>
              <label className="inline-flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.fighter_avatars_enabled}
                  onChange={(e) =>
                    updateDraft({ fighter_avatars_enabled: e.target.checked })
                  }
                />
                Show animated pixel-art fighter avatars on the Agents &amp; Live Activity tab
              </label>
            </div>
          </div>

          {/* 174 BPM Neurofunk WebAudio Synth Defaults */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                Overnight HUD WebAudio Synth Defaults (`v1.2-neuro`)
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              Control default audio cues and the 174 BPM Drum &amp; Bass Reese drop when a ticket cleanly passes review and merges.
            </p>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-3">
              <label className="inline-flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.hud_pr_drop_enabled}
                  onChange={(e) =>
                    updateDraft({ hud_pr_drop_enabled: e.target.checked })
                  }
                />
                Enable 174 BPM Neurofunk Reese Bass Drop when PR passes review &amp; merges
              </label>

              <label className="inline-flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.hud_neuro_audio_armed_default}
                  onChange={(e) =>
                    updateDraft({
                      hud_neuro_audio_armed_default: e.target.checked,
                    })
                  }
                />
                Pre-arm HUD WebAudio cues when opening Overnight HUD
              </label>

              <div className="pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-300">Default Synth Volume</span>
                  <span className="text-xs font-mono text-cyan-300">
                    {Math.round((draft.hud_neuro_volume ?? 0.78) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.01}
                  value={draft.hud_neuro_volume ?? 0.78}
                  onChange={(e) =>
                    updateDraft({ hud_neuro_volume: Number(e.target.value) })
                  }
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Managed Skill Create/Edit Modal */}
      {editingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveSkillModal}
            className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                {editingSkill.isNew
                  ? 'Create Global Role Skill'
                  : `Edit Global Skill · ${editingSkill.spec.id}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingSkill(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Skill Slug ID *
                </label>
                <input
                  type="text"
                  required
                  disabled={!editingSkill.isNew}
                  value={editingSkill.spec.id}
                  onChange={(e) =>
                    setEditingSkill({
                      ...editingSkill,
                      spec: { ...editingSkill.spec, id: e.target.value },
                    })
                  }
                  placeholder="e.g. strict-qa-audit"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  required
                  value={editingSkill.spec.name}
                  onChange={(e) =>
                    setEditingSkill({
                      ...editingSkill,
                      spec: { ...editingSkill.spec, name: e.target.value },
                    })
                  }
                  placeholder="e.g. Strict QA & Regression Audit"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Short Description
              </label>
              <input
                type="text"
                value={editingSkill.spec.description}
                onChange={(e) =>
                  setEditingSkill({
                    ...editingSkill,
                    spec: { ...editingSkill.spec, description: e.target.value },
                  })
                }
                placeholder="When an agent runs this skill, what should it focus on?"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Recommended Kanban Lanes
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {LANE_META.map((lm) => {
                  const active = (editingSkill.spec.lane_tags || []).includes(
                    lm.lane,
                  )
                  return (
                    <button
                      key={lm.lane}
                      type="button"
                      onClick={() => {
                        const prev = editingSkill.spec.lane_tags || []
                        const next = active
                          ? prev.filter((x) => x !== lm.lane)
                          : [...prev, lm.lane as ConfigurableLane]
                        setEditingSkill({
                          ...editingSkill,
                          spec: { ...editingSkill.spec, lane_tags: next },
                        })
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer ${
                        active
                          ? lm.badgeClass
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      {lm.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                `SKILL.md` Instructions (Markdown)
              </label>
              <textarea
                rows={12}
                required
                value={editingSkill.spec.content_md}
                onChange={(e) =>
                  setEditingSkill({
                    ...editingSkill,
                    spec: { ...editingSkill.spec, content_md: e.target.value },
                  })
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-100 leading-relaxed"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingSkill(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white cursor-pointer"
              >
                Apply Skill to Draft
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/50'
              : toast.type === 'error'
                ? 'bg-rose-950/95 text-rose-200 border-rose-500/50'
                : 'bg-slate-900/95 text-white border-slate-700'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}
