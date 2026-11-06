import React, { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  FileCode2,
  ListTodo,
  Loader2,
  Mic,
  Send,
  Sparkles,
  User,
  Wand2,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { GrillChatMessage, Ticket, TicketProposal } from '../types'

interface GrillMeDrawerProps {
  isOpen: boolean
  ticket: Ticket | null
  projectSlug: string
  onClose: () => void
  onProposalsCreated?: (updatedTicket: Ticket) => void
}

export const GrillMeDrawer: React.FC<GrillMeDrawerProps> = ({
  isOpen,
  ticket,
  projectSlug,
  onClose,
  onProposalsCreated,
}) => {
  const [messages, setMessages] = useState<GrillChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [quickReplies, setQuickReplies] = useState<string[]>([])
  const [canGenerate, setCanGenerate] = useState(false)
  const [draftProposals, setDraftProposals] = useState<TicketProposal[]>([])
  const [autoPromote, setAutoPromote] = useState(false)
  const [error, setError] = useState('')

  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && ticket) {
      loadChat()
    } else {
      setMessages([])
      setDraftProposals([])
      setCanGenerate(false)
      setError('')
    }
  }, [isOpen, ticket?.code])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const loadChat = async () => {
    if (!ticket) return
    setLoading(true)
    setError('')
    try {
      const res = await api.getGrillChat(projectSlug, ticket.code)
      setMessages(res.messages || [])
      setQuickReplies(res.suggested_quick_replies || [])
      setCanGenerate(res.can_generate_proposals || false)
      setDraftProposals(res.draft_proposals || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load grill chat')
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim()
    if (!text || !ticket || sending) return

    setInputText('')
    setSending(true)
    setError('')

    // Optimistic user message append
    const tempUserMsg: GrillChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    try {
      const res = await api.postGrillChat(projectSlug, ticket.code, text)
      setMessages(res.messages || [])
      setQuickReplies(res.suggested_quick_replies || [])
      setCanGenerate(res.can_generate_proposals || false)
      setDraftProposals(res.draft_proposals || [])
    } catch (e: any) {
      setError(e.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleGenerateProposals = async () => {
    if (!ticket || generating) return
    setGenerating(true)
    setError('')
    try {
      const updated = await api.generateGrillProposals(
        projectSlug,
        ticket.code,
        messages,
        autoPromote,
      )
      if (onProposalsCreated) {
        onProposalsCreated(updated)
      }
      onClose()
    } catch (e: any) {
      setError(e.message || 'Failed to generate proposals')
      setGenerating(false)
    }
  }

  if (!isOpen || !ticket) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col h-full animate-slide-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/40 text-violet-300 flex items-center justify-center shadow-lg shadow-violet-500/10">
              <Mic className="w-5 h-5 text-violet-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">
                  🎙️ Grill Me Technical Alignment
                </span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-800/60 font-semibold">
                  {ticket.code}
                </span>
              </div>
              <p className="text-xs text-slate-400 line-clamp-1 max-w-md">
                {ticket.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info banner */}
        <div className="px-4 py-2 bg-violet-950/25 border-b border-violet-800/30 text-[11px] text-violet-200/90 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            Orchestrator grilling architecture, exactness boundaries &amp; test
            harness before worker dispatch.
          </span>
          <span className="text-violet-400 font-mono text-[10px]">
            Frontier Tier
          </span>
        </div>

        {/* Error alert */}
        {error && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Chat message thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
              <span className="text-xs">
                Orchestrator formulating technical alignment questions...
              </span>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isAssistant = m.role === 'assistant'
              return (
                <div
                  key={idx}
                  className={`flex gap-3 ${
                    isAssistant ? 'justify-start' : 'justify-end'
                  }`}
                >
                  {isAssistant && (
                    <div className="w-7 h-7 rounded-lg bg-violet-900/60 border border-violet-700/60 text-violet-300 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                      isAssistant
                        ? 'bg-slate-800/90 text-slate-200 border border-slate-700/70'
                        : 'bg-violet-600 text-white font-medium shadow-md shadow-violet-600/20'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    <div
                      className={`text-[9px] mt-1.5 font-mono ${
                        isAssistant ? 'text-slate-500' : 'text-violet-200/70'
                      }`}
                    >
                      {m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}
                    </div>
                  </div>

                  {!isAssistant && (
                    <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              )
            })
          )}

          {sending && (
            <div className="flex gap-3 justify-start items-center">
              <div className="w-7 h-7 rounded-lg bg-violet-900/60 border border-violet-700/60 text-violet-300 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-slate-800/90 border border-slate-700/70 rounded-2xl px-4 py-2.5 text-xs text-slate-400 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
                Synthesizing architectural trade-offs...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Draft proposals ready banner */}
        {canGenerate && draftProposals.length > 0 && (
          <div className="p-4 mx-4 mb-2 rounded-xl bg-violet-950/40 border border-violet-500/40 flex flex-col gap-3 animate-fade-in shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-violet-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Consensus Reached: {draftProposals.length} Worker-Ready Proposals Ready</span>
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPromote}
                  onChange={(e) => setAutoPromote(e.target.checked)}
                  className="rounded border-slate-700 text-violet-600 focus:ring-0"
                />
                Auto-promote to TODO
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {draftProposals.map((p, pIdx) => (
                <div
                  key={pIdx}
                  className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between font-mono font-bold text-violet-300">
                    <span>{p.code}</span>
                    <span className="text-[10px] text-slate-500">Sec {p.section_code}</span>
                  </div>
                  <div className="font-semibold text-white line-clamp-1">{p.title}</div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    <FileCode2 className="w-3 h-3 text-slate-500" />
                    <span className="line-clamp-1 font-mono">{p.files_md || 'Files specified'}</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleGenerateProposals}
              disabled={generating}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-violet-600/30 flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating and Staging Proposals...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Generate &amp; Stage {draftProposals.length} Worker Proposals
                </>
              )}
            </button>
          </div>
        )}

        {/* Quick replies */}
        {quickReplies.length > 0 && !loading && (
          <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar border-t border-slate-800/60 bg-slate-950/50">
            <span className="text-[10px] text-slate-500 font-mono shrink-0">
              Suggestions:
            </span>
            {quickReplies.map((qr, qIdx) => (
              <button
                key={qIdx}
                type="button"
                onClick={() => handleSendMessage(qr)}
                disabled={sending}
                className="px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-[11px] text-slate-300 shrink-0 cursor-pointer transition disabled:opacity-50 hover:text-white"
              >
                {qr}
              </button>
            ))}
          </div>
        )}

        {/* Input box */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          className="p-3 bg-slate-950 border-t border-slate-800 flex items-center gap-2 shrink-0"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={sending || loading}
            placeholder="Reply to orchestrator with technical constraints, boundaries, or requirements..."
            className="flex-1 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-md shadow-violet-600/20"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
