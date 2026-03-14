# Codex WASM v2 Architecture

`codex-rs/wasm_v2` is not a continuation of the old browser-specific layout.

It is the mirror-track:

- `core` architecture mirrored into `wasm_v2`;
- browser differences isolated behind host adapters;
- deterministic runtime logic organized to match `codex-rs/core`.
