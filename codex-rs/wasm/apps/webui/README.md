# WebUI

`codex-rs/wasm/apps/webui` is the product-facing browser shell for XCodex WASM.

It is intentionally separate from `codex-rs/wasm/examples/browser-chat-demo`:

- `apps/webui` is the maintained UI surface;
- `examples/browser-chat-demo` remains the reference demo and runtime wiring example.

## Current State

The app currently provides:

- a fresh Svelte/Vite shell inspired by Open WebUI layout patterns;
- a sidebar, thread header, transcript, composer, settings modal, and drawers;
- a thin bridge to the proven browser runtime integration used by `browser-chat-demo`.

The app does not yet provide:

- real multi-thread persistence UI;
- real approval actions;
- a standalone runtime integration layer fully decoupled from demo source files.

## Development Direction

Near-term implementation priorities:

1. replace the temporary `demo-bridge` imports with native `apps/webui` runtime modules;
2. wire real thread list persistence into the sidebar;
3. replace approval placeholders with actual approve/reject runtime handling;
4. continue productizing the shell while keeping Codex runtime semantics outside UI components.
