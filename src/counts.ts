import { createSignal } from "solid-js"

export type Counts = { turns: number; steps: number; tools: number; thoughts: number }

type Msg = { content?: { type: string }[] }
type Page = { data?: Msg[]; cursor?: { next?: string | null } }
export type Client = { message: { list: (q: Record<string, unknown>) => Promise<Page> } }

type Ev = { data?: { sessionID?: string } }
type On = (type: string, fn: (e: Ev) => void) => () => void

// live increments while a run streams; full recounts correct any drift
const BUMPS: Record<string, keyof Counts> = {
  "session.step.started": "steps",
  "session.tool.input.started": "tools",
  "session.reasoning.started": "thoughts",
}

const RESYNC = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.revert.committed",
  "session.compaction.ended",
]

export const PAGE = 200
const ZERO: Counts = { turns: 0, steps: 0, tools: 0, thoughts: 0 }

/** Keep per-session activity counts from the message history and the live event stream. */
export function trackCounts(client: Client, on: On, debounceMs = 250) {
  const [counts, setCounts] = createSignal<Record<string, Counts>>({})
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const refresh = async (id: string) => {
    const [users, steps] = await Promise.all([fetchAll(client, id, "user"), fetchAll(client, id, "assistant")])
    const parts = steps.flatMap((m) => m.content ?? [])
    const n = (type: string) => parts.filter((p) => p.type === type).length
    setCounts((c) => ({
      ...c,
      [id]: { turns: users.length, steps: steps.length, tools: n("tool"), thoughts: n("reasoning") },
    }))
  }

  // coalesce bursts of events into one recount per session
  const schedule = (id: string) => {
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        void refresh(id)
      }, debounceMs),
    )
  }

  const bump = (id: string, key: keyof Counts) =>
    setCounts((c) => ({ ...c, [id]: { ...c[id], [key]: c[id][key] + 1 } }))

  // only track sessions that have been displayed
  const tracked = (fn: (id: string) => void) => (e: Ev) => {
    const id = e.data?.sessionID
    if (id && id in counts()) fn(id)
  }

  const offs = [
    ...Object.entries(BUMPS).map(([type, key]) =>
      on(
        type,
        tracked((id) => bump(id, key)),
      ),
    ),
    ...RESYNC.map((type) => on(type, tracked(schedule))),
  ]

  return {
    /** Start tracking a session; returns the initial load so callers can await it. */
    load: (id: string) => {
      if (id in counts()) return
      // start at zero so live events and resyncs apply even if this first load fails
      setCounts((c) => ({ ...c, [id]: ZERO }))
      return refresh(id)
    },
    get: (id?: string) => (id ? counts()[id] : undefined),
    dispose: () => {
      offs.forEach((off) => off())
      timers.forEach(clearTimeout)
    },
  }
}

/** Fetch every message of one type in a session, paging through the full history. */
async function fetchAll(client: Client, sessionID: string, type: string) {
  const rows: Msg[] = []
  let cursor: string | undefined
  while (true) {
    const page = await client.message.list({
      sessionID,
      type,
      limit: PAGE,
      ...(cursor ? { cursor } : { order: "asc" }),
    })
    const data = page.data ?? []
    rows.push(...data)
    cursor = page.cursor?.next ?? undefined
    if (!cursor || data.length < PAGE) return rows
  }
}
