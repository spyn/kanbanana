import React, { useEffect, useState } from 'react'
import { Check, Copy, Download, FileCode2, Save, FileJson, Sparkles } from 'lucide-react'
import { api, type ProjectPreset } from '../api'
import type { Project, SkillConfig } from '../types'

interface ProjectSkillProps {
  project: Project
  onUpdated: () => void
}

export const ProjectSkill: React.FC<ProjectSkillProps> = ({ project, onUpdated }) => {
  const [skillMd, setSkillMd] = useState<string>('')
  const [reviewSkillMd, setReviewSkillMd] = useState<string>('')
  const [activeSkillTab, setActiveSkillTab] = useState<'board' | 'review'>('board')
  const [cfg, setCfg] = useState<SkillConfig>(project.skill_config)
  const [copied, setCopied] = useState(false)
  const [exportStatus, setExportStatus] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Presets & JSON Export/Import
  const [presets, setPresets] = useState<ProjectPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [loadingPreset, setLoadingPreset] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    setCfg(project.skill_config)
    api.getSkillMd(project.slug).then(setSkillMd).catch(console.error)
    api.getCodeReviewSkillMd(project.slug).then(setReviewSkillMd).catch(console.error)
    api.listProjectPresets().then(setPresets).catch(console.error)
  }, [project])

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updateProject(project.slug, { skill_config: cfg })
      const [freshMd, freshRevMd] = await Promise.all([
        api.getSkillMd(project.slug),
        api.getCodeReviewSkillMd(project.slug),
      ])
      setSkillMd(freshMd)
      setReviewSkillMd(freshRevMd)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(activeSkillTab === 'board' ? skillMd : reviewSkillMd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExportToDisk = async () => {
    setExportStatus('Writing...')
    try {
      const target =
        cfg.skill_output_path || `.agents/skills/${project.slug}-board/SKILL.md`
      const res = await api.exportSkillMd(project.slug, target)
      setExportStatus(`Saved to ${res.written_to} (${res.bytes} bytes)`)
    } catch (e: any) {
      setExportStatus(`Error: ${e.message}`)
    }
  }

  const handleExportConfigJson = async () => {
    try {
      const data = await api.exportProjectConfig(project.slug)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.slug}-config.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('success', `Exported ${project.slug}-config.json successfully`)
    } catch (e: any) {
      showToast('error', `Export failed: ${e.message}`)
    }
  }

  const handleApplyPreset = async () => {
    if (!selectedPreset) return
    if (!confirm(`Apply preset '${selectedPreset}' to this project? This will update settings, sections, and locks.`)) return
    setLoadingPreset(true)
    try {
      await api.importProjectConfig({ preset_name: selectedPreset })
      showToast('success', `Preset '${selectedPreset}' successfully loaded!`)
      onUpdated()
    } catch (e: any) {
      showToast('error', `Failed to apply preset: ${e.message}`)
    } finally {
      setLoadingPreset(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Left: Project Skill Configuration Editor */}
      <form
        onSubmit={handleSaveConfig}
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">
              Agent Onboarding & `SKILL.md` Config
            </h3>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save & Regenerate
          </button>
        </div>

        {/* Project Preset Selector & Export Config */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-white">Preset:</span>
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-white"
            >
              <option value="">Choose preset...</option>
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
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs text-white border border-slate-700 cursor-pointer"
            >
              {loadingPreset ? 'Loading...' : 'Apply Preset'}
            </button>
          </div>
          <button
            type="button"
            onClick={handleExportConfigJson}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 cursor-pointer"
          >
            <FileJson className="w-3.5 h-3.5 text-cyan-400" />
            Export Project (JSON)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Skill Name</label>
            <input
              type="text"
              value={cfg.skill_name || ''}
              onChange={(e) => setCfg({ ...cfg, skill_name: e.target.value })}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Hindsight MCP URL</label>
            <input
              type="text"
              value={cfg.hindsight_url || ''}
              onChange={(e) => setCfg({ ...cfg, hindsight_url: e.target.value })}
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
            value={cfg.graphify_graph_path || ''}
            onChange={(e) => setCfg({ ...cfg, graphify_graph_path: e.target.value })}
            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Local Memory Directory Path
          </label>
          <input
            type="text"
            value={cfg.local_memory_dir || ''}
            onChange={(e) => setCfg({ ...cfg, local_memory_dir: e.target.value })}
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
              value={cfg.skill_output_path || ''}
              onChange={(e) => setCfg({ ...cfg, skill_output_path: e.target.value })}
              placeholder={`~/.claude/skills/${project.slug}-board/SKILL.md`}
              className="flex-1 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
            />
            <button
              type="button"
              onClick={handleExportToDisk}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Write to Disk
            </button>
          </div>
          {exportStatus && (
            <p className="text-[11px] font-mono text-emerald-300 mt-1">{exportStatus}</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Project-Specific Rules (Hardware, Exactness, RPC Workers)
          </label>
          <textarea
            rows={10}
            value={cfg.custom_rules_md || ''}
            onChange={(e) => setCfg({ ...cfg, custom_rules_md: e.target.value })}
            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-white leading-relaxed"
          />
        </div>
      </form>

      {/* Right: Live Generated SKILL.md & CODE_REVIEW_SKILL.md Preview */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveSkillTab('board')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeSkillTab === 'board'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📋 Board `SKILL.md`
            </button>
            <button
              type="button"
              onClick={() => setActiveSkillTab('review')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeSkillTab === 'review'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🛡️ Code Review `CODE_REVIEW_SKILL.md`
            </button>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Markdown'}
          </button>
        </div>

        <p className="text-xs text-slate-400">
          {activeSkillTab === 'board' ? (
            <>
              Served via MCP <code className="text-indigo-300">skill://{project.slug}/SKILL.md</code> and HTTP <code className="text-indigo-300">/api/projects/{project.slug}/skill.md</code>
            </>
          ) : (
            <>
              Mid-tier model review + merge gate served via MCP <code className="text-emerald-300">skill://{project.slug}/CODE_REVIEW_SKILL.md</code> and HTTP <code className="text-emerald-300">/api/projects/{project.slug}/code-review-skill.md</code>
            </>
          )}
        </p>

        <pre className="whitespace-pre-wrap font-mono text-xs text-slate-200 bg-slate-950 p-4 rounded-xl border border-slate-800 max-h-[680px] overflow-y-auto leading-relaxed">
          {activeSkillTab === 'board' ? skillMd : reviewSkillMd}
        </pre>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/50 shadow-emerald-950/50'
              : toast.type === 'error'
                ? 'bg-rose-950/95 text-rose-200 border-rose-500/50 shadow-rose-950/50'
                : 'bg-slate-900/95 text-white border-slate-700 shadow-black/50'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}
