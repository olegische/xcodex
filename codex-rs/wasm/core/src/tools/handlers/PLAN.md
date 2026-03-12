# WASM Tool Handlers

This directory is reserved for WASM-local tool handlers that mirror `codex-rs/core/src/tools/handlers`.

Rule:

- prefer handler shapes and semantics from native Codex;
- only replace the side-effect backend with browser host capability calls;
- avoid inventing browser-only handler semantics when a native contract already exists.
