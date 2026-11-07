/** Bundle the plugin into dist/, applying the Solid transform OpenCode skips under node_modules. */
import solid from "@opentui/solid/bun-plugin"

const res = await Bun.build({
  entrypoints: ["src/server.ts", "src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  // the host maps these to its own runtime, so bundling them would split Solid's reactivity
  external: ["solid-js", "solid-js/*", "@opentui/*"],
  plugins: [solid],
})

if (!res.success) {
  for (const log of res.logs) console.error(log)
  process.exit(1)
}
