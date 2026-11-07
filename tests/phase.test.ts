import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test"

import { fmt, trackPhases } from "../src/phase.ts"
import { bus } from "./bus.ts"

const S = { sessionID: "s1" }
let b: ReturnType<typeof bus>
let phases: ReturnType<typeof trackPhases>

beforeEach(() => {
  setSystemTime(new Date(10_000))
  b = bus()
  phases = trackPhases(b.on)
})

afterEach(() => {
  phases.dispose()
  setSystemTime()
})

// the clock signal only advances on the tracker's own 100ms tick
const advance = async (ms: number) => {
  setSystemTime(new Date(Date.now() + ms))
  await Bun.sleep(120)
}

describe("trackPhases", () => {
  test("waits from the event's created time when a run starts", () => {
    b.emit("session.execution.started", S, 9_500)
    expect(phases.get("s1")).toEqual({ kind: "wait", since: 9_500, tool: undefined, elapsed: 500 })
  })

  test("clamps a future created time to now", () => {
    b.emit("session.execution.started", S, 12_000)
    expect(phases.get("s1")?.since).toBe(10_000)
  })

  test("a repeated phase keeps its start time", () => {
    b.emit("session.execution.started", S, 9_000)
    b.emit("session.step.started", S, 9_800)
    expect(phases.get("s1")?.since).toBe(9_000)
  })

  test("moves through thinking, writing, and tool phases", () => {
    b.emit("session.execution.started", S)
    b.emit("session.reasoning.started", S)
    expect(phases.get("s1")?.kind).toBe("think")
    b.emit("session.text.started", S)
    expect(phases.get("s1")?.kind).toBe("write")
    b.emit("session.tool.input.started", { ...S, name: "glob" })
    expect(phases.get("s1")).toMatchObject({ kind: "tool", tool: "glob" })
  })

  test("tool events always restart the phase", () => {
    b.emit("session.tool.input.started", { ...S, name: "read" }, 9_000)
    b.emit("session.tool.called", { ...S, name: "read" }, 9_600)
    expect(phases.get("s1")?.since).toBe(9_600)
  })

  test("a finished tool goes back to waiting", () => {
    b.emit("session.tool.called", { ...S, name: "read" })
    b.emit("session.tool.success", S)
    expect(phases.get("s1")?.kind).toBe("wait")
  })

  test("a step ending keeps a running tool visible", () => {
    b.emit("session.tool.called", { ...S, name: "shell" })
    b.emit("session.step.ended", S)
    expect(phases.get("s1")?.kind).toBe("tool")
  })

  test("a step ending after text goes back to waiting", () => {
    b.emit("session.text.started", S)
    b.emit("session.step.ended", S)
    expect(phases.get("s1")?.kind).toBe("wait")
  })

  for (const type of [
    "session.step.failed",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "session.idle",
  ]) {
    test(`clears on ${type}`, () => {
      b.emit("session.text.started", S)
      b.emit(type, S)
      expect(phases.get("s1")).toBeUndefined()
    })
  }

  test("hides during retry backoff, then waits from the scheduled time", async () => {
    b.emit("session.text.started", S)
    b.emit("session.retry.scheduled", { ...S, at: 11_000 })
    expect(phases.get("s1")).toBeUndefined()

    await advance(1_500)
    expect(phases.get("s1")).toMatchObject({ kind: "wait", since: 11_000, elapsed: 500 })
  })

  test("elapsed time advances while a phase is active", async () => {
    b.emit("session.reasoning.started", S, 10_000)
    await advance(2_000)
    expect(phases.get("s1")?.elapsed).toBe(2_000)
  })

  test("tracks sessions independently", () => {
    b.emit("session.text.started", S)
    b.emit("session.tool.called", { sessionID: "s2", name: "glob" })
    b.emit("session.idle", { sessionID: "s2" })
    expect(phases.get("s1")?.kind).toBe("write")
    expect(phases.get("s2")).toBeUndefined()
  })

  test("ignores events without a session", () => {
    b.emit("session.execution.started", {})
    expect(phases.get(undefined)).toBeUndefined()
  })

  test("dispose unsubscribes from every event", () => {
    expect(b.size()).toBeGreaterThan(0)
    phases.dispose()
    expect(b.size()).toBe(0)
  })
})

describe("fmt", () => {
  test.each([
    [0, "0.0s"],
    [400, "0.4s"],
    [12_345, "12.3s"],
    [60_000, "1m00s"],
    [125_000, "2m05s"],
    [3_600_000, "60m00s"],
  ])("%p ms → %p", (ms, out) => expect(fmt(ms)).toBe(out))
})
