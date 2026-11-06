import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  FolderGit2,
  Layers,
  Play,
  Plus,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { api, type ProjectPreset } from '../api'
import {
  LaneAgentMatrixEditor,
  LANE_META,
  STANDARD_FLEET_AGENTS,
} from './LaneAgentMatrixEditor'
import type {
  AgentProfile,
  ConfigurableLane,
  GlobalSettings,
  ManagedSkillSpec,
  Project,
  ProjectSettings,
  ResolvedLaneRoutingPlan,
  Section,
  SkillCatalogItem,
  SkillConfig,
} from '../types'

interface ProjectSettingsPageProps {
  project: Project
  globalSettings: GlobalSettings | null
  agentProfiles: AgentProfile[]
  skillsCatalog: SkillCatalogItem[]
  canDeleteProject: boolean
  onUpdated: () => void
  onDeletedProject: (deletedSlug: string) => void
  onOpenGlobalSettings?: () => void
}

type ProjectSubTab = 'matrix' | 'systemone' | 'general' | 'skills' | 'sections-guardrails'

function defaultProjectSettings(): ProjectSettings {
  return {
    branch_prefix: 'board/',
    token_ceiling_override: null,
    require_verification_cmd: '',
    auto_create_worktree: null,
    dispatch_via_a2a: null,
    lane_configs: {},
    custom_skills: [],
    systemone_config: null,
  }
}

