# WASM v2 Mirror Checklist

`codex-rs/wasm_v2` may be called a mirror of `codex-rs/core` only when all of the following are true.

## Structure

- `core/src/codex.rs` has a mirror entrypoint at `wasm_v2/core/src/codex.rs`.
- `core/src/state/*` has mirror modules at `wasm_v2/core/src/state/*`.
- `core/src/tasks/*` has mirror modules at `wasm_v2/core/src/tasks/*`.
- `core/src/context_manager/*` has mirror modules at `wasm_v2/core/src/context_manager/*`.
- `core/src/tools/*` has mirror modules at `wasm_v2/core/src/tools/*`.

## Naming

- module names match `core` unless there is a documented browser-only exception.
- key runtime type names match `core` unless there is a documented browser-only exception.
- key orchestration function names match `core` unless there is a documented browser-only exception.

## Contracts

- history is typed around `codex_protocol::models`, not raw unstructured blobs.
- session state and turn state use stable typed contracts.
- tool routing uses the same layer split as `core`: `context`, `registry`, `router`, `spec`, `runtimes`.
- browser bindings do not define the domain contracts; they only translate them.

## Lifecycle

- turn lifecycle stages are mirrored from `core`.
- follow-up model requests after tool outputs follow the same orchestration shape.
- stop conditions, iteration limits, and failure branches are documented and mirrored.

## Exceptions

- the exception list is short and explicit.
- each exception is browser-only and adapter-scoped.
- host adapters do not redefine domain architecture.

## Current Status

- [x] Separate `wasm_v2` mirror-track exists.
- [x] Mirror directory skeleton exists.
- [x] Typed context/history has standalone mirror-track modules and typed contracts.
- [x] Typed session/turn state has standalone mirror-track modules and typed contracts.
- [x] Tools subsystem has standalone `context`/`registry`/`router`/`spec`/`runtimes` modules.
- [ ] `codex.rs` is a mirrored orchestration entrypoint rather than a placeholder.
- [ ] Browser-only exception list is written down.

## Status Notes

- `tools/spec.rs` and `tools/router.rs` are now standalone implementations inside `wasm_v2`.
- `context_manager/normalize.rs` and `context_manager/updates.rs` now carry real browser-side transforms instead of placeholders.
- `state/session.rs`, `state/turn.rs`, `tasks/mod.rs`, and `tasks/regular.rs` now define typed mirror-track contracts.
- `codex.rs` still needs a real mirrored turn orchestration loop; current implementation only wires the new typed layers together.
