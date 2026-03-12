# WASM Tools Plan

## Goal

Turn `codex-rs/wasm/core/src/tools/` into the browser/WASM counterpart of `codex-rs/core/src/tools/`.

The target is not a browser-specific tools architecture.
The target is a WASM tools subsystem that stays structurally and semantically close to native Codex, while replacing only the side-effect backends with browser capability providers.

## Structural Rule

This directory should converge toward a layout comparable to native Codex:

- `spec`
- `registry`
- `context`
- `router`
- `handlers/`
- `runtimes/` where useful

If a native module can be reused directly, prefer reuse.
If it cannot be reused because of WASM/browser constraints, copy the native logic as directly as possible into this directory.

Do not treat TypeScript host code as the long-term home of tool semantics.
Tool semantics belong in Rust.

## Scope Split

### Owned by `codex-wasm-core`

- tool specs exposed to the model
- tool routing and dispatch
- response item to tool-call conversion
- tool output normalization
- follow-up turn semantics
- stop conditions and loop guards

### Owned by browser host

- storage-backed workspace operations
- browser network calls
- JS/Worker/WASM utility execution
- user mediation prompts
- browser page/runtime inspection backends

## MVP Framing

The initial product shape is not "browser git" and not "browser coding agent that only writes files".

The first meaningful product shape is:

- a local browser-native investigation runtime;
- capable of inspecting live browser/runtime state;
- capable of executing local probes/scripts;
- capable of storing artifacts in a scratch workspace;
- capable of returning explanations, diagnostics, and generated artifacts.

This means:

- browser investigation capabilities are primary;
- workspace/file capabilities are secondary support tools;
- page manipulation/automation is intentionally deferred.

## Tool Surface Roadmap

### V1: Browser Investigation MVP

These tools define the first stable browser-native Codex runtime:

- `execute_script`
- `inspect_dom`
- `get_visible_text`
- `inspect_storage`
- `inspect_console`
- `inspect_network`
- `update_plan`
- `request_user_input`
- `read_file`
- `write_file`
- `list_dir`
- `grep_files`
- `apply_patch`

Intent:

- browser/runtime investigation is the primary MVP surface;
- workspace tools act as scratch/artifact support;
- `execute_script` is the primary browser-native compute primitive;
- no fake shell/process semantics in V1.

Implementation notes:

- `inspect_*` tools should be explicit browser capability tools, not hidden inside generic script execution;
- `read_file`, `list_dir`, `grep_files`, `apply_patch` must stay as close as practical to native Codex cognitive contracts;
- `write_file` is an explicit overwrite/create primitive, not a replacement for `apply_patch`;
- `execute_script` must be capability-scoped and bounded, not ambient JS authority.

### V2: Browser DevTools Shell

These capabilities deepen the investigation/debugging surface:

- `capture_viewport`
- richer DOM/network/storage inspection contracts
- better structured debugging flows on top of the V1 investigation tools

Intent:

- make the runtime useful as a local AI DevTools shell;
- prioritize browser inspection over browser automation;
- keep page introspection separate from workspace mutation semantics.

### V3: Advanced Compute

These tools add stronger browser-native local compute:

- `run_worker_task`
- `execute_wasm_tool`

Intent:

- provide bounded background compute;
- support parser/formatter/indexer/analyzer-style capsules;
- avoid pretending that browser compute is the same as native subprocess execution.

### V4: Controlled Interaction

These tools are intentionally deferred by default:

- `navigate_page`
- `click_element`
- `fill_form`
- `request_permission`

Intent:

- only add page manipulation if a real product need appears;
- do not let the project drift into an automation/RPA identity by default;
- browser page inspection remains higher priority than browser page manipulation.

## Immediate Refactor Steps

### Phase T0: Structural Alignment

Goal:

- move current WASM tools implementation under `codex-rs/wasm/core/src/tools/`
- preserve behavior while aligning module boundaries with native Codex

Expected extraction targets from current files:

- `tool_loop.rs` -> `tools/spec.rs`
- `tool_runtime.rs` -> `tools/router.rs`, `tools/context.rs`, `tools/handlers/*`
- `response_tool_loop.rs` -> `tools/response_loop.rs` or equivalent
- shared runtime types stay only where they are genuinely cross-cutting

### Phase T1: V1 Tool Parity

Goal:

- stabilize `execute_script`
- stabilize `inspect_dom`
- stabilize `get_visible_text`
- stabilize `inspect_storage`
- stabilize `inspect_console`
- stabilize `inspect_network`
- stabilize `read_file`
- stabilize `list_dir`
- stabilize `grep_files`
- stabilize `apply_patch`
- add `write_file`

Definition of done:

- tools are exposed by Rust runtime, not assembled in TS glue;
- browser host acts only as capability backend;
- browser e2e demonstrates stable investigation flow plus scratch-workspace support.

### Phase T2: DevTools Surface

Goal:

- deepen browser inspection contracts
- add the first visual/debugging helpers around the investigation MVP

Definition of done:

- runtime can inspect browser state without becoming a click-bot;
- tool outputs are explicit and stable enough for agent reasoning.

### Phase T3: Compute Capsules

Goal:

- integrate Worker-backed and WASM-backed compute tools

Definition of done:

- browser runtime can launch bounded compute capsules through host capabilities;
- cancellation, visibility, and authority boundaries are explicit.

### Phase T4: Optional Interaction Layer

Goal:

- add controlled page interaction only if product direction requires it

Definition of done:

- action tools are explicit, visible, cancellable, and policy-mediated;
- project identity remains browser agent runtime first, automation second.
