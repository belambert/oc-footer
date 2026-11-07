/** @jsxImportSource @opentui/solid */
import type { RGBA } from "@opentui/core"
import { createEffect, on, Show } from "solid-js"

import { type Client, type Counts, trackCounts } from "./counts.ts"
import { fmt, GLYPH, trackPhases } from "./phase.ts"

type Ctx = {
  theme: { text: { base: RGBA; muted: RGBA; feedback: Record<"success" | "warning", { base: RGBA }> } }
  client: Client
  data: { on: (type: string, fn: (e: Ev) => void) => () => void }
  ui: { slot: (claim: { append: string; render: (input: Input) => unknown }) => () => void }
}

type Input = { sessionID?: string }
type Ev = { created?: number; data?: { sessionID?: string; name?: string; at?: number } }

const ROWS: [keyof Counts, string, string][] = [
  ["turns", "⏎", "Turns"],
  ["steps", "↻", "Steps"],
  ["tools", "⚒", "Tools"],
  ["thoughts", "✦", "Thoughts"],
]

export default {
  id: "opencode-livetrace",
  setup(ctx: Ctx) {
    const counts = trackCounts(ctx.client, ctx.data.on)
    const phases = trackPhases(ctx.data.on)

    // reactive counts for a slot's session, loading them on first display
    const watch = (input: Input) => {
      createEffect(
        on(
          () => input.sessionID,
          (id) => id && void counts.load(id),
        ),
      )
      return () => counts.get(input.sessionID)
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
      counts.dispose()
      unslots.forEach((off) => off())
    }
  },
}
