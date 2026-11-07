/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, on, Show } from "solid-js"

type Counts = { turns: number; steps: number; tools: number; thoughts: number }

type Msg = { content?: { type: string }[] }
type Page = { data?: Msg[]; cursor?: { next?: string | null } }

type Ctx = {
  theme: { text: { muted: unknown } }
  client: { message: { list: (q: Record<string, unknown>) => Promise<Page> } }
  data: { on: (type: string, fn: (e: { data?: { sessionID?: string } }) => void) => () => void }
  ui: { slot: (claim: { append: string; render: (input: Input) => unknown }) => () => void }
}

type Input = { sessionID?: string; showDetails?: boolean }

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

const PAGE = 200
const DEBOUNCE_MS = 250

export default {
  id: "oc-footer",
  setup(ctx: Ctx) {
    const [counts, setCounts] = createSignal<Record<string, Counts>>({})
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const refresh = async (id: string) => {
      const [users, steps] = await Promise.all([fetchAll(ctx, id, "user"), fetchAll(ctx, id, "assistant")])
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
        }, DEBOUNCE_MS),
      )
    }

    const bump = (id: string, key: keyof Counts) =>
      setCounts((c) => ({ ...c, [id]: { ...c[id], [key]: c[id][key] + 1 } }))

    // only track sessions that have been displayed
    const tracked = (fn: (id: string) => void) => (e: { data?: { sessionID?: string } }) => {
      const id = e.data?.sessionID
      if (id && id in counts()) fn(id)
    }

    const offs = [
      ...Object.entries(BUMPS).map(([type, key]) => ctx.data.on(type, tracked((id) => bump(id, key)))),
      ...RESYNC.map((type) => ctx.data.on(type, tracked(schedule))),
    ]

    const unslot = ctx.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        createEffect(on(() => input.sessionID, (id) => id && !(id in counts()) && void refresh(id)))
        const stats = () => (input.sessionID ? counts()[input.sessionID] : undefined)

        return (
          <Show when={input.showDetails !== false && stats()}>
            {(s) => (
              <text flexShrink={0} wrapMode="none" fg={ctx.theme.text.muted}>
                {`${s().turns}↑ ${s().steps}⟳ ${s().tools}⚒ ${s().thoughts}✦`}
              </text>
            )}
          </Show>
        )
      },
    })

    return () => {
      unslot()
      offs.forEach((off) => off())
      timers.forEach(clearTimeout)
    }
  },
}

/** Fetch every message of one type in a session, paging through the full history. */
async function fetchAll(ctx: Ctx, sessionID: string, type: string) {
  const rows: Msg[] = []
  let cursor: string | undefined
  while (true) {
    const page = await ctx.client.message.list({
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