function slugifySkillId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const ProjectSettingsPage: React.FC<ProjectSettingsPageProps> = ({
  project,
  globalSettings,
  agentProfiles,
  skillsCatalog,
  canDeleteProject,
  onUpdated,
  onDeletedProject,
  onOpenGlobalSettings,
}) => {
  const [subTab, setSubTab] = useState<ProjectSubTab>('matrix')

  // Core project fields
  const [projName, setProjName] = useState<string>(project.name)
  const [projDesc, setProjDesc] = useState<string>(project.description || '')
  const [repoPath, setRepoPath] = useState<string>(project.repo_path || '')
  const [worktreesDir, setWorktreesDir] = useState<string>(project.worktrees_dir || '')
  const [boardBgMd, setBoardBgMd] = useState<string>(project.board_background_md || '')
  const [skillCfg, setSkillCfg] = useState<SkillConfig>(project.skill_config)
  const [projSettings, setProjSettings] = useState<ProjectSettings>(
    project.project_settings || defaultProjectSettings(),
  )

  const [dirty, setDirty] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)

  // Live SKILL.md & CODE_REVIEW_SKILL.md preview
  const [skillMd, setSkillMd] = useState<string>('')
  const [reviewSkillMd, setReviewSkillMd] = useState<string>('')
  const [activeSkillPreviewTab, setActiveSkillPreviewTab] = useState<'board' | 'review'>(
    'board',
  )
  const [copiedMd, setCopiedMd] = useState<boolean>(false)
  const [copiedUri, setCopiedUri] = useState<string>('')
  const [exportStatus, setExportStatus] = useState<string>('')

  // Presets & JSON Import/Export
  const [presets, setPresets] = useState<ProjectPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [loadingPreset, setLoadingPreset] = useState<boolean>(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Project Custom Skill Modal
  const [editingCustomSkill, setEditingCustomSkill] = useState<{
    isNew: boolean
    spec: ManagedSkillSpec
  } | null>(null)

  // Sections Editor
  const [secCode, setSecCode] = useState<string>('')
  const [secTitle, setSecTitle] = useState<string>('')
  const [secDesc, setSecDesc] = useState<string>('')
  const [secPos, setSecPos] = useState<number>(0)
  const [savingSection, setSavingSection] = useState<boolean>(false)

  // Live Routing Plan Simulator
  const [simLane, setSimLane] = useState<ConfigurableLane>('review')
  const [simAgent, setSimAgent] = useState<string>('grok-cli')
  const [simTicketOwner, setSimTicketOwner] = useState<string>('')
  const [simPlan, setSimPlan] = useState<ResolvedLaneRoutingPlan | null>(null)
  const [simLoading, setSimLoading] = useState<boolean>(false)

  // Delete project confirmation
  const [deleteConfirmSlug, setDeleteConfirmSlug] = useState<string>('')
  const [deletingProject, setDeletingProject] = useState<boolean>(false)

  // SystemOne router test state for project
  const [s1Testing, setS1Testing] = useState<boolean>(false)
  const [s1TestResult, setS1TestResult] = useState<{
    success: boolean
    latency_ms?: number
    model?: string
    error?: string
  } | null>(null)
  const [showS1ApiKey, setShowS1ApiKey] = useState<boolean>(false)

  const testSystemOne = async () => {
    const effective =
      projSettings.systemone_config?.enabled !== undefined
        ? projSettings.systemone_config
        : globalSettings?.systemone_config || {
            enabled: false,
            url: 'https://api.typesafe.ai',
            api_key: '',
            model: 'jev-latest',
            timeout_seconds: 5.0,
          }

    setS1Testing(true)
    setS1TestResult(null)
    try {
      const res = await api.testSystemOneConnection({
        url: effective.url || 'https://api.typesafe.ai',
        api_key: effective.api_key || null,
        model: effective.model || 'jev-latest',
        timeout_seconds: effective.timeout_seconds || 5.0,
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

  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info'
    text: string
  } | null>(null)

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text })
    window.setTimeout(() => setToast(null), 4000)
  }

  const refreshSkillMarkdowns = useCallback((slug: string) => {
    api.getSkillMd(slug).then(setSkillMd).catch(console.error)
    api.getCodeReviewSkillMd(slug).then(setReviewSkillMd).catch(console.error)
  }, [])

  useEffect(() => {
    setProjName(project.name)
    setProjDesc(project.description || '')
    setRepoPath(project.repo_path || '')
    setWorktreesDir(project.worktrees_dir || '')
    setBoardBgMd(project.board_background_md || '')
    setSkillCfg(project.skill_config)
    setProjSettings(project.project_settings || defaultProjectSettings())
    setDirty(false)
    setDeleteConfirmSlug('')
    refreshSkillMarkdowns(project.slug)
    api.listProjectPresets().then(setPresets).catch(console.error)
  }, [project, refreshSkillMarkdowns])

  const updateSettings = (patch: Partial<ProjectSettings>) => {
    setProjSettings((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }

  const runRoutingSimulator = useCallback(async () => {
    setSimLoading(true)
    try {
      const plan = await api.resolveProjectLaneRouting(project.slug, {
        lane: simLane,
        agent_id: simAgent,
        ticket_owner: simTicketOwner.trim() || undefined,
      })
      setSimPlan(plan)
    } catch {
      // ignore transient error
    } finally {
      setSimLoading(false)
    }
  }, [project.slug, simLane, simAgent, simTicketOwner])

  useEffect(() => {
    void runRoutingSimulator()
  }, [runRoutingSimulator, project.project_settings, globalSettings])

  const handleSaveProjectAll = async () => {
    setSaving(true)
    try {
      await api.updateProject(project.slug, {
        name: projName.trim() || project.name,
        description: projDesc,
        repo_path: repoPath.trim(),
        worktrees_dir: worktreesDir.trim(),
        board_background_md: boardBgMd,
        skill_config: skillCfg,
        project_settings: projSettings,
      })
      setDirty(false)
      refreshSkillMarkdowns(project.slug)
      onUpdated()
      await runRoutingSimulator()
      showToast('success', `Saved settings & routing matrix for ${project.slug}`)
    } catch (e: any) {
      showToast('error', `Failed to save project settings: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Merge catalog so unsaved custom_skills in projSettings immediately show in the matrix skill picker
  const effectiveSkillsCatalog = useMemo<SkillCatalogItem[]>(() => {
    const byId = new Map<string, SkillCatalogItem>()
    for (const item of skillsCatalog) {
      byId.set(item.id, item)
    }
    for (const cs of projSettings.custom_skills || []) {
      byId.set(cs.id, {
        id: cs.id,
        name: cs.name,
        description: cs.description,
        source: 'project-custom',
        lane_tags: cs.lane_tags || [],
        uri: `skill://${project.slug}/skills/${cs.id}/SKILL.md`,
        http_url: `/api/projects/${project.slug}/skills/${cs.id}/SKILL.md`,
        editable: true,
        built_in: false,
        installed_on_agents: [],
        content_md: cs.content_md,
      })
    }
    return Array.from(byId.values())
  }, [skillsCatalog, projSettings.custom_skills, project.slug])

  const repoSkills = useMemo(
    () => skillsCatalog.filter((s) => s.source === 'repo'),
    [skillsCatalog],
  )

  const simulatorAgentChoices = useMemo(() => {
    const map = new Map<string, string>()
    for (const std of STANDARD_FLEET_AGENTS) {
      map.set(std.id, `${std.name} (${std.id})`)
    }
    for (const p of agentProfiles) {
      map.set(p.id, `${p.name} (${p.id})`)
    }
    return Array.from(map.entries())
  }, [agentProfiles])

  const handleExportConfigJson = async () => {
    try {
      const data = await api.exportProjectConfig(project.slug)
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.slug}-config.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('success', `Exported ${project.slug}-config.json`)
    } catch (e: any) {
      showToast('error', `Export failed: ${e.message}`)
    }
  }

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const rawText = await file.text()
      const parsed = JSON.parse(rawText)
      const res = await api.importProjectConfig({ config: parsed })
      showToast('success', `Imported config into '${res.slug}'`)
      onUpdated()
    } catch (err: any) {
      showToast('error', `JSON import failed: ${err.message}`)
    }
  }

  const handleApplyPreset = async () => {
    if (!selectedPreset) return
    if (
      !window.confirm(
        `Apply preset '${selectedPreset}'? This updates project settings, sections, and locks.`,
      )
    ) {
      return
    }
    setLoadingPreset(true)
    try {
      await api.importProjectConfig({ preset_name: selectedPreset })
      showToast('success', `Applied preset '${selectedPreset}'`)
      onUpdated()
    } catch (e: any) {
      showToast('error', `Preset failed: ${e.message}`)
    } finally {
      setLoadingPreset(false)
    }
  }

  const handleExportSkillToDisk = async () => {
    setExportStatus('Writing...')
    try {
      const target =
        skillCfg.skill_output_path || `.agents/skills/${project.slug}-board/SKILL.md`
      const res = await api.exportSkillMd(project.slug, target)
      setExportStatus(`Saved to ${res.written_to} (${res.bytes} bytes)`)
    } catch (e: any) {
      setExportStatus(`Error: ${e.message}`)
    }
  }

  const handleSaveCustomSkillModal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCustomSkill) return
    const cleanId = slugifySkillId(
      editingCustomSkill.spec.id || editingCustomSkill.spec.name,
    )
    if (!cleanId) return
    const normalized: ManagedSkillSpec = {
      ...editingCustomSkill.spec,
      id: cleanId,
      name: editingCustomSkill.spec.name.trim() || cleanId,
      description: editingCustomSkill.spec.description.trim(),
      built_in: false,
    }
    const existing = projSettings.custom_skills || []
    const idx = existing.findIndex((s) => s.id === cleanId)
    const nextList =
      idx >= 0
        ? existing.map((s, i) => (i === idx ? normalized : s))
        : [...existing, normalized]
    updateSettings({ custom_skills: nextList })
    setEditingCustomSkill(null)
  }

  const handleUpsertSection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!secCode.trim() || !secTitle.trim()) return
    setSavingSection(true)
    try {
      await api.upsertSection(project.slug, {
        code: secCode.trim().toUpperCase(),
        title: secTitle.trim(),
        description_md: secDesc,
        position: secPos,
      })
      setSecCode('')
      setSecTitle('')
      setSecDesc('')
      setSecPos((project.sections?.length || 0) + 1)
      onUpdated()
      showToast('success', 'Saved board section')
    } catch (err: any) {
      showToast('error', `Section save failed: ${err.message}`)
    } finally {
      setSavingSection(false)
    }
  }

  const handleEditExistingSection = (sec: Section) => {
    setSecCode(sec.code)
    setSecTitle(sec.title)
    setSecDesc(sec.description_md || '')
    setSecPos(sec.position || 0)
  }

  const handleDeleteSection = async (code: string) => {
    if (
      !window.confirm(
        `Delete section '${code}'? Tickets in this section will be unassigned from the section.`,
      )
    ) {
      return
    }
    try {
      await api.deleteSection(project.slug, code)
      onUpdated()
      showToast('info', `Deleted section ${code}`)
    } catch (err: any) {
      showToast('error', `Delete section failed: ${err.message}`)
    }
  }

  const handleDeleteProject = async () => {
    if (deleteConfirmSlug.trim() !== project.slug) return
    setDeletingProject(true)
    try {
      await api.deleteProject(project.slug)
      onDeletedProject(project.slug)
    } catch (err: any) {
      showToast('error', `Delete project failed: ${err.message}`)
      setDeletingProject(false)
    }
  }

  const copyUri = (uri: string) => {
    navigator.clipboard.writeText(uri)
    setCopiedUri(uri)
    window.setTimeout(() => setCopiedUri(''), 1800)
  }

  const globalDefaultCeiling = globalSettings?.default_token_ceiling ?? 1_500_000

  return (
    <div className="flex flex-col gap-5">
      {/* Top Project Settings Banner */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Settings2 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Project Settings · <span className="text-indigo-300">{project.name}</span>
            </h2>
            <code className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
              {project.slug}
            </code>
            {dirty && (
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Unsaved Changes
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure per-lane agent models &amp; skills (e.g., Claude + Business Analysis on Triage, Grok + QA/Security on Review), repository paths, custom skills, and guardrails.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {onOpenGlobalSettings && (
            <button
              type="button"
              onClick={onOpenGlobalSettings}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
            >
              Edit Global Baseline
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveProjectAll}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Project Settings'}
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
          Lane × Agent Matrix
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
          {projSettings.systemone_config ? (
            projSettings.systemone_config.enabled ? (
              <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[9px] font-mono">
                OVERRIDE (ON)
              </span>
            ) : (
              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[9px] font-mono">
                OVERRIDE (OFF)
              </span>
            )
          ) : globalSettings?.systemone_config?.enabled ? (
            <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono">
              GLOBAL (ON)
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[9px] font-mono">
              GLOBAL (OFF)
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('general')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'general'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          General &amp; Repository
        </button>

        <button
          type="button"
          onClick={() => setSubTab('skills')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'skills'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" />
          Project Skills &amp; `SKILL.md` (
          {(projSettings.custom_skills || []).length + repoSkills.length})
        </button>

        <button
          type="button"
          onClick={() => setSubTab('sections-guardrails')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            subTab === 'sections-guardrails'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
              : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:bg-slate-800/80'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Sections &amp; Guardrails ({project.sections?.length || 0})
        </button>
      </div>

      {/* SUB-TAB 1: Lane × Agent Routing Matrix + Live Simulator */}
      {subTab === 'matrix' && (
        <div className="flex flex-col gap-5">
          <LaneAgentMatrixEditor
            scope="project"
            laneConfigs={projSettings.lane_configs || {}}
            globalLaneConfigs={globalSettings?.lane_configs}
            onChange={(nextLanes) => updateSettings({ lane_configs: nextLanes })}
            agentProfiles={agentProfiles}
            skillsCatalog={effectiveSkillsCatalog}
            providerModelCatalog={globalSettings?.provider_model_catalog || {}}
            customModels={globalSettings?.custom_models || {}}
          />

          {/* Live Route Preview / Dry-Run Simulator */}
          <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/85 p-5 flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Play className="w-4 h-4 text-cyan-400" />
                  Live Routing Plan Simulator (Saved Project + Global Resolution)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Test what model, reasoning effort, skills, and self-review guard will resolve when an agent picks up a ticket in any lane.
                  {dirty && (
                    <span className="text-amber-300 ml-1 font-semibold">
                      (Click &ldquo;Save Project Settings&rdquo; above to include unsaved matrix edits in live resolution.)
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={runRoutingSimulator}
                disabled={simLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/25 hover:bg-cyan-600/40 border border-cyan-500/40 text-xs font-semibold text-cyan-200 cursor-pointer"
              >
                {simLoading ? 'Resolving...' : 'Test Route'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Ticket Lane
                </label>
                <select
                  value={simLane}
                  onChange={(e) => setSimLane(e.target.value as ConfigurableLane)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {LANE_META.map((lm) => (
                    <option key={lm.lane} value={lm.lane}>
                      {lm.label} ({lm.lane})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Claiming / Preferred Agent
                </label>
                <select
                  value={simAgent}
                  onChange={(e) => setSimAgent(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                >
                  {simulatorAgentChoices.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  PR / Ticket Author (for Review Self-Review Guard test)
                </label>
                <input
                  type="text"
                  value={simTicketOwner}
                  onChange={(e) => setSimTicketOwner(e.target.value)}
                  placeholder="Optional e.g. grok-cli"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            {simPlan && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 flex flex-col gap-2.5">
                {simPlan.self_review_prevented && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      <strong>Self-Review Guard Triggered:</strong> Ticket author matches{' '}
                      <code>{simPlan.blocked_self_review_agent}</code>. Manual claim is blocked (`HTTP 409`); auto-dispatch reroutes to fallback reviewer{' '}
                      <code className="text-emerald-300">{simPlan.agent_id || 'human operator'}</code>.
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                    Agent: <strong>{simPlan.agent_id}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-500/30 font-mono">
                    Model: <strong>{simPlan.model || '(agent default)'}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-mono">
                    Effort: <strong>{simPlan.effort || 'default'}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 font-mono">
                    Source:{' '}
                    <strong>
                      {simPlan.rule_matched
                        ? `${simPlan.rule_source} rule`
                        : `${simPlan.lane_source} lane defaults`}
                    </strong>
                  </span>
                  {simPlan.lane === 'triage' && (
                    <span className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-700/50 font-mono">
                      Breakdown: {simPlan.triage_breakdown_policy}
                    </span>
                  )}
                  {simPlan.lane === 'review' && (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 font-mono">
                      Merge Gate: {simPlan.review_merge_policy}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-400">Assigned Skills:</span>
                  {simPlan.skills.length === 0 ? (
                    <span className="text-[11px] font-mono text-slate-500">
                      (Only board SKILL.md)
                    </span>
                  ) : (
                    simPlan.skills.map((sk) => (
                      <span
                        key={sk.id}
                        className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-700/50"
                        title={sk.uri}
                      >
                        <Sparkles className="w-3 h-3" />
                        {sk.name} ({sk.id})
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB: SystemOne Router */}
      {subTab === 'systemone' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-5 h-5 text-purple-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      SystemOne Dynamic Router · Project Configuration
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      TypeSafe AI System One decision engine for intelligent task-to-model routing and reasoning effort sizing.
                    </p>
                  </div>
                </div>

                {projSettings.systemone_config && (
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={projSettings.systemone_config.enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked
                        updateSettings({
                          systemone_config: {
                            ...projSettings.systemone_config!,
                            enabled,
                          },
                        })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                )}
              </div>

              {/* Mode Selection Banner */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200">
                      Configuration Mode:
                    </span>
                    {projSettings.systemone_config ? (
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-mono border border-purple-500/40">
                        Custom Project Override Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono border border-emerald-500/40">
                        Inheriting Global Baseline
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {projSettings.systemone_config ? (
                      <button
                        type="button"
                        onClick={() => {
                          updateSettings({ systemone_config: null })
                          showToast('info', 'Reverted to Global Baseline SystemOne config')
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 cursor-pointer"
                      >
                        Revert to Global Baseline
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const base = globalSettings?.systemone_config
                          updateSettings({
                            systemone_config: {
                              enabled: base?.enabled ?? true,
                              url: base?.url || 'https://api.typesafe.ai',
                              api_key: base?.api_key || '',
                              model: base?.model || 'jev-latest',
                              timeout_seconds: base?.timeout_seconds || 5.0,
                            },
                          })
                          showToast('info', 'Created custom SystemOne project override')
                        }}
                        className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white cursor-pointer shadow-sm shadow-purple-600/30"
                      >
                        Override for This Project
                      </button>
                    )}

                    {onOpenGlobalSettings && (
                      <button
                        type="button"
                        onClick={onOpenGlobalSettings}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        Edit Global Settings
                      </button>
                    )}
                  </div>
                </div>

                {!projSettings.systemone_config && (
                  <div className="text-xs text-slate-400 bg-slate-900/60 rounded-lg p-3 border border-slate-800/80 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-300">Global State:</span>
                      {globalSettings?.systemone_config?.enabled ? (
                        <span className="text-emerald-400 font-mono text-[11px]">
                          ENABLED ({globalSettings.systemone_config.url})
                        </span>
                      ) : (
                        <span className="text-slate-500 font-mono text-[11px]">
                          DISABLED in Global Baseline
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Model: <code className="text-purple-300">{globalSettings?.systemone_config?.model || 'jev-latest'}</code> · Timeout: <code className="text-purple-300">{globalSettings?.systemone_config?.timeout_seconds ?? 5.0}s</code>
                    </div>
                  </div>
                )}
              </div>

              {/* Custom Override Form Fields */}
              {projSettings.systemone_config && (
                <>
                  {/* Endpoint URL */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      <span>API Base URL / Endpoint</span>
                      <span className="text-[10px] text-slate-500 font-normal">Default: https://api.typesafe.ai</span>
                    </label>
                    <input
                      type="text"
                      value={projSettings.systemone_config.url}
                      onChange={(e) => {
                        updateSettings({
                          systemone_config: {
                            ...projSettings.systemone_config!,
                            url: e.target.value,
                          },
                        })
                      }}
                      placeholder="https://api.typesafe.ai"
                      className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                    />
                    <p className="text-[11px] text-slate-500">
                      Must point to a TypeSafe AI System One compatible host. Standardizes to <code className="text-purple-300 font-mono">/v1/systemone</code>.
                    </p>
                  </div>

                  {/* API Key */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      <span>API Key <span className="text-slate-500 font-normal">(Optional if hosted locally/unprotected)</span></span>
                    </label>
                    <div className="relative">
                      <input
                        type={showS1ApiKey ? 'text' : 'password'}
                        value={projSettings.systemone_config.api_key || ''}
                        onChange={(e) => {
                          updateSettings({
                            systemone_config: {
                              ...projSettings.systemone_config!,
                              api_key: e.target.value,
                            },
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
                        value={projSettings.systemone_config.model}
                        onChange={(e) => {
                          updateSettings({
                            systemone_config: {
                              ...projSettings.systemone_config!,
                              model: e.target.value,
                            },
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
                        value={projSettings.systemone_config.timeout_seconds}
                        onChange={(e) => {
                          updateSettings({
                            systemone_config: {
                              ...projSettings.systemone_config!,
                              timeout_seconds: parseFloat(e.target.value) || 5.0,
                            },
                          })
                        }}
                        className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                      />
                      <p className="text-[10px] text-slate-500">Strict cutoff before fallback triggers</p>
                    </div>
                  </div>
                </>
              )}

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
                SystemOne Routing for {project.name}
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                SystemOne provides intelligent, token-budget-aware routing for tasks in this project:
              </p>
              <ul className="text-xs text-slate-400 space-y-2 list-disc pl-4">
                <li>
                  <strong className="text-slate-200">Lane Matrix Switch:</strong> In the <strong className="text-slate-200">Lane × Agent Matrix</strong> tab, edit any rule card (e.g. In Progress or Review) and enable the <strong className="text-purple-300">SystemOne Dynamic Routing</strong> switch.
                </li>
                <li>
                  <strong className="text-slate-200">Contextual Ingestion:</strong> SystemOne receives the ticket files md, story description, and acceptance criteria to select the leanest model capable of completing the work.
                </li>
                <li>
                  <strong className="text-slate-200">Project Isolation:</strong> If desired, this project can connect to a specialized SystemOne instance or custom endpoint without impacting global defaults.
                </li>
                <li>
                  <strong className="text-slate-200">Audit Trail:</strong> When an agent claims a ticket under SystemOne routing, a note is logged with the chosen model, reasoning tier, and routing latency.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: General & Repository */}
      {subTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-indigo-400" />
              Project Metadata, Repository &amp; Worktree Configuration
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={projName}
                  onChange={(e) => {
                    setProjName(e.target.value)
                    setDirty(true)
                  }}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Git Branch Prefix (used when auto-creating ticket worktrees)
                </label>
                <input
                  type="text"
                  value={projSettings.branch_prefix || 'board/'}
                  onChange={(e) => updateSettings({ branch_prefix: e.target.value })}
                  placeholder="board/"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <input
                type="text"
                value={projDesc}
                onChange={(e) => {
                  setProjDesc(e.target.value)
                  setDirty(true)
                }}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Primary Git Repository Path (`repo_path`)
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => {
                    setRepoPath(e.target.value)
                    setDirty(true)
                  }}
                  placeholder="D:\code\my-repo or /workspaces/my-repo"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Isolated Git Worktrees Directory (`worktrees_dir`)
                </label>
                <input
                  type="text"
                  value={worktreesDir}
                  onChange={(e) => {
                    setWorktreesDir(e.target.value)
                    setDirty(true)
                  }}
                  placeholder="Leave blank for default shared worktrees folder"
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Board Architectural Background (`board_background_md`)
              </label>
              <textarea
                rows={7}
                value={boardBgMd}
                onChange={(e) => {
                  setBoardBgMd(e.target.value)
                  setDirty(true)
                }}
                placeholder="High-level system architecture, repository layout, and sprint context shared with all agents..."
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-white leading-relaxed"
              />
            </div>
          </div>

          {/* Right 4 cols: Portable JSON Export/Import + Danger Zone */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-3.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileJson className="w-4 h-4 text-cyan-400" />
                Portable Config Export, Import &amp; Presets
              </h3>
              <p className="text-xs text-slate-400">
                Export or import `{project.slug}-config.json` (including your Lane × Agent Matrix, custom skills, sections, locks, and tickets).
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportConfigJson}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  Export JSON
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  Import JSON File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonFile}
                  className="hidden"
                />
              </div>

              {presets.length > 0 && (
                <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Apply Shipped Preset
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedPreset}
                      onChange={(e) => setSelectedPreset(e.target.value)}
                      className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="">Select preset...</option>
                      {presets.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.name} ({p.slug})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedPreset || loadingPreset}
                      onClick={handleApplyPreset}
                      className="px-3 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-xs font-semibold text-amber-200 disabled:opacity-50 cursor-pointer"
                    >
                      {loadingPreset ? '...' : 'Apply'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="rounded-2xl border border-rose-500/30 bg-rose-950/15 p-5 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Danger Zone
              </h3>
              {canDeleteProject ? (
                <>
                  <p className="text-xs text-slate-300">
                    Type <code className="text-rose-300 font-bold">{project.slug}</code> below to permanently delete this project, its tickets, sections, and board messages.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={deleteConfirmSlug}
                      onChange={(e) => setDeleteConfirmSlug(e.target.value)}
                      placeholder={project.slug}
                      className="flex-1 rounded-lg bg-slate-950 border border-rose-800/60 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <button
                      type="button"
                      disabled={
                        deleteConfirmSlug.trim() !== project.slug || deletingProject
                      }
                      onClick={handleDeleteProject}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs font-bold text-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingProject ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400">
                  Cannot delete the last remaining project on the Kanbanana board. Create another project first if you wish to remove `{project.slug}`.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Project Skills & SKILL.md */}
      {subTab === 'skills' && (
        <div className="flex flex-col gap-6">
          {/* Top Card: Project-Scoped Custom Skills + Repo-Discovered Skills */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Project-Specific Role Skills (`skill://{project.slug}/skills/*/SKILL.md`)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Create custom QA, domain architecture, or story-breakdown skills tailored to `{project.slug}`, or bind `.agents/skills/*` discovered from your repository.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditingCustomSkill({
                    isNew: true,
                    spec: {
                      id: '',
                      name: '',
                      description: '',
                      lane_tags: ['review'],
                      content_md: `# ${project.name} Custom Skill\n\n## Instructions\n1. Follow repository conventions.\n2. Run project verification before completing.\n`,
                      built_in: false,
                    },
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Project Skill
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(projSettings.custom_skills || []).map((cs) => {
                const uri = `skill://${project.slug}/skills/${cs.id}/SKILL.md`
                return (
                  <div
                    key={cs.id}
                    className="rounded-xl border border-purple-500/30 bg-slate-950/85 p-3.5 flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-white">{cs.name}</span>
                          <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-700/50">
                            {cs.id}
                          </code>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{cs.description}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => copyUri(uri)}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer"
                          title="Copy MCP URI"
                        >
                          {copiedUri === uri ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingCustomSkill({ isNew: false, spec: { ...cs } })
                          }
                          className="p-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 cursor-pointer"
                          title="Edit project skill"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateSettings({
                              custom_skills: (projSettings.custom_skills || []).filter(
                                (s) => s.id !== cs.id,
                              ),
                            })
                          }
                          className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/60 text-rose-300 cursor-pointer"
                          title="Delete project skill"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <code className="text-[10px] font-mono text-slate-500 truncate">
                      {uri}
                    </code>
                  </div>
                )
              })}

              {repoSkills.map((rs) => (
                <div
                  key={`repo-${rs.id}`}
                  className="rounded-xl border border-emerald-500/30 bg-slate-950/85 p-3.5 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">{rs.name}</span>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      repo `.agents/skills`
                    </span>
                  </div>
                  <code className="text-[10px] font-mono text-emerald-300">{rs.id}</code>
                  {rs.description && (
                    <p className="text-xs text-slate-400 line-clamp-2">{rs.description}</p>
                  )}
                </div>
              ))}

              {(projSettings.custom_skills || []).length === 0 &&
                repoSkills.length === 0 && (
                  <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
                    No project-specific custom skills or repo `.agents/skills` yet. Global built-in skills (`business-analysis`, `qa-verification`, `security-code-review`, etc.) are automatically available in the Lane × Agent Matrix.
                  </div>
                )}
            </div>
          </div>

          {/* Bottom 2-col: Board SKILL.md Config + Live Markdown Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">
                  Agent Onboarding &amp; `SKILL.md` Generator Config
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Skill Name</label>
                  <input
                    type="text"
                    value={skillCfg.skill_name || ''}
                    onChange={(e) => {
                      setSkillCfg({ ...skillCfg, skill_name: e.target.value })
                      setDirty(true)
                    }}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Hindsight MCP URL
                  </label>
                  <input
                    type="text"
                    value={skillCfg.hindsight_url || ''}
                    onChange={(e) => {
                      setSkillCfg({ ...skillCfg, hindsight_url: e.target.value })
                      setDirty(true)
                    }}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Graphify Graph JSON Path
                </label>
                <input
                  type="text"
                  value={skillCfg.graphify_graph_path || ''}
                  onChange={(e) => {
                    setSkillCfg({ ...skillCfg, graphify_graph_path: e.target.value })
                    setDirty(true)
                  }}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Local Memory Directory Path
                </label>
                <input
                  type="text"
                  value={skillCfg.local_memory_dir || ''}
                  onChange={(e) => {
                    setSkillCfg({ ...skillCfg, local_memory_dir: e.target.value })
                    setDirty(true)
                  }}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Disk Export Path for `SKILL.md`
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={skillCfg.skill_output_path || ''}
                    onChange={(e) => {
                      setSkillCfg({ ...skillCfg, skill_output_path: e.target.value })
                      setDirty(true)
                    }}
                    placeholder={`.agents/skills/${project.slug}-board/SKILL.md`}
                    className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onClick={handleExportSkillToDisk}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Write to Disk
                  </button>
                </div>
                {exportStatus && (
                  <p className="text-[11px] font-mono text-emerald-300 mt-1">
                    {exportStatus}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Project-Specific Rules (Architecture, Exactness, Verification)
                </label>
                <textarea
                  rows={10}
                  value={skillCfg.custom_rules_md || ''}
                  onChange={(e) => {
                    setSkillCfg({ ...skillCfg, custom_rules_md: e.target.value })
                    setDirty(true)
                  }}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-white leading-relaxed"
                />
              </div>
            </div>

            {/* Right: Live SKILL.md & CODE_REVIEW_SKILL.md Preview */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setActiveSkillPreviewTab('board')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      activeSkillPreviewTab === 'board'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Board `SKILL.md`
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSkillPreviewTab('review')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      activeSkillPreviewTab === 'review'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Code Review `CODE_REVIEW_SKILL.md`
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      activeSkillPreviewTab === 'board' ? skillMd : reviewSkillMd,
                    )
                    setCopiedMd(true)
                    window.setTimeout(() => setCopiedMd(false), 2000)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
                >
                  {copiedMd ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedMd ? 'Copied!' : 'Copy Markdown'}
                </button>
              </div>

              <p className="text-xs text-slate-400">
                {activeSkillPreviewTab === 'board' ? (
                  <>
                    Served via MCP{' '}
                    <code className="text-indigo-300">
                      skill://{project.slug}/SKILL.md
                    </code>{' '}
                    (includes the live Agent × Lane Routing Matrix)
                  </>
                ) : (
                  <>
                    Served via MCP{' '}
                    <code className="text-emerald-300">
                      skill://{project.slug}/CODE_REVIEW_SKILL.md
                    </code>
                  </>
                )}
              </p>

              <pre className="whitespace-pre-wrap font-mono text-xs text-slate-200 bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-[620px] overflow-y-auto leading-relaxed">
                {activeSkillPreviewTab === 'board' ? skillMd : reviewSkillMd}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Sections & Guardrails */}
      {subTab === 'sections-guardrails' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: Board Sections Manager */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Board Sections (`project.sections`)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Organize tickets by subsystem or epic (e.g., `CORE`, `API`, `HUD`, `QA`).
              </p>
            </div>

            <form
              onSubmit={handleUpsertSection}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col gap-2.5"
            >
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={secCode}
                    onChange={(e) => setSecCode(e.target.value)}
                    placeholder="CORE"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono uppercase text-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Section Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={secTitle}
                    onChange={(e) => setSecTitle(e.target.value)}
                    placeholder="Core Architecture & Engine"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-3">
                  <input
                    type="text"
                    value={secDesc}
                    onChange={(e) => setSecDesc(e.target.value)}
                    placeholder="Optional description..."
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <input
                    type="number"
                    value={secPos}
                    onChange={(e) => setSecPos(Number(e.target.value))}
                    placeholder="Order"
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSection}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingSection ? 'Saving...' : 'Create / Update Section'}
              </button>
            </form>

            <div className="flex flex-col gap-2">
              {(project.sections || []).length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-400">
                  No sections defined yet.
                </div>
              ) : (
                (project.sections || []).map((sec) => (
                  <div
                    key={sec.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {sec.code}
                        </code>
                        <span className="text-xs font-semibold text-white">
                          {sec.title}
                        </span>
                      </div>
                      {sec.description_md && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {sec.description_md}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEditExistingSection(sec)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                        title="Load into form to edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSection(sec.code)}
                        className="p-1.5 rounded-lg hover:bg-rose-950 text-slate-400 hover:text-rose-300 cursor-pointer"
                        title="Delete section"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Per-Project Guardrails & Overrides */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Project Guardrails &amp; Execution Overrides
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Override fleet-wide verification commands, Overnight HUD token budgets, and worktree/A2A behavior for `{project.slug}`.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">
                Required Pre-Review Verification Command (`require_verification_cmd`)
              </label>
              <p className="text-[11px] text-slate-400 mb-1.5">
                Injected into implementation prompts, review checklists, and `SKILL.md` so agents run your exact test/typecheck command before moving tickets to `review`.
              </p>
              <input
                type="text"
                value={projSettings.require_verification_cmd || ''}
                onChange={(e) =>
                  updateSettings({ require_verification_cmd: e.target.value })
                }
                placeholder="e.g. cd backend && uv run pytest -q && cd ../frontend && npx tsc --noEmit"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-emerald-300"
              />
            </div>

            {/* Token Ceiling Override */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={projSettings.token_ceiling_override != null}
                    onChange={(e) =>
                      updateSettings({
                        token_ceiling_override: e.target.checked
                          ? globalDefaultCeiling
                          : null,
                      })
                    }
                  />
                  Override Overnight Token Ceiling for `{project.slug}`
                </label>
                <span className="text-xs font-mono text-emerald-300">
                  {projSettings.token_ceiling_override != null
                    ? `${(projSettings.token_ceiling_override / 1_000_000).toFixed(2)}M (Project)`
                    : `${(globalDefaultCeiling / 1_000_000).toFixed(2)}M (Global)`}
                </span>
              </div>

              {projSettings.token_ceiling_override != null && (
                <input
                  type="range"
                  min={250_000}
                  max={10_000_000}
                  step={250_000}
                  value={projSettings.token_ceiling_override}
                  onChange={(e) =>
                    updateSettings({
                      token_ceiling_override: Number(e.target.value),
                    })
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              )}
            </div>

            {/* Tri-State Worktree & A2A Dispatch Overrides */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Auto-Create Git Worktrees
                </label>
                <select
                  value={
                    projSettings.auto_create_worktree === null ||
                    projSettings.auto_create_worktree === undefined
                      ? 'inherit'
                      : projSettings.auto_create_worktree
                        ? 'true'
                        : 'false'
                  }
                  onChange={(e) =>
                    updateSettings({
                      auto_create_worktree:
                        e.target.value === 'inherit'
                          ? null
                          : e.target.value === 'true',
                    })
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                >
                  <option value="inherit">
                    Inherit Global (
                    {globalSettings?.default_auto_create_worktree !== false
                      ? 'Enabled'
                      : 'Disabled'}
                    )
                  </option>
                  <option value="true">Always Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Dispatch via A2A (`tasks/send`)
                </label>
                <select
                  value={
                    projSettings.dispatch_via_a2a === null ||
                    projSettings.dispatch_via_a2a === undefined
                      ? 'inherit'
                      : projSettings.dispatch_via_a2a
                        ? 'true'
                        : 'false'
                  }
                  onChange={(e) =>
                    updateSettings({
                      dispatch_via_a2a:
                        e.target.value === 'inherit'
                          ? null
                          : e.target.value === 'true',
                    })
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
                >
                  <option value="inherit">
                    Inherit Global (
                    {globalSettings?.default_dispatch_via_a2a !== false
                      ? 'Enabled'
                      : 'Disabled'}
                    )
                  </option>
                  <option value="true">Always Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Custom Skill Create/Edit Modal */}
      {editingCustomSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveCustomSkillModal}
            className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                {editingCustomSkill.isNew
                  ? `New Custom Skill for ${project.slug}`
                  : `Edit Project Skill · ${editingCustomSkill.spec.id}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingCustomSkill(null)}
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
                  disabled={!editingCustomSkill.isNew}
                  value={editingCustomSkill.spec.id}
                  onChange={(e) =>
                    setEditingCustomSkill({
                      ...editingCustomSkill,
                      spec: { ...editingCustomSkill.spec, id: e.target.value },
                    })
                  }
                  placeholder="e.g. grok-api-contract-qa"
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
                  value={editingCustomSkill.spec.name}
                  onChange={(e) =>
                    setEditingCustomSkill({
                      ...editingCustomSkill,
                      spec: { ...editingCustomSkill.spec, name: e.target.value },
                    })
                  }
                  placeholder="e.g. API Contract & Regression QA"
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
                value={editingCustomSkill.spec.description}
                onChange={(e) =>
                  setEditingCustomSkill({
                    ...editingCustomSkill,
                    spec: {
                      ...editingCustomSkill.spec,
                      description: e.target.value,
                    },
                  })
                }
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Recommended Kanban Lanes
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {LANE_META.map((lm) => {
                  const active = (
                    editingCustomSkill.spec.lane_tags || []
                  ).includes(lm.lane)
                  return (
                    <button
                      key={lm.lane}
                      type="button"
                      onClick={() => {
                        const prev = editingCustomSkill.spec.lane_tags || []
                        const next = active
                          ? prev.filter((x) => x !== lm.lane)
                          : [...prev, lm.lane as ConfigurableLane]
                        setEditingCustomSkill({
                          ...editingCustomSkill,
                          spec: { ...editingCustomSkill.spec, lane_tags: next },
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
                value={editingCustomSkill.spec.content_md}
                onChange={(e) =>
                  setEditingCustomSkill({
                    ...editingCustomSkill,
                    spec: {
                      ...editingCustomSkill.spec,
                      content_md: e.target.value,
                    },
                  })
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-100 leading-relaxed"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingCustomSkill(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white cursor-pointer"
              >
                Apply Project Skill
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
