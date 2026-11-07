/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, on, Show } from "solid-js"

type Counts = { turns: number; steps: number }

type Page = { data?: unknown[]; cursor?: { next?: string | null } }

type Ctx = {
  theme: { text: { muted: unknown } }
  client: { message: { list: (q: Record<string, unknown>) => Promise<Page> } }
  data: { on: (type: string, fn: (e: { data?: { sessionID?: string } }) => void) => () => void }
  ui: { slot: (claim: { append: string; render: (input: Input) => unknown }) => () => void }
}

type Input = { sessionID?: string; showDetails?: boolean }

// events after which a session's message counts may have changed
const EVENTS = [
  "session.step.started",
  "session.step.ended",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.revert.commit",
]

const PAGE = 200
const DEBOUNCE_MS = 250

export default {
  id: "oc-footer",
  setup(ctx: Ctx) {
    const [counts, setCounts] = createSignal<Record<string, Counts>>({})
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const refresh = async (sessionID: string) => {
      const [turns, steps] = await Promise.all([
        count(ctx, sessionID, "user"),
        count(ctx, sessionID, "assistant"),
      ])
      setCounts((c) => ({ ...c, [sessionID]: { turns, steps } }))
    }

    // coalesce bursts of events into one recount per session
    const schedule = (sessionID: string) => {
      clearTimeout(timers.get(sessionID))
      timers.set(
        sessionID,
        setTimeout(() => {
          timers.delete(sessionID)
          void refresh(sessionID)
        }, DEBOUNCE_MS),
      )
    }

    const offs = EVENTS.map((type) =>
      ctx.data.on(type, (e) => {
        const id = e.data?.sessionID
        if (id && id in counts()) schedule(id)
      }),
    )

    const unslot = ctx.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        createEffect(on(() => input.sessionID, (id) => id && !(id in counts()) && void refresh(id)))
        const stats = () => (input.sessionID ? counts()[input.sessionID] : undefined)

        return (
          <Show when={input.showDetails !== false && stats()}>
            {(s) => (
              <text flexShrink={0} wrapMode="none" fg={ctx.theme.text.muted}>
                {label(s().turns, "turn")} · {label(s().steps, "step")}
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

/** Count all messages of one type in a session, paging through the full history. */
async function count(ctx: Ctx, sessionID: string, type: string) {
  let n = 0
  let cursor: string | undefined
  while (true) {
    const page = await ctx.client.message.list({
      sessionID,
      type,
      limit: PAGE,
      ...(cursor ? { cursor } : { order: "asc" }),
    })
    const rows = page.data ?? []
    n += rows.length
    cursor = page.cursor?.next ?? undefined
    if (!cursor || rows.length < PAGE) return n
  }
}

const label = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`
