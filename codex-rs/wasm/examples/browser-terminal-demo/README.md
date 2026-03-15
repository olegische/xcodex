# Browser Terminal Demo

`codex-rs/wasm/examples/browser-terminal-demo` is a browser-native terminal surface for Codex.

It is intentionally not a chat UI. The goal is a single terminal-like surface over the browser runtime:

- one transcript stream;
- one prompt/composer;
- inline runtime activity;
- inline approvals for `request_user_input`;
- browser-safe workspace tools only.

## Architecture

This example uses `ai-aware-web` as the browser wrapper reference, but keeps that concern separate from the Codex runtime contract:

- `wasm_v2/core` remains the target contract;
- the browser layer is treated as an adapter;
- browser-only differences stay in the host/runtime bridge, not in core semantics.

Right now the demo reuses browser-side asset wiring from `ai-aware-web/public/` so the page can boot without inventing a second packaging pipeline. That is a temporary browser packaging source, not a change of truth for the runtime contract.

## Run

```bash
npm install
npm run dev
```

The page expects the WASM package manifest at `/pkg/manifest.json`.

If the package is not built yet, the UI will stop at boot with a clear error message instead of pretending the runtime is available.
