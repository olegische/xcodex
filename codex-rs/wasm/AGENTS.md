# WASM Track Guidelines

This directory contains the Codex WASM track.

## Goal

Build a browser-safe WASM runtime for Codex that preserves as much of the existing agent runtime as possible.

The main target is not "a separate browser toy." The target is Codex itself running in WASM wherever the code is portable.

## Core Intent

The preferred outcome is:

- reuse the existing agent loop;
- reuse existing orchestration and state-transition logic;
- keep behavior aligned with native Codex where the runtime model allows it;
- replace only the host-dependent pieces that cannot exist in WASM.

## Architecture Rule

WASM code lives under `codex-rs/wasm/`.

The rest of the repository is not the WASM migration surface.

- Reuse existing crates from `codex-rs` directly when they already compile and work for the WASM use case.
- Reuse `codex-core` logic first when it is portable enough to work unchanged.
- If a piece of logic is portable but cannot be reused without changing native crates, copy that logic into `codex-rs/wasm/*`.
- Do not rewrite `codex-rs/core` or other non-WASM crates just to make WASM work.
- Do not introduce WASM-driven logic changes into the native agent path.

For long-term maintainability, keep `codex-rs/wasm/core` as close to `codex-rs/core` as possible.

- Prefer direct reuse from `codex-rs/core`.
- If reuse is not practical because of WASM or browser boundaries, copy the native logic as directly as possible into `codex-rs/wasm/core`.
- Do not invent a separate WASM agent semantics when a native Codex behavior already exists.
- Keep browser host code as a capability provider, not as an alternate runtime implementation.
- Keep UI code as a shell and debug surface, not as a place where agent semantics are reconstructed.

This is important for upstream sync: when native Codex changes, the preferred WASM update path should be "reuse or copy the same logic again", not "reconcile three different implementations".

## What We Want To Reuse

The priority is to preserve Codex's existing runtime semantics, especially the agent loop.

That means:

- reuse existing Rust libraries where possible;
- reuse `codex-core` directly where possible;
- keep native behavior owned by native crates;
- disable or replace only the host-dependent pieces that cannot work in WASM.

Examples of host-dependent or native-only areas:

- shell and process execution;
- direct local filesystem access;
- PTY / TTY integration;
- OS sandboxing and policy enforcement;
- host environment access tied to the local machine;
- other computer-use integrations tied to local machine capabilities.

## How To Add WASM Functionality

When implementing new WASM functionality:

1. Check whether an existing crate can be used as-is from WASM.
2. Check whether the required logic already exists in `codex-core` or another existing crate and can be reused unchanged.
3. If yes, depend on it from a crate under `codex-rs/wasm/`.
4. If not, add a WASM-local implementation under `codex-rs/wasm/` instead of refactoring native crates.
5. Keep boundaries explicit around host capabilities such as filesystem, network, tools, persistence, environment access, and execution.

## Boundary Rule

The boundary should be around side effects, not around all runtime logic.

That means the first things to abstract or replace are:

- shell / process execution;
- filesystem and environment access;
- network transport where browser/runtime constraints differ;
- sandbox and policy enforcement that depends on the OS;
- persistence layers that depend on native storage assumptions.

The agent loop, orchestration, history handling, and other deterministic runtime logic should be reused first and duplicated only when reuse is not practical.

## Non-Goals

- No "second rewrite" of `codex-core`.
- No broad refactor of native crates in service of WASM.
- No assumption that browser/runtime limitations should shape native architecture by default.
- No avoidable duplication of agent-loop logic just because the target is WASM.

## Practical Review Rule

If a change for the WASM track modifies logic in non-WASM crates, treat that as a design exception that needs explicit justification.

The default expectation is:

- changes in `codex-rs/wasm/*` are normal;
- changes outside `codex-rs/wasm/*` should be minimal and usually limited to workspace wiring, docs, or explicit shared-surface decisions.
