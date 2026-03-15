# ADR: Core-Host Boundary for `codex-wasm-core`

## Status

Accepted (A1 start, 2026-03-04)

## Context

`codex-core` tightly couples agent logic with native runtime capabilities:

- filesystem/process/sandbox operations
- network/model transport
- session persistence
- git/mcp integration

For browser-native runtime we need a wasm-safe core that compiles for
`wasm32-unknown-unknown` and delegates platform effects to host adapters.

## Decision

Introduce a dedicated crate `codex-wasm-core` with explicit host boundary traits:

- `HostFs`: `read_file`, `list_dir`, `search`, `write_file`, `apply_patch`
- `HostModelTransport`: request streaming and cancellation
- `HostToolExecutor`: `list_tools`, `invoke`, `cancel`
- `HostSessionStore`: load/save thread snapshots
- `HostGit` (optional)
- `HostMcp` (optional)

Contract payloads are JSON-first (`serde_json::Value` where schema is still
in flux) and use camelCase field naming for wire compatibility with JS host
runtime.

## Consequences

Positive:

- Allows independent wasm compilation gate for boundary crate.
- Stabilizes integration points needed by A2 bridge/SDK work.
- Reduces direct dependency pressure from native-only modules.

Tradeoffs:

- Some payloads are temporarily weakly typed (`Value`), schema hardening is
  required before A2 finalization.
- Native integration still lives in `codex-core` until adapters migrate.

## Follow-ups

1. Move shared orchestration/data transforms from `codex-core` into
   `codex-wasm-core` behind these ports.
2. Define JSON schema fixtures for tool/model/session contracts.
3. Add CI check for `cargo check -p codex-wasm-core --target wasm32-unknown-unknown`.
