/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, on, Show } from "solid-js"

import { fmt, GLYPH, trackPhases } from "./phase.ts"

type Counts = { turns: number; steps: number; tools: number; thoughts: number }

type Msg = { content?: { type: string }[] }
type Page = { data?: Msg[]; cursor?: { next?: string | null } }

type Ctx = {
  theme: { text: { base: unknown; muted: unknown; feedback: Record<"success" | "warning", { base: unknown }> } }
  client: { message: { list: (q: Record<string, unknown>) => Promise<Page> } }
  data: { on: (type: string, fn: (e: Ev) => void) => () => void }
  ui: { slot: (claim: { append: string; render: (input: Input) => unknown }) => () => void }
}

type Input = { sessionID?: string }
type Ev = { created?: number; data?: { sessionID?: string; name?: string; at?: number } }

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

const ROWS: [keyof Counts, string, string][] = [
  ["turns", "⏎", "Turns"],
  ["steps", "↻", "Steps"],
  ["tools", "⚒", "Tools"],
  ["thoughts", "✦", "Thoughts"],
]

const PAGE = 200
const DEBOUNCE_MS = 250

export default {
  id: "opencode-livetrace",
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
    const tracked = (fn: (id: string) => void) => (e: Ev) => {
      const id = e.data?.sessionID
      if (id && id in counts()) fn(id)
    }

    const phases = trackPhases(ctx.data.on)
    const offs = [
      ...Object.entries(BUMPS).map(([type, key]) => ctx.data.on(type, tracked((id) => bump(id, key)))),
      ...RESYNC.map((type) => ctx.data.on(type, tracked(schedule))),
    ]

    // reactive counts for a slot's session, loading them on first display
    const watch = (input: Input) => {
      createEffect(
        on(
          () => input.sessionID,
          (id) => {
            if (!id || id in counts()) return
            // start at zero so live events and resyncs apply even if this first load fails
            setCounts((c) => ({ ...c, [id]: { turns: 0, steps: 0, tools: 0, thoughts: 0 } }))
            void refresh(id)
          },
        ),
      )
      return () => (input.sessionID ? counts()[input.sessionID] : undefined)
    }

    const unslots = [
      ctx.ui.slot({
        append: "prompt.footer.status",
        render: (input) => {
          const phase = () => phases.get(input.sessionID)
          const { feedback } = ctx.theme.text

          return (
            <Show when={phase()}>
              {(p) => (
                // glyph last: the footer is right-anchored, so it stays put as the text grows
                <text wrapMode="none" flexShrink={0}>
                  <span style={{ fg: ctx.theme.text.muted }}>
                    {`${p().tool ? `${p().tool} ` : ""}${fmt(p().elapsed)} `}
                  </span>
                  <span style={{ fg: p().kind === "wait" ? feedback.warning.base : feedback.success.base }}>
                    {GLYPH[p().kind]}
                  </span>
                </text>
              )}
            </Show>
          )
        },
      }),
      ctx.ui.slot({
        append: "sidebar.content",
        render: (input) => {
          const stats = watch(input)
          return (
            <Show when={stats()}>
              {(s) => (
                <box>
                  <text fg={ctx.theme.text.base}>
                    <b>Activity</b>
                  </text>
                  {ROWS.map(([key, sym, name]) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={ctx.theme.text.muted}>{name}</text>
                      <text fg={ctx.theme.text.muted}>{`${s()[key]} ${sym}`}</text>
                    </box>
                  ))}
                </box>
              )}
            </Show>
          )
        },
      }),
    ]

    return () => {
      phases.dispose()
      unslots.forEach((off) => off())
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
