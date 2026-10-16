import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Plus, Send, Sparkles, Trash2, Wrench } from "lucide-react"

import { ActionProposal, outcomeNotes } from "../components/ActionProposal"
import {
  call,
  createConversation,
  deleteConversation,
  getConversation,
  getCurrentProperty,
  listConversations,
  saveConversation,
  type AgentAction,
  type ChatMsg,
  type ConversationSummary,
} from "../lib/api"
import { cn } from "../lib/utils"
import { Markdown } from "../lib/markdown"

// Lookups the agent ran. Changes never show here: they are proposals,
// shown as cards with Approve / Decline (ActionProposal).
const TOOL_LABEL: Record<string, string> = {
  availability: "Checked availability",
  quote: "Priced the stay",
  find_reservations: "Looked up reservations",
  stay_detail: "Opened a stay",
  get_folio: "Opened the folio",
  cancellation_preview: "Previewed cancellation",
  owner_briefing: "Read the day's numbers",
  front_desk_today: "Checked today's desk",
  waitlist_ready: "Checked waitlist openings",
  guest_search: "Searched guests",
}
const toolLabel = (t: string) =>
  TOOL_LABEL[t] ?? t.replace(/_/g, " ")

/** What the model sees of a message: its text plus what became of the
 * changes it proposed. */
const forModel = ({ role, content, actions }: ChatMsg) => ({
  role,
  content: [content, ...outcomeNotes(actions)].filter(Boolean).join("\n\n"),
})

const SUGGESTIONS = [
  "What does today look like - arrivals, departures, occupancy?",
  "Find the reservation for room 101 and show me the folio.",
  "Quote 2 nights in a Deluxe for 2 adults from this Friday.",
  "Which waitlisted guests can I now give a room?",
]

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-500">
      Thinking
      <span className="inline-flex gap-0.5">
        <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
      </span>
    </span>
  )
}

function AiSetupNotice() {
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <p className="font-semibold">BizConnect.id Hotel Agent needs an AI key to start working.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Get an OpenAI API key at{" "}
          <a
            className="underline"
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            platform.openai.com/api-keys
          </a>{" "}
          (sign up, add billing, create a key).
        </li>
        <li>
          In BizConnect.id Hotel, open <b>Settings, AI assistant</b>: paste the key, pick a
          model (gpt-4o-mini works well), switch it on, save.
        </li>
        <li>Come back here and ask a question.</li>
      </ol>
      <p className="text-xs text-amber-700">
        The key stays on your server and is stored masked. Usage is billed to
        your own OpenAI account.
      </p>
    </div>
  )
}

