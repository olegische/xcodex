# Codex WASM Architecture

## Goal

Build a browser-safe WASM runtime for Codex that preserves as much of the existing runtime as possible.

The target is Codex itself running in WASM wherever the code is portable, not a separate simplified implementation.

## Core Principle

The WASM track is `reuse first`.

Priority order:

1. Reuse existing Codex runtime logic as-is.
2. Isolate host side effects behind explicit adapters.
3. Add WASM-local implementations only where direct reuse is not practical.

## Reuse Boundary

The boundary should be around side effects, not around all runtime logic.

This means:

- reuse the existing agent loop whenever possible;
- reuse orchestration and deterministic state transitions whenever possible;
- keep native-only behavior owned by native crates;
- replace only the parts that fundamentally depend on a native host.

## Protocol Layers

The WASM track has two different protocol surfaces and they should not be conflated.

### 1. UI-facing protocol

This is the contract between the WASM runtime and the UI/client layer.

The preferred reuse target is:

- `codex-rs/app-server-protocol`

That means the default direction is to keep the UI-facing contract aligned with existing app-server protocol semantics instead of inventing a new WASM-specific client API.

In practice:

- `app-server-protocol` is the primary candidate for `wasm -> UI`;
- differences should be justified explicitly;
- a new UI contract should not be introduced by default just because the runtime is WASM.

### 2. Host-facing bridge

This is the internal contract between the WASM runtime and the JavaScript/browser host that provides capabilities the runtime cannot access directly.

This surface is intentionally internal and capability-oriented:

- filesystem
- model transport
- tool execution
- session persistence
- optional git / MCP

This is the purpose of the current bridge layer under `codex-rs/wasm/core/src/bridge.rs`.

For the concrete A3 browser MVP runtime surface, see:

- `codex-rs/wasm/docs/browser-runtime-host.md`

Short version:

- `app-server-protocol` is the preferred external/UI contract;
- `bridge.rs` is the internal host capability contract.

### Router boundary

For provider-routed browser inference, the boundary is:

- `Codex WASM runtime`
- `host model transport adapter`
- `xrouter-browser`
- provider or router HTTP `responses` endpoint

Important consequence:

- Codex should not directly speak provider-specific HTTP APIs in router mode.
- Provider `base_url` values belong to the router transport layer, not to core Codex orchestration logic.
- The host adapter may pass provider/model/auth config into `xrouter-browser`, but network I/O remains encapsulated by that router layer.
- From Codex's point of view, router mode should preserve `responses`-style semantics for request/stream/completion handling.

Validated browser path (2026-03-09):

- `examples/browser-chat-demo` now proves the end-to-end embedded router flow:
  - `UI -> codex-wasm-core -> browser host adapter -> xrouter-browser -> provider`
- Model discovery and streamed chat turns both execute through `WasmBrowserRuntime`, not through direct UI `fetch`.
- Browser secret values live in browser-managed storage; the persisted config remains codex-compatible and references secrets logically via `env_key`.
- When multiple wasm modules share one page, they must be built against a compatible `wasm-bindgen/js-sys/web-sys/wasm-bindgen-futures` runtime stack.

## Reuse Map

### Reuse directly from existing crates when practical

| Area | Examples | Decision | Notes |
|---|---|---|---|
| Agent loop semantics | `core/src/codex.rs`, turn lifecycle, event sequencing | `reuse first` | This is the main value to preserve. |
| UI/client protocol | `app-server-protocol/src/protocol/*`, JSON-RPC surface, schema fixtures | `reuse first` | Preferred contract for `wasm -> UI`. |
| Deterministic context/history transforms | `context_manager/*`, history accounting, truncation rules | `reuse first where portable` | Copy only blocked modules if runtime coupling prevents direct reuse. |
| Tool schema and protocol shaping | `tools/spec.rs`, request/response shaping | `reuse first where portable` | Keep schema and event semantics aligned with native behavior. |
| Protocol/config/data models | `protocol`, serde models, config model types | `reuse directly` | Shared unless browser-specific wire behavior intentionally diverges. |
| Prompt assembly and model-visible transforms | normalization and prompt construction without side effects | `reuse first` | Deterministic runtime logic should stay shared when possible. |

### Reuse logic, but behind a host adapter

| Area | Examples | Decision | Adapter |
|---|---|---|---|
| Filesystem-backed tools | read/list/search/write/apply-patch flows | `reuse orchestration, replace effects` | `HostFs` |
| Model transport | streaming requests, cancellation, browser transport | `reuse request semantics, replace transport` | `HostModelTransport` |
| Tool execution | host-provided tools and browser-safe capabilities | `reuse orchestration, replace execution` | `HostToolExecutor` |
| Session persistence | thread snapshots, turn artifacts, resumed state | `reuse semantics, replace storage` | `HostSessionStore` |
| Git-backed metadata | diff summaries, repo metadata, review context | `optional reuse behind adapter` | `HostGit` |
| MCP access | MCP tools/resources | `optional reuse behind adapter` | `HostMcp` |

### WASM-local or excluded for browser V1

| Area | Examples | Decision | Notes |
|---|---|---|---|
| Shell and unified exec | `shell`, `unified_exec`, spawn/process management | `exclude from V1` | Browser runtime has no native shell/PTY model. |
| OS sandbox enforcement | seatbelt, landlock, Windows sandbox | `exclude from V1` | Becomes part of host policy, not WASM runtime logic. |
| Native keyring/file auth storage | OS keyring and local auth files | `wasm-local replacement` | Browser storage replaces native persistence. |
| Native file watching | `notify`-driven reload flows | `wasm-local replacement or host event bridge` | Host should push change events if needed. |
| Native-only computer-use integrations | local machine control paths | `exclude from V1` | Not part of the browser-safe baseline. |

## Rules For Changes

1. Do not rewrite `codex-core` or other non-WASM crates just to make WASM work.
2. If direct reuse requires native-crate refactors, prefer a WASM-local implementation under `codex-rs/wasm/*`.
3. Changes outside `codex-rs/wasm/*` should usually be limited to workspace wiring, docs, or explicitly approved shared surfaces.
4. Treat `app-server-protocol` as the default UI-facing protocol unless there is a concrete mismatch that requires a separate surface.

## Next-Stage Consequences

### A2

Use the host adapters as the internal JS bridge surface. Do not move deterministic runtime logic into JS when it can remain in Rust.

At the same time, keep the UI-facing protocol on a reuse path from `app-server-protocol`.

### A3

The browser MVP should prove that the existing Codex runtime model still works when:

- files come from a host filesystem adapter;
- model I/O comes from a browser transport adapter;
- tool execution is capability-based;
- native-only features remain disabled.
