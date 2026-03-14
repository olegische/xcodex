# Codex WASM v2 Plan

`codex-rs/wasm_v2` is the clean mirror-track for rebuilding browser Codex around the
same architectural skeleton as `codex-rs/core`.

Rules:

- mirror `core` structure first;
- diverge only at host adapters and browser-only bindings;
- keep naming, layering, and contracts aligned with `core`;
- document every intentional exception.

Current phase:

1. `tools/*` foundation is in place as standalone `wasm_v2` code.
2. `context_manager/*` and `state/*` now use typed mirror-track contracts.
3. `tasks/*` and `codex.rs` are partially wired, but the main turn orchestration is still not a full mirror of `core`.
4. Next focus is to copy and adapt the `core` turn lifecycle into `wasm_v2/core/src/codex.rs` and push browser-specific behavior outward into adapter modules.
