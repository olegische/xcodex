# Runtime UI Profiles

`codex-rs/wasm-arch/examples/webui-runtime-profiles` is a fork of `apps/webui` that proves the first
Codex-driven UI rewrite loop inside the browser runtime.

## What This Example Proves

- the shell is based on the real `apps/webui`, not an older demo;
- the browser workspace now owns `tokens`, `profiles`, `layout`, and `widgets` documents under `/workspace/ui/`;
- the active profile and theme tokens are applied live at runtime;
- shell composition is rendered from schema instead of hard-coded layout branches;
- Codex can rewrite those files through the existing browser file tools.

## Current Runtime UI Schema

- `tokens.json`: base theme palettes
- `profiles.json`: active profile, sidebar side, token overrides
- `layout.json`: widget placement across shell areas
- `widgets.json`: widget variants and defaults

## Why This Exists

This example is the first real step toward letting Codex in WASM change the browser UI itself.

The UI remains declarative on purpose. Codex edits schema files, the shell hot-applies them,
and the browser workspace remains the source of truth.
