# WebUI Plan

## Purpose

`codex-rs/wasm/apps/webui` is the real browser product surface for XCodex WASM.

It is built separately from `examples/browser-chat-demo`, which remains in the repository as a
reference demo and runtime integration example.

`apps/webui` is the maintained UI shell for:

- `codex-wasm-core` runtime execution in the browser;
- browser-managed provider config and secret storage;
- streamed chat turns over the browser host runtime;
- approval-gated agent actions.

This app is not a generic chat clone and not an IDE clone.
It is a browser shell for Codex runtime semantics.

## Product Direction

We will borrow the external shell language from Open WebUI under
`/Users/olegromanchuk/Projects/open-webui/src`, but not its product scope.

What to borrow:

- application shell structure;
- left sidebar interaction model;
- top navbar + central transcript + bottom composer layout;
- modal/drawer patterns for settings and approvals;
- decomposition into focused Svelte components instead of one large `App.svelte`.

What not to borrow:

- large admin surface;
- RAG / knowledge / channels / sharing / uploads / voice / multimodal product scope;
- server-first assumptions;
- model orchestration logic in UI components.

## Confirmed V1 Scope

We are intentionally not building these yet:

- workspace browser;
- file viewer/search UI;
- diff or patch viewer;
- instruction editing UI for system/developer/user/skills/workspace context.

We do need:

- thread list and thread restore;
- transcript view with streaming assistant output;
- composer with multiline input;
- send, stop, retry, and clear thread actions;
- provider/router config UI;
- account/model refresh UI;
- approval flow for dangerous actions such as `apply_patch` and future tool execution;
- runtime event/log visibility for debugging and trust;
- browser-managed auth/secret state;
- explicit runtime status: idle, running, waiting for approval, failed.

## UX Shape

The initial layout should be:

1. Left sidebar:
   - new thread;
   - recent threads;
   - current model/provider summary;
   - quick settings entrypoint.
2. Main column:
   - top navbar with thread title/status/actions;
   - transcript with user, assistant, and runtime status blocks;
   - sticky composer at the bottom.
3. Right drawer or modal surfaces:
   - provider/config settings;
   - approvals;
   - runtime events/logs.

This keeps the main chat flow clean while still exposing Codex-specific runtime state.

## Core Screens And Components

The first decomposition target for `apps/webui/src`:

- `AppShell.svelte`
- `Sidebar.svelte`
- `ThreadList.svelte`
- `ThreadHeader.svelte`
- `Transcript.svelte`
- `MessageComposer.svelte`
- `ProviderSettingsModal.svelte`
- `ApprovalDrawer.svelte`
- `RuntimeEventsDrawer.svelte`
- `stores/*.ts` for UI state only

The existing runtime host integration from `examples/browser-chat-demo/src/runtime.ts` should be
used as the reference implementation for browser host wiring, but `apps/webui` should not be a
directory move or a light rename of the demo.

We should reimplement the product app with smaller modules while reusing proven runtime behavior
and transport semantics from the demo where appropriate.

Recommended split:

- `runtime/bootstrap.ts`
- `runtime/session.ts`
- `runtime/config.ts`
- `runtime/chat.ts`
- `runtime/approvals.ts`
- `runtime/events.ts`
- `runtime/types.ts`

## State Boundary

The boundary must stay strict:

- `codex-wasm-core` owns agent/runtime semantics;
- browser host runtime modules own storage, transport, and approvals;
- `apps/webui` owns presentation state and user interaction only.

We should not move turn orchestration or model protocol logic into Svelte components.

## Approval Model

Approvals are in scope for V1 because they are part of the Codex trust boundary.

Initial approval categories:

- `apply_patch`
- browser-host tool execution that mutates state
- future network-capable tool actions if added

Approval UX requirements:

- show pending action summary;
- allow approve or reject;
- show resolved outcome in transcript/events;
- block silent execution of gated actions.

## Thread Model

Even without workspace UI, the WebUI must be thread-first rather than message-first.

V1 requirements:

- create thread;
- restore persisted thread;
- switch between threads;
- clear/reset current thread;
- preserve transcript and runtime status across reloads.

## Technical Migration Plan

### Phase 0. Create Product App Shell

- create `codex-rs/wasm/apps/webui`;
- scaffold a fresh Vite/Svelte app for the product shell;
- use `examples/browser-chat-demo` only as a runtime integration reference;
- keep the demo untouched and runnable in parallel.

Exit criteria:

- the app builds and runs from `apps/webui`;
- the app can boot the runtime using the same verified integration approach as the demo;
- `examples/browser-chat-demo` still works independently.

### Phase 1. Break Up The Monolith

- split current `App.svelte` into shell, transcript, composer, config, and event components;
- split `runtime.ts` into focused runtime modules;
- introduce a small UI state layer with Svelte stores.

Exit criteria:

- no single product component should remain a giant catch-all file;
- chat/config/event behavior remains functionally equivalent to the current demo.

### Phase 2. Productize The Shell

- replace demo-oriented labels and debug-heavy copy with product UI copy;
- add a real sidebar/thread switcher;
- move settings and events into drawers/modals;
- expose runtime status and control actions more cleanly.

Exit criteria:

- the app no longer reads like a demo;
- the main flow is understandable without reading console logs.

### Phase 3. Add Approval UX

- wire approval requests from the browser runtime into a visible pending action queue;
- implement approve/reject actions in UI;
- persist or replay approval state as needed for safe turn handling.

Exit criteria:

- dangerous actions cannot execute silently;
- the user can understand what action is waiting and why.

## Design Guidance

Use Open WebUI as a visual reference for density, spacing, and shell composition, but keep the
actual product more minimal and more Codex-shaped.

Desired qualities:

- clean app shell;
- strong information hierarchy;
- readable transcript;
- compact but not cramped controls;
- desktop-first layout that still works on mobile.

Avoid:

- admin dashboard aesthetics;
- control overload;
- giant all-in-one settings pages;
- exposing every internal config knob in V1.

## Non-Goals For This Phase

- full repository browser;
- patch/diff visualization;
- in-browser code editor;
- ChatGPT account auth;
- Open WebUI feature parity;
- server-backed multi-user architecture.

## Immediate Next Step

The next implementation step after this plan is:

1. scaffold `apps/webui` from scratch;
2. wire runtime boot/chat/config flows by referencing `examples/browser-chat-demo`;
3. keep demo and product app runnable side by side.
