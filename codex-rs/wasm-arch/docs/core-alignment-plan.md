# WASM/Core Alignment Plan

## Goal

Move `codex-rs/wasm` toward the same runtime architecture as `codex-rs/core`.

The target shape is:

- one shared domain/runtime architecture;
- different host adapters for native OS and browser;
- browser-only code limited to bindings, storage, transport, and capability adapters.

## Current Gaps

Today `codex-rs/wasm` still carries a parallel runtime stack:

- a separate browser turn/session engine in `core/src/browser_runtime.rs`;
- a separate bridge dispatch stack in `core/src/bridge*.rs`;
- a separate tool loop in `core/src/tool_runtime.rs` and `core/src/response_tool_loop.rs`;
- duplicated deterministic model/history/instruction logic in `core/src/models.rs`, `core/src/history.rs`, and `core/src/instructions.rs`;
- a WASM-local UI contract that is only on a future reuse path from `app-server-protocol`.

That structure is useful for incremental delivery, but it is not the target architecture.

## Target Layering

### Shared domain/runtime layer

Owns:

- turn lifecycle;
- response stream handling;
- tool-call parsing and dispatch orchestration;
- deterministic transcript/history transforms;
- prompt assembly and instruction injection;
- protocol-shaped model-visible items.

This layer should not know whether it runs on macOS/Linux/Windows or in the browser.

### Host adapter layer

Owns:

- filesystem effects;
- model transport;
- tool execution;
- persistence;
- optional git/MCP capabilities;
- policy enforcement specific to the host.

This is where native and browser behavior should diverge.

### Binding/UI layer

Owns:

- JS/WASM bindings;
- browser host object interop;
- app-server-protocol adapters for UI-facing APIs;
- demo/web UI glue.

## Migration Sequence

### Phase 1: Stop deterministic drift

Replace WASM-local copies of deterministic logic with shared protocol/data semantics wherever possible.

Priority order:

1. `history.rs` and truncation helpers use `codex_protocol::models`.
2. instruction payload shaping is aligned with the shared Codex instruction model.
3. tool-call parsing/output shaping follows the same structures as `core` tool routing.

This phase should avoid changing the browser host boundary.

### Phase 2: Converge tool architecture

Reduce the gap between `core` tool routing and `wasm` tool routing.

Priority order:

1. move tool-call parsing and response shaping toward a shared module;
2. isolate browser-specific builtins as adapters instead of a parallel tool engine;
3. keep browser-only capabilities behind host traits, not inside the orchestration path.

### Phase 3: Converge turn/session orchestration

Shrink `BrowserRuntime` until it is mostly an adapter around shared turn execution.

Priority order:

1. share response-stream handling and follow-up loop semantics;
2. share history recording and turn completion rules;
3. leave session storage and model transport as browser adapters.

### Phase 4: Collapse UI contract drift

Move the browser-facing runtime surface onto an adapter over `app-server-protocol` vocabulary.

Priority order:

1. keep `UiEvent` internal only;
2. introduce translation at the binding edge rather than in the core runtime;
3. stop adding new WASM-only UI contract concepts unless they are strictly internal.

## Implementation Rules

- Prefer reducing duplication before adding new browser-only runtime concepts.
- If a WASM-local module contains deterministic domain logic, treat it as a migration candidate by default.
- If a browser requirement is truly host-specific, express it as a trait or adapter, not as a new parallel orchestration layer.
- Keep changes outside `codex-rs/wasm/*` minimal unless a shared surface is clearly justified.

## First Concrete Steps

- [x] Align `history.rs` with shared `codex_protocol::models`.
- [ ] Align `truncate.rs` helpers and transcript accounting with shared protocol items end-to-end.
- [ ] Extract shared tool-call parsing/output shaping contract from the current `core` and `wasm` implementations.
- [ ] Define the adapter boundary from browser runtime events to `app-server-protocol` v2 notifications/results.
