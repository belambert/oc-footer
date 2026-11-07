import { createSignal } from "solid-js"

export type Kind = "wait" | "think" | "write" | "tool"
export type Phase = { kind: Kind; since: number; tool?: string }

type Ev = { created?: number; data?: { sessionID?: string; name?: string; at?: number } }
type On = (type: string, fn: (e: Ev) => void) => () => void

export const GLYPH: Record<Kind, string> = { wait: "◌", think: "✦", write: "✎", tool: "⚒" }

const WAIT = ["session.execution.started", "session.step.started", "session.compaction.started"]
const DONE = [
  "session.step.failed",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
]

/** Track what each session is doing right now from the live event stream. */
export function trackPhases(on: On) {
  const [live, setLive] = createSignal<Record<string, Phase>>({})
  const [now, setNow] = createSignal(Date.now())
  let tick: ReturnType<typeof setInterval> | undefined

  const set = (id: string, p?: Phase) => {
    setLive(({ [id]: _, ...rest }) => (p ? { ...rest, [id]: p } : rest))

    // tick the clock only while some session is active
    const active = Object.keys(live()).length > 0
    if (active && !tick) tick = setInterval(() => setNow(Date.now()), 100)
    if (!active && tick) {
      clearInterval(tick)
      tick = undefined
    }
  }

  // a repeated phase keeps its start time; tool events always restart it
  const enter = (kind: Kind) => (e: Ev) => {
    const id = e.data?.sessionID
    if (!id || (kind !== "tool" && live()[id]?.kind === kind)) return
    set(id, { kind, since: e.created ?? Date.now(), tool: kind === "tool" ? e.data?.name : undefined })
  }

  const wait = enter("wait")
  const offs = [
    ...WAIT.map((t) => on(t, wait)),
    // a step can end while its tools are still running
    on("session.step.ended", (e) => live()[e.data?.sessionID ?? ""]?.kind !== "tool" && wait(e)),
    on("session.tool.success", wait),
    on("session.tool.failed", wait),
    on("session.reasoning.started", enter("think")),
    on("session.text.started", enter("write")),
    on("session.tool.input.started", enter("tool")),
    on("session.tool.called", enter("tool")),
    // hidden during the retry backoff, then waiting from the scheduled time
    on("session.retry.scheduled", (e) => {
      const id = e.data?.sessionID
      if (id) set(id, { kind: "wait", since: e.data?.at ?? e.created ?? Date.now() })
    }),
    ...DONE.map((t) => on(t, (e) => e.data?.sessionID && set(e.data.sessionID))),
  ]

  return {
    /** The visible phase and its elapsed time for a session, if any. */
    get: (id?: string) => {
      const p = id ? live()[id] : undefined
      return p && now() >= p.since ? { ...p, elapsed: now() - p.since } : undefined
    },
    dispose: () => {
      offs.forEach((off) => off())
      clearInterval(tick)
    },
  }
}

/** Compact duration: 0.4s, 12.3s, 2m05s. */
export function fmt(ms: number) {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, "0")}s`
}
