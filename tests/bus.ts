/** A minimal in-memory stand-in for the plugin context's `data.on` event bus. */
export function bus() {
  const subs = new Map<string, Set<(e: any) => void>>()
  return {
    on: (type: string, fn: (e: any) => void) => {
      const set = subs.get(type) ?? subs.set(type, new Set()).get(type)!
      set.add(fn)
      return () => void set.delete(fn)
    },
    emit: (type: string, data: Record<string, unknown> = {}, created?: number) =>
      subs.get(type)?.forEach((fn) => fn({ created, data })),
    size: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
  }
}
