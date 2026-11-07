import { afterEach, describe, expect, test } from "bun:test"

import { PAGE, trackCounts } from "../src/counts.ts"
import { bus } from "./bus.ts"

type Msg = { content?: { type: string }[] }
type Query = { sessionID: string; type: string; limit: number; cursor?: string; order?: string }

/** A fake message API that pages through per-type history the way OpenCode's does. */
function client(history: Record<string, Msg[]>) {
  // mutable so tests can change the history or make calls fail later
  const api = {
    calls: [] as Query[],
    history,
    fail: false,
    message: {
      list: async (q: Record<string, unknown>) => {
        const query = q as Query
        api.calls.push(query)
        if (api.fail) throw new Error("boom")
        const rows = api.history[query.type] ?? []
        const start = Number(query.cursor ?? 0)
        const next = start + query.limit
        return { data: rows.slice(start, next), cursor: { next: next < rows.length ? String(next) : null } }
      },
    },
  }
  return api
}

let api: ReturnType<typeof client>
let counts: ReturnType<typeof trackCounts>

const setup = (history: Record<string, Msg[]>, debounceMs = 0) => {
  api = client(history)
  const b = bus()
  counts = trackCounts(api, b.on, debounceMs)
  return b
}

const msgs = (n: number, ...types: string[]) =>
  Array.from({ length: n }, () => ({ content: types.map((type) => ({ type })) }))

afterEach(() => counts?.dispose())

describe("trackCounts", () => {
  test("counts turns, steps, tools, and thoughts from the history", async () => {
    setup({
      user: msgs(3),
      assistant: [
        { content: [{ type: "reasoning" }, { type: "tool" }, { type: "tool" }] },
        { content: [{ type: "reasoning" }, { type: "text" }] },
        {},
      ],
    })
    await counts.load("s1")
    expect(counts.get("s1")).toEqual({ turns: 3, steps: 3, tools: 2, thoughts: 2 })
  })

  test("pages through the full history", async () => {
    setup({ user: msgs(1), assistant: msgs(2 * PAGE + 50, "tool") })
    await counts.load("s1")

    expect(counts.get("s1")).toMatchObject({ steps: 2 * PAGE + 50, tools: 2 * PAGE + 50 })
    const pages = api.calls.filter((q) => q.type === "assistant")
    expect(pages.map((q) => q.cursor)).toEqual([undefined, String(PAGE), String(2 * PAGE)])
    expect(pages[0]).toMatchObject({ sessionID: "s1", limit: PAGE, order: "asc" })
  })

  test("starts at zero before the first load finishes", () => {
    setup({ user: msgs(2), assistant: msgs(2) })
    void counts.load("s1")
    expect(counts.get("s1")).toEqual({ turns: 0, steps: 0, tools: 0, thoughts: 0 })
  })

  test("keeps counting live events when the first load fails", async () => {
    const b = setup({})
    api.fail = true
    await expect(counts.load("s1")!).rejects.toThrow("boom")

    b.emit("session.step.started", { sessionID: "s1" })
    expect(counts.get("s1")).toEqual({ turns: 0, steps: 1, tools: 0, thoughts: 0 })
  })

  test("bumps counts from live events", async () => {
    const b = setup({ user: msgs(1), assistant: msgs(1) })
    await counts.load("s1")

    b.emit("session.step.started", { sessionID: "s1" })
    b.emit("session.tool.input.started", { sessionID: "s1" })
    b.emit("session.tool.input.started", { sessionID: "s1" })
    b.emit("session.reasoning.started", { sessionID: "s1" })
    expect(counts.get("s1")).toEqual({ turns: 1, steps: 2, tools: 2, thoughts: 1 })
  })

  test("ignores sessions that were never loaded", () => {
    const b = setup({})
    b.emit("session.step.started", { sessionID: "other" })
    b.emit("session.execution.succeeded", { sessionID: "other" })
    expect(counts.get("other")).toBeUndefined()
    expect(api.calls).toEqual([])
  })

  test("loads a session only once", async () => {
    setup({ user: msgs(1), assistant: msgs(1) })
    await counts.load("s1")
    expect(counts.load("s1")).toBeUndefined()
    expect(api.calls.length).toBe(2)
  })

  test("recounts once after a burst of resync events", async () => {
    const b = setup({ user: msgs(1), assistant: msgs(1) }, 20)
    await counts.load("s1")
    api.history.user = msgs(2)
    api.history.assistant = msgs(4, "tool")

    b.emit("session.execution.started", { sessionID: "s1" })
    b.emit("session.execution.succeeded", { sessionID: "s1" })
    b.emit("session.compaction.ended", { sessionID: "s1" })
    await Bun.sleep(60)

    expect(api.calls.length).toBe(4)
    expect(counts.get("s1")).toEqual({ turns: 2, steps: 4, tools: 4, thoughts: 0 })
  })

  test("dispose unsubscribes and cancels pending recounts", async () => {
    const b = setup({ user: msgs(1), assistant: msgs(1) }, 20)
    await counts.load("s1")
    b.emit("session.execution.succeeded", { sessionID: "s1" })

    counts.dispose()
    expect(b.size()).toBe(0)
    await Bun.sleep(60)
    expect(api.calls.length).toBe(2)
  })
})
