# AGENTS.md

This directory is developed under a strict mirror policy.

## Mission

`codex-rs/wasm/app_server` must become the browser-safe mirror of
`codex-rs/app-server`.

This is not an adapter layer, not a UI bridge, and not a place for permanent
browser-specific product logic. It is the mirror-track runtime boundary for the
app-server contract in wasm.

## Source Of Truth

The architectural and behavioral source of truth is:

- `codex-rs/app-server`

When deciding where logic belongs, follow upstream module ownership first.

Primary upstream reference points:

- `codex-rs/app-server/src/message_processor.rs`
- `codex-rs/app-server/src/codex_message_processor.rs`
- `codex-rs/app-server/src/outgoing_message.rs`
- `codex-rs/app-server/src/in_process.rs`

## Core Policy

### 1. Mirror first

Every substantial change in this directory should begin from the question:

"How does `codex-rs/app-server` structure this responsibility?"

Preferred order:

1. identify the upstream owner module
2. mirror the boundary and semantics here
3. isolate browser-only substitutions explicitly

Do not invent a new architecture here unless upstream structure truly cannot be
applied in the browser.

### 2. Follow the plan

The working plan for this directory lives in:

- `codex-rs/wasm/app_server/PLAN.md`

Treat `PLAN.md` as the current migration contract.

When making a non-trivial change:

- check that the change fits an existing phase or workstream
- if it changes sequencing or scope materially, update `PLAN.md`
- do not implement work that contradicts the plan without updating the plan first

### 3. Do not grow legacy browser runtime

`codex-rs/wasm/browser/src/runtime.rs` is legacy migration code.

Do not add permanent app-server routing, state ownership, or request lifecycle
logic there if it belongs in `wasm/app_server`.

Temporary migration glue is acceptable only when:

- it is clearly transitional
- it has a direct follow-up path into `wasm/app_server`
- it does not redefine the target architecture

### 4. Browser-specific code must stay explicit

Browser-only concerns are allowed, but they must be clearly bounded.

Examples:

- wasm-bindgen interop
- browser storage
- browser FS facades
- browser transport hosts
- browser event loop or queue primitives

These should be injected or isolated behind host seams where possible.

Do not spread browser-specific shortcuts through mirror logic if a clean seam can
contain them.

### 5. Preserve semantics over convenience

Signature parity is not enough.

When mirroring upstream behavior, preserve:

- request lifecycle
- initialize gating
- pending request semantics
- notification semantics
- thread and turn state transitions

Avoid shallow copies that match method names but not runtime behavior.

### 6. Avoid dual ownership

If logic belongs in `wasm/app_server`, do not keep a second permanent copy in:

- `wasm/browser`
- UI runtime code
- ad hoc glue layers

Migrate ownership, then delete or shrink the old path.

## Expected Module Roles

Within this directory, the intended ownership is:

- `src/message_processor.rs`
  browser-safe mirror of upstream control-plane request lifecycle

- `src/codex_message_processor.rs`
  browser-safe mirror of upstream domain request routing

- `src/outgoing_message.rs`
  browser-safe mirror of upstream outbound and pending request semantics

- `src/in_process.rs`
  browser-safe mirror of upstream embedded runtime seam

- `src/bespoke_event_handling.rs`
  protocol-facing event shaping helpers

- `src/thread_state.rs`
  thread projection and state helpers that stay close to app-server semantics

## Change Rules

Before adding a new capability here:

1. find the equivalent upstream behavior
2. identify the owning upstream module
3. implement it in the corresponding wasm mirror module
4. document any browser-only deviation near the code

Before adding a new method handler:

1. confirm whether it belongs in `MessageProcessor` or `CodexMessageProcessor`
2. prefer the same ownership split as upstream
3. avoid putting request routing into browser host code

Before adding persistence behavior:

1. model it around app-server thread and turn semantics
2. do not shape it around current demo UI convenience

## Testing Expectations

When behavior moves into `wasm/app_server`, tests should move with it.

Prefer:

- unit tests in this crate for mirrored logic
- reduced browser-safe parity tests derived from upstream behavior

Do not rely only on higher-level browser runtime tests for logic that is now
owned here.

## What To Avoid

- designing this crate around current Svelte or external UI integration details
- adding permanent product-specific adapters as the main architecture
- keeping `process_request`-style routing in legacy browser runtime once mirrored
- introducing browser-only RPC surface unless it clearly belongs at the app-server boundary
- copying upstream signatures without copying the underlying semantics

## Practical Review Standard

A change in this directory is on the right track if:

- it makes `wasm/app_server` more like `app-server`
- it reduces app-server ownership in `wasm/browser/src/runtime.rs`
- it improves semantic parity instead of adding another translation layer
- it fits the current `PLAN.md` or updates that plan explicitly

If a proposed change conflicts with these rules, prefer stopping to realign the
design rather than landing more legacy structure.
