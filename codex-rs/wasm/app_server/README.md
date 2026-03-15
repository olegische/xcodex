# wasm app-server

This crate is the browser-side mirror track for app-server behavior.

Rules:

- `codex-rs/app-server-protocol` is the source of truth for wire models.
- `codex-rs/app-server` is the source of truth for native behavior.
- This crate is additive. It does not replace or mutate the native app-server.
- Browser-specific adaptation belongs here, not in upstream `app-server`.

The intent is to grow a wasm-safe app-server core boundary that can later be
connected to `codex-rs/wasm/browser` without changing the protocol surface.
