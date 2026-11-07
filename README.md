# oc-footer

An OpenCode v2 TUI plugin that shows the current session's turn and step
counts in the prompt footer:

    /…/my-project  12 turns · 47 steps  8.9K (1%) · $0.02  ctrl+p commands

A *turn* is a user message and a *step* is an assistant message (one model
call), so a turn with two tool calls followed by a reply is three steps.

## Install

OpenCode v2 discovers local TUI plugins as directories (or symlinks to
directories) under a `plugins` folder. Link this repo globally:

    mkdir -p ~/.config/opencode/plugins
    ln -s "$PWD" ~/.config/opencode/plugins/oc-footer

Or for a single project, link it into `<project>/.opencode/plugins/` instead.
Restart OpenCode to load it.

## How It Works

- `tui.tsx` claims the `prompt.footer.status` slot and renders the counts
  after the built-in status.
- Counts come from the message API (`type: "user"` and `type: "assistant"`),
  paging through the full history, since the TUI's message store holds only
  the most recent messages.
- The counts refresh (debounced) on step, execution, and revert events for
  sessions that have been displayed.
- OpenCode applies the Solid JSX transform to plugin files outside
  `node_modules`, so the `.tsx` source loads directly with no build step.
  Publishing to npm would require pre-bundling, as files under `node_modules`
  are not transformed.

Tested with OpenCode 2.2.6.
