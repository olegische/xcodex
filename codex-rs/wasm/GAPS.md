# Codex WASM v2 Mirror Gaps

`codex-rs/wasm_v2` is still a mirror-track of `codex-rs/core`, but it is a
browser-constrained mirror, not a byte-for-byte port.

This document replaces the older architecture/checklist/plan notes.

## Goal

Keep `wasm_v2` as close to `core` as possible in:

- module naming;
- turn lifecycle shape;
- typed state contracts;
- prompt construction flow;
- event and rollout semantics;
- orchestration boundaries.

Diverge only where the browser runtime makes direct parity either impossible or
unsafe.

## Accepted Browser Exceptions

These differences are intentional and should not be treated as mirror bugs.

### Tools and command execution

- Browser `wasm_v2` does not have host shell access.
- `tools` may keep a browser-specific execution model instead of mirroring
  native shell/unified-exec runtimes.
- The mirror requirement here is architectural shape at the orchestration
  boundary, not implementation parity of native command execution.

Implication:

- `tools/context`, `tools/registry`, `tools/router`, and `tools/spec` should
  stay conceptually aligned with `core`.
- Native runtime details from `core/src/tools/runtimes/*` do not need to be
  mirrored literally in the browser.

### Auth and login

- Browser `wasm_v2` should stay API-key oriented.
- Anything that implies ChatGPT interactive login, keychain integration, or
  native credential flows is intentionally out of scope.
- If a `core` config or auth path exists mainly to support native login, it can
  remain unsupported in `wasm_v2`.

### Native-only environment features

- Native sandbox integrations, shell detection, login shells, host process
  execution, filesystem watching, and platform credential storage can diverge
  or be stubbed when the browser host cannot support them safely.

The rule is:

- browser adapters may remove capabilities;
- browser adapters should not redefine domain lifecycle unless the capability
  removal forces it.

## Current Assessment

With the browser constraints above, the main mirror gaps are now:

1. `tasks/*` names match `core`, but task semantics are still incomplete.
2. `lib.rs` exports too much internal surface, so crate boundaries are weaker
   than in `core`.
3. Browser exceptions are present in code but were not previously recorded as a
   stable contract.
4. `codex.rs` orchestration is partially decomposed, but the turn lifecycle
   still needs to be validated against `core` stage by stage.

## Priority Gaps

### P0: Finish task semantics, not just task names

`wasm_v2/core/src/tasks/*` should mirror `core` at the lifecycle level even if
some task bodies are browser-adapted.

What must align:

- task spawning and completion behavior;
- abort and replacement semantics;
- turn completion conditions;
- review/compact/undo task meaning;
- follow-up scheduling after tool outputs;
- emitted events around task lifecycle.

What may differ:

- native execution inside a task;
- browser-only adapters used to satisfy the task.

Success condition:

- a reader can map each `wasm_v2` task to the corresponding `core` task and
  explain the same lifecycle in different host environments.

### P0: Tighten crate boundaries

`wasm_v2/core/src/lib.rs` is currently too permissive compared to `core`.

Target state:

- keep external API surface intentionally small;
- make staging modules private unless they are true crate API;
- avoid exporting internal orchestration pieces just because they are still in
  motion;
- match `core` visibility rules where the browser does not require otherwise.

Why this matters:

- weak visibility leaks temporary implementation structure into downstream code;
- once consumers bind to internal modules, later mirror cleanups become breaking
  changes.

### P1: Validate `codex.rs` against `core` by lifecycle stages

Do not judge mirror status only by module names.

For each turn stage, confirm whether `wasm_v2` mirrors `core` in:

- input normalization;
- prompt assembly;
- model request dispatch;
- output item handling;
- tool follow-up loop;
- compaction triggers;
- abort handling;
- rollout persistence;
- session state mutation.

The code can stay split into helper modules, but the stage ordering and state
transitions should remain recognizable from `core`.

### P1: Keep config mirror where it affects orchestration

Some config divergence is intentional, but not all config should become a new
browser-specific contract.

Keep mirrored where it affects:

- approval policy interpretation;
- sandbox policy projection;
- model selection;
- collaboration mode behavior;
- compaction thresholds;
- prompt-affecting instructions;
- MCP/tool availability.

Allow divergence where it is native-login or host-process specific.

### P2: Replace implicit exceptions with explicit ones

Every intentional divergence should fit one of these buckets:

- no browser equivalent exists;
- browser equivalent would be unsafe;
- browser equivalent would require native-only privileged access.

If a divergence does not fit one of those buckets, treat it as a mirror gap
until proven otherwise.

## Recommended Work Order

1. Tighten `lib.rs` visibility to match `core` as much as possible.
2. Audit `tasks/*` one by one against `core` and close semantic gaps.
3. Walk `codex.rs` turn lifecycle against `core` and document any forced browser
   deviations inline.
4. Recheck config surfaces and keep only the browser-only exceptions that are
   actually required.

## Mirror Decision Rule

`wasm_v2` should be considered "mirror-aligned" when all of the following are
true:

- task semantics are mapped to `core`, not just task names;
- crate visibility does not leak mirror-internal modules by default;
- `codex.rs` follows the same turn lifecycle shape as `core`;
- browser exceptions are explicit, short, and adapter-scoped;
- no divergence remains that is merely convenient rather than browser-required.

## Out of Scope for Mirror Purity

These are explicitly not required for browser mirror status:

- native shell parity;
- ChatGPT interactive login parity;
- keychain/native credential parity;
- host sandbox implementation parity;
- native process supervision parity.
