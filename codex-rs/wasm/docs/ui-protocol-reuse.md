# WASM UI Protocol Reuse Path

This note captures the A3 direction for `wasm -> UI`.

The bridge under `core/src/bridge.rs` remains the internal capability boundary between Rust WASM and the browser host.
It is not the UI-facing protocol.

## Direction

The UI-facing surface for the browser runtime should stay on a reuse path from `codex-rs/app-server-protocol`.

For A3, the browser runtime should align with the existing `v2` JSON-RPC method and notification vocabulary instead of introducing a new WASM-only client contract.

## Minimal A3 Mapping

| Browser runtime action | Preferred app-server protocol surface | Notes |
|---|---|---|
| create browser thread | `thread/start` | Browser runtime owns thread persistence, but UI should still reason in terms of `thread/start`. |
| load persisted browser thread | `thread/read` / `thread/resume` | `thread/read` for passive load, `thread/resume` when the thread becomes active again. |
| start a user turn | `turn/start` | A3 runtime should expose turn lifecycle in the same shape the UI already expects. |
| streamed model output | `thread/*` notifications and turn-progress notifications from `v2` | The exact transport can differ, but event semantics should remain aligned. |
| persisted thread snapshot after a turn | `thread/read` result shape | IndexedDB/OPFS storage is internal; the UI contract should still look like a `Thread`. |

## Current A3 Runtime Slice

`codex-wasm-core` now includes a minimal browser runtime in `core/src/browser_runtime.rs` that:

- starts and resumes persisted browser threads;
- runs a turn against `HostModelTransport`;
- persists thread items through `HostSessionStore`;
- emits deterministic UI events for thread load/start, model stream progress, turn completion, and session save.

This runtime is intentionally still narrower than `app-server-protocol v2`.
Its purpose is to provide the internal turn/session engine that later adapters can translate into `v2` request/notification shapes.

## Non-Goal For A3

Do not treat the current internal `UiEvent` enum as a replacement for `app-server-protocol`.
It is an implementation step for the browser MVP, not a new public contract.