export default function Assistant() {
  const [convos, setConvos] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)
  const [aiAllowed, setAiAllowed] = useState(true)
  // the messages as last rendered, for saves that outlive a render (or the
  // screen: a turn still saves if the person navigates away mid-answer)
  const latest = useRef<ChatMsg[]>([])
  latest.current = msgs

  useEffect(() => {
    call<{ enabled: boolean; allowed?: boolean }>("kamra.assistant.assistant_status", {
      property: getCurrentProperty(),
    })
      .then((s) => {
        setAiEnabled(s.enabled)
        setAiAllowed(s.allowed !== false)
      })
      .catch(() => setAiEnabled(true))
  }, [])

  const refreshList = useCallback(
    () => listConversations().then(setConvos).catch(() => setConvos([])),
    [],
  )

  useEffect(() => {
    refreshList()
  }, [refreshList])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [msgs, busy])

  async function openConvo(name: string) {
    if (busy) return
    setError(null)
    try {
      const c = await getConversation(name)
      setActiveId(c.name)
      setMsgs(c.messages)
    } catch {
      setError("Couldn't open that conversation.")
    }
  }

  function newChat() {
    if (busy) return
    setActiveId(null)
    setMsgs([])
    setError(null)
  }

  async function removeConvo(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    await deleteConversation(name).catch(() => {})
    setConvos((cs) => cs.filter((c) => c.name !== name))
    if (activeId === name) newChat()
  }

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput("")
    setError(null)
    const isFirst = msgs.length === 0
    const history: ChatMsg[] = [...msgs, { role: "user", content: q }]
    const aIdx = history.length
    setMsgs([...history, { role: "assistant", content: "", actions: [] }])
    setBusy(true)
    const patch = (fn: (m: ChatMsg) => ChatMsg) =>
      setMsgs((ms) => ms.map((m, i) => (i === aIdx ? fn(m) : m)))

    let content = ""
    const actions: AgentAction[] = []
    try {
      let convId = activeId
      if (!convId) {
        const c = await createConversation(q.slice(0, 60))
        convId = c.name
        setActiveId(convId)
        setConvos((cs) => [
          { name: c.name, title: c.title, modified: "" },
          ...cs,
        ])
      }

      const csrf = (window as unknown as { csrf_token?: string }).csrf_token
      const res = await fetch("/api/method/kamra.assistant.ask_stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf && csrf !== "None" ? { "X-Frappe-CSRF-Token": csrf } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          property: getCurrentProperty(),
          messages: history.map(forModel),
        }),
      })
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let sep: number
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          let event = ""
          let data = ""
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim()
            else if (line.startsWith("data:")) data = line.slice(5).trim()
          }
          if (!event || !data) continue
          const d = JSON.parse(data)
          if (event === "token") {
            content += d.text
            patch((m) => ({ ...m, content }))
          } else if (event === "action") {
            actions.push(d as AgentAction)
            patch((m) => ({ ...m, actions: [...actions] }))
          } else if (event === "error") {
            setError(d.message)
          }
        }
      }
      // persist the completed turn from the latest state, not `history`:
      // an approval that finished while the agent answered keeps its outcome
      const finalMsgs = latest.current.map((m, i) =>
        i === aIdx ? { ...m, content, actions } : m,
      )
      await saveConversation(
        convId,
        finalMsgs,
        isFirst ? q.slice(0, 60) : undefined,
      )
      if (isFirst) refreshList()
    } catch {
      setError("The agent couldn't finish - check the AI key in Settings.")
      if (!content) setMsgs((ms) => ms.filter((_, i) => i !== aIdx))
    } finally {
      setBusy(false)
    }
  }

  /** Record what became of a proposal and keep it with the conversation.
   * Every card with its id settles: a repeated proposal shares the id. */
  function resolveAction(id: string, patch: Partial<AgentAction>) {
    setMsgs((ms) => {
      const next = ms.map((m) =>
        m.actions?.some((a) => a.pending && a.id === id)
          ? {
              ...m,
              actions: m.actions.map((a) =>
                a.pending && a.id === id ? { ...a, ...patch } : a,
              ),
            }
          : m,
      )
      if (activeId) void saveConversation(activeId, next).catch(() => {})
      return next
    })
  }

  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[480px] gap-4">
      {/* conversations */}
      <div className="hidden w-64 shrink-0 flex-col rounded-xl border border-zinc-200 bg-white sm:flex">
        <div className="p-2">
          <button
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <Plus className="size-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {convos.length === 0 && (
            <p className="px-2 py-4 text-xs text-zinc-400">
              No conversations yet.
            </p>
          )}
          {convos.map((c) => (
            <div
              key={c.name}
              onClick={() => openConvo(c.name)}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
                activeId === c.name
                  ? "bg-brand-50 text-brand-800"
                  : "text-zinc-600 hover:bg-zinc-50",
              )}
            >
              <span className="flex-1 truncate">{c.title || "Untitled"}</span>
              <button
                onClick={(e) => removeConvo(c.name, e)}
                aria-label="Delete conversation"
                className="opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5 text-zinc-400 hover:text-rose-500" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* chat */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <Sparkles className="size-4 text-brand-600" />
          <span className="text-sm font-semibold">BizConnect.id Hotel Agent</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">
            your AI, acting as you · on{" "}
            {getCurrentProperty()?.split("-")[0] ?? "your hotel"}
          </span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          {msgs.length === 0 && aiEnabled === false && !aiAllowed && (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-zinc-500">
              The AI assistant isn't available on this site yet. BizConnect.id switches it on per site.
            </p>
          )}
          {msgs.length === 0 && aiEnabled === false && aiAllowed && (
            <div className="py-8">
              <AiSetupNotice />
            </div>
          )}
          {msgs.length === 0 && aiEnabled !== false && (
            <div className="mx-auto max-w-xl space-y-3 py-8 text-center">
              <Sparkles className="mx-auto size-8 text-brand-500" />
              <h2 className="text-lg font-semibold">
                Your AI, acting as you
              </h2>
              <p className="text-sm text-zinc-500">
                It can look things up and act - quote and book stays, check
                guests in and out, post charges and payments, work the waitlist,
                and read the day's numbers. Every change waits for your
                approval.
              </p>
              <div className="grid gap-2 pt-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-600 hover:border-brand-400 hover:bg-zinc-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex items-end gap-2",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {m.role === "assistant" && (
                <span className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600/10">
                  <Sparkles className="size-3.5 text-brand-600" aria-hidden />
                </span>
              )}
              <div
                className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                  m.role === "user"
                    ? "whitespace-pre-wrap rounded-br-md bg-brand-600 text-white"
                    : "space-y-2 rounded-bl-md border border-zinc-100 bg-white text-zinc-800",
                )}
              >
                {m.role === "assistant" ? (
                  <>
                    {m.actions?.some((a) => !a.pending) && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.actions.map((a, j) => !a.pending && (
                          <span
                            key={j}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                              a.ok
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-rose-100 text-rose-700",
                            )}
                          >
                            <Wrench className="size-3" />
                            {toolLabel(a.tool)}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <Markdown text={m.content} />
                    ) : (
                      busy && <ThinkingDots />
                    )}
                    {m.actions?.map((a, j) =>
                      // the same change proposed twice is one card
                      a.pending &&
                      m.actions!.findIndex((b) => b.pending && b.id === a.id) === j ? (
                        <ActionProposal
                          key={a.id ?? j}
                          action={a}
                          disabled={busy}
                          onResolved={(patch) => a.id && resolveAction(a.id, patch)}
                        />
                      ) : null,
                    )}
                  </>
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-zinc-100 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-1.5 shadow-sm transition focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
            <input
              className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-zinc-400"
              placeholder="Ask anything about the hotel…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={busy || !input.trim()}
              className="flex size-9 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
