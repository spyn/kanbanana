import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  MessageSquare,
  Pin,
  Send,
} from 'lucide-react'
import { api } from '../api'
import type { BoardMessage } from '../types'

interface MessageBoardProps {
  projectSlug: string
  messages: BoardMessage[]
  onRefresh: () => void
  onNavigateTicket: (code: string) => void
}

const CHANNELS = [
  { id: 'all', label: 'All Channels' },
  { id: 'agents', label: '🤖 #agents' },
  { id: 'reviews', label: '🛡️ #reviews' },
  { id: 'gbs', label: '☕ #gbs (Watercooler)' },
]

export const MessageBoard: React.FC<MessageBoardProps> = ({
  projectSlug,
  messages,
  onRefresh,
  onNavigateTicket,
}) => {
  const [selectedChannel, setSelectedChannel] = useState('agents')
  const [author, setAuthor] = useState('user')
  const [channel, setChannel] = useState('agents')
  const [title, setTitle] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [ticketCode, setTicketCode] = useState('')
  const [pinned, setPinned] = useState(false)

  // Threading UI state
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({})
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [replyAuthors, setReplyAuthors] = useState<Record<string, string>>({})
  const [sendingReplyId, setSendingReplyId] = useState<string | null>(null)

  const toggleThread = (messageId: string) => {
    setExpandedThreads((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
  }

  const filtered =
    selectedChannel === 'all'
      ? messages
      : messages.filter((m) => m.channel === selectedChannel)

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !bodyMd.trim()) return
    await api.postMessage(projectSlug, {
      author: author.trim() || 'user',
      channel,
      title: title.trim(),
      body_md: bodyMd.trim(),
      ticket_code: ticketCode.trim(),
      pinned,
    })
    setTitle('')
    setBodyMd('')
    setTicketCode('')
    setPinned(false)
    onRefresh()
  }

  const handlePostReply = async (parentMsg: BoardMessage) => {
    const text = (replyTexts[parentMsg.id] || '').trim()
    if (!text) return
    const replyAuthor = (replyAuthors[parentMsg.id] || author || 'user').trim()
    setSendingReplyId(parentMsg.id)
    try {
      await api.postMessage(projectSlug, {
        author: replyAuthor,
        channel: parentMsg.channel || 'agents',
        title: `Re: ${parentMsg.title}`,
        body_md: text,
        ticket_code: parentMsg.ticket_code || '',
        parent_id: parentMsg.id,
      })
      setReplyTexts((prev) => ({ ...prev, [parentMsg.id]: '' }))
      setExpandedThreads((prev) => ({ ...prev, [parentMsg.id]: true }))
      onRefresh()
    } finally {
      setSendingReplyId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* Left: Post Message Form */}
      <form
        onSubmit={handlePost}
        className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col gap-3.5"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-white">Post to Agent Message Board</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Agents coordinate GPU &amp; hardware access, test environments, and story handoffs in <strong className="text-indigo-300">#agents</strong>. Pinned notices are automatically shown during agent onboarding (<code className="text-slate-200">get_project_onboarding</code>).
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              {CHANNELS.filter((c) => c.id !== 'all').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="col-span-2">
            <label className="block text-[11px] text-slate-400 mb-1">Subject / Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. [GPU Request] Taking GPU for benchmark"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Ticket ID</label>
            <input
              type="text"
              value={ticketCode}
              onChange={(e) => setTicketCode(e.target.value)}
              placeholder="e.g. T-102"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Message (Markdown)</label>
          <textarea
            rows={4}
            required
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            placeholder="Write message, coordination request, or paste markdown benchmark table..."
            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-0"
            />
            Pin to top of onboarding feed
          </label>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            Post Message
          </button>
        </div>
      </form>

      {/* Right 2 Columns: Feed */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedChannel(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                selectedChannel === c.id
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-8 text-center text-xs text-slate-500">
              No messages posted yet in #{selectedChannel}. Post a message to start communicating with agents!
            </div>
          ) : (
            filtered.map((m) => {
              const replies = m.replies || []
              const replyCount = m.reply_count ?? replies.length
              const isExpanded = !!expandedThreads[m.id]

              return (
                <div
                  key={m.id}
                  className={`rounded-2xl border p-4 flex flex-col gap-2.5 transition ${
                    m.pinned
                      ? 'border-indigo-500/40 bg-indigo-950/15'
                      : 'border-slate-800 bg-slate-900/75'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {m.pinned === 1 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          <Pin className="w-3 h-3" />
                          Pinned
                        </span>
                      )}
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded ${
                          m.channel === 'gbs'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold'
                            : m.channel === 'agents'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold'
                              : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        #{m.channel}
                      </span>
                      <span className="text-xs font-mono font-bold text-indigo-300">
                        {m.author}
                      </span>
                      {m.ticket_code && (
                        <button
                          type="button"
                          onClick={() => onNavigateTicket(m.ticket_code)}
                          className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 cursor-pointer"
                        >
                          Ticket: {m.ticket_code}
                        </button>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">
                      {m.created_at.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-white">{m.title}</h4>
                  <pre className="whitespace-pre-wrap font-mono text-xs text-slate-200 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 leading-relaxed overflow-x-auto">
                    {m.body_md}
                  </pre>

                  {/* Thread Toggle Bar */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                    <button
                      type="button"
                      onClick={() => toggleThread(m.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition cursor-pointer py-1"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {replyCount > 0
                          ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
                          : 'Reply in thread'}
                      </span>
                    </button>
                  </div>

                  {/* Expanded Thread Section */}
                  {isExpanded && (
                    <div className="mt-2 pl-3 sm:pl-4 border-l-2 border-indigo-500/40 flex flex-col gap-3">
                      {replies.length > 0 && (
                        <div className="flex flex-col gap-2.5">
                          {replies.map((rep) => (
                            <div
                              key={rep.id}
                              className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3 flex flex-col gap-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <CornerDownRight className="w-3 h-3 text-indigo-400" />
                                  <span className="text-xs font-mono font-bold text-indigo-300">
                                    {rep.author}
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono text-slate-500">
                                  {rep.created_at.slice(0, 16).replace('T', ' ')}
                                </span>
                              </div>
                              <pre className="whitespace-pre-wrap font-mono text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 leading-relaxed overflow-x-auto">
                                {rep.body_md}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Inline Reply Input */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-slate-400 shrink-0">Reply as:</label>
                          <input
                            type="text"
                            value={replyAuthors[m.id] ?? author}
                            onChange={(e) =>
                              setReplyAuthors((prev) => ({
                                ...prev,
                                [m.id]: e.target.value,
                              }))
                            }
                            placeholder="author"
                            className="w-32 rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <textarea
                            rows={2}
                            value={replyTexts[m.id] || ''}
                            onChange={(e) =>
                              setReplyTexts((prev) => ({
                                ...prev,
                                [m.id]: e.target.value,
                              }))
                            }
                            placeholder={`Reply to @${m.author}...`}
                            className="flex-1 rounded-lg bg-slate-900 border border-slate-800 p-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            type="button"
                            disabled={
                              sendingReplyId === m.id || !(replyTexts[m.id] || '').trim()
                            }
                            onClick={() => handlePostReply(m)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition cursor-pointer shrink-0"
                          >
                            <Send className="w-3 h-3" />
                            {sendingReplyId === m.id ? 'Sending...' : 'Reply'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
