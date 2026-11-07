# oc-footer

An OpenCode v2 TUI plugin that shows the current session's activity counts in
the prompt footer:

    /…/my-project  12↑ 47⟳ 31⚒ 18✦  8.9K (1%) · $0.02  ctrl+p commands

| Symbol | Count    | Meaning                                         |
|--------|----------|-------------------------------------------------|
| `↑`    | Turns    | Your prompts (user messages)                    |
| `⟳`    | Steps    | Model calls (assistant messages)                |
| `⚒`    | Tools    | Tool calls made by the model                    |
| `✦`    | Thoughts | Reasoning blocks (when the model emits them)    |

A turn with two tool calls followed by a reply is three steps.

When the sidebar is open, it also gets an "Activity" section with the same
counts, labeled:

    Activity
    ↑ Turns         12
    ⟳ Steps         47
    ⚒ Tools         31
    ✦ Thoughts      18

## Install

OpenCode v2 discovers local TUI plugins as directories (or symlinks to
directories) under a `plugins` folder. Link this repo globally:

    mkdir -p ~/.config/opencode/plugins
    ln -s "$PWD" ~/.config/opencode/plugins/oc-footer

Or for a single project, link it into `<project>/.opencode/plugins/` instead.
Restart OpenCode to load it.

## How It Works

- `tui.tsx` appends to the `prompt.footer.status` slot (after the built-in
  status) and the `sidebar.content` slot; both read the same shared counts.
- Full counts come from the message API (`type: "user"` and
  `type: "assistant"`, counting `tool` and `reasoning` content parts), paging
  through the full history, since the TUI's message store holds only the most
  recent messages.
- While a run streams, step, tool, and reasoning events bump the counts
  directly; a full recount (debounced) runs when a run starts or ends, and
  after reverts and compactions.
- OpenCode applies the Solid JSX transform to plugin files outside
  `node_modules`, so the `.tsx` source loads directly with no build step.
  Publishing to npm would require pre-bundling, as files under `node_modules`
  are not transformed.

Tested with OpenCode 2.2.6.
