# wasm app-server Parity Plan

## Purpose

This plan defines the remaining work needed for `codex-rs/wasm/app_server` and
`codex-rs/wasm/browser` to act as a browser-hosted implementation of the
`codex-app-server` contract for external clients.

The goal is not to invent a browser-specific client contract.

The goal is:

- keep `codex-rs/app-server-protocol` as the only client-facing contract
- keep `codex-rs/wasm/app_server` as the owner of app-server semantics
- keep `codex-rs/wasm/browser` as a transport and host boundary only
- reach enough method and lifecycle parity that clients of the same class as
  `codexUI` can integrate with a different transport, but without remapping
  methods, notifications, or server-request semantics

## Source of Truth

The sources of truth are:

- `codex-rs/app-server-protocol`
- `codex-rs/app-server`

This means:

- method names must match protocol exactly
- request and response payloads must match protocol exactly
- notification names and payloads must match protocol exactly
- server request and `serverRequest/resolved` semantics must match upstream
- browser-specific deviations must stay below the protocol layer

## What Is Already Good Enough

The mirror-first structural work is largely in place.

Today:

- `codex-rs/wasm/app_server` owns request targeting, root request flow,
  thread-start flow, loaded-thread request flow, pending server request
  semantics, and loaded-thread event projection
- `codex-rs/wasm/browser` is now a thin browser host shell organized around:
  - `runtime`
  - `thread_host`
  - `event_bridge`
- browser transport is different, but the intent is now aligned with
  app-server protocol rather than a custom UI contract

This is the correct architecture for parity work.

## What Is Not Yet Parity

The main remaining gap is no longer ownership.

The main remaining gap is method coverage and behavior coverage.

For a client in the same class as `codexUI`, we are still missing enough of the
protocol surface that integration would stall even if transport wiring existed.

## Parity Target

### Client-facing contract

The browser-hosted runtime must expose the same conceptual API categories as
`codex-app-server`:

- client requests
- client notifications
- server notifications
- server requests
- server request resolution

No contract remapping should be required in the client.

Transport adaptation is acceptable.

Contract adaptation is not.

### Transport boundary

The browser integration layer is `codex-rs/wasm/browser`.

Its job is:

- bootstrap browser dependencies
- accept and emit app-server JSON-RPC messages
- host loaded-thread event pumps
- provide a browser packaging seam for tarball consumers

Its job is not:

- define new client methods
- rename notifications
- synthesize alternate server-request contracts
- reinterpret app-server payloads into a new protocol

## Required Parity Surface

### Tier 1: Core session flow

These methods and behaviors are required before a `codexUI`-class client can
reasonably operate on the browser runtime.

- `initialize`
- `thread/list`
- `thread/read`
- `thread/start`
- `turn/start`
- `turn/interrupt`
- `model/list`
- live `ServerNotification`
- live `ServerRequest`
- `serverRequest/resolved`

Status:

- largely implemented

### Tier 2: Core UX parity

These are the next required methods for a serious client integration.

- `config/read`
- `skills/list`
- `thread/resume`
- `thread/archive`
- `thread/unarchive`
- `thread/name/set`
- `thread/rollback`

Status:

- incomplete or absent

### Tier 3: Nice-to-have parity for richer clients

These matter for advanced UX, but should not block the first real integration.

- `generate-thread-title`
- `fuzzyFileSearch` or equivalent protocol-native composer search
- additional thread-management and app-management methods as needed

Status:

- mostly absent

### Out of scope for app-server parity

These are host capabilities, not core app-server parity.

They may be needed by a full product, but they should not distort the core
protocol plan.

- workspace roots persistence
- worktree creation
- home directory lookup
- project root creation and suggestion
- browser/native file upload helpers
- thread title cache persistence

These should live in a separate host capability layer above the app-server
contract.

## Workstreams

### Workstream A: Protocol fidelity

Goal:

Verify that all currently implemented wasm methods and notifications match
`codex-app-server-protocol` exactly, including error behavior where relevant.

Deliverables:

- explicit parity tests for implemented methods
- no browser-only notification aliases
- no legacy `server/request` or `server/request/resolved` shapes in the browser
  runtime contract

Done when:

- protocol-facing tests exercise the implemented wasm methods against exact
  protocol payload shapes

### Workstream B: Tier 2 method implementation

Goal:

Implement the missing Tier 2 methods in `codex-rs/wasm/app_server`.

Deliverables:

- `config/read`
- `skills/list`
- `thread/resume`
- `thread/archive`
- `thread/unarchive`
- `thread/name/set`
- `thread/rollback`

Done when:

- a protocol-native client can perform core thread lifecycle actions without
  desktop-only shims

### Workstream C: Browser packaging seam

Goal:

Make `codex-rs/wasm/browser` easy to consume from an external tarball-based
client without changing the protocol contract.

Deliverables:

- stable JS-facing runtime constructor
- stable `send` / `nextMessage` transport boundary
- documentation of runtime lifecycle and expected host bootstrap contract

Done when:

- an external web client can load the tarball, instantiate the runtime, and
  speak app-server protocol over the browser transport

### Workstream D: Compatibility validation

Goal:

Validate the wasm app-server surface against a real client profile rather than
assuming parity from code structure alone.

Deliverables:

- a concrete compatibility matrix for a `codexUI`-class client
- a list of remaining missing methods after first transport hookup
- protocol mismatches fixed in wasm rather than patched in the client

Done when:

- the first external client can be wired with transport-only changes and a short
  list of intentionally separate host capabilities

## Priority Order

### Phase 1: Lock protocol fidelity

Tasks:

- audit implemented notifications against `app-server-protocol`
- audit implemented server-request lifecycle against upstream semantics
- remove any remaining browser-only alias behavior if discovered
- add tests where fidelity is currently only implicit

Exit criteria:

- current implemented surface is trustworthy for external clients

### Phase 2: Implement Tier 2 methods

Tasks:

- add `config/read`
- add `skills/list`
- add `thread/resume`
- add `thread/archive`
- add `thread/unarchive`
- add `thread/name/set`
- add `thread/rollback`

Exit criteria:

- core thread management and session configuration flows used by a `codexUI`-class
  client are present in wasm app-server

### Phase 3: Validate browser packaging seam

Tasks:

- document browser runtime lifecycle
- confirm `send` / `nextMessage` is sufficient for an external transport client
- identify any missing bootstrap metadata needed by web consumers

Exit criteria:

- browser tarball consumer can integrate without protocol remapping

### Phase 4: Run client compatibility pass

Tasks:

- wire a real client backend to the wasm browser transport
- log every missing method or semantic mismatch
- fix mismatches in wasm implementation first
- leave only clearly separate host capabilities outside core parity scope

Exit criteria:

- app-server-compatible client integration is blocked only by intentionally
  separate host features, not by contract mismatch

## Immediate Next Tasks

The next implementation tasks should be:

1. Implement `config/read` in `codex-rs/wasm/app_server`.
2. Implement `skills/list` in `codex-rs/wasm/app_server`.
3. Implement `thread/archive`, `thread/unarchive`, and `thread/name/set`.
4. Implement `thread/resume` and `thread/rollback`.
5. After those land, run the first `codexUI` transport hookup and treat the
   resulting gaps as validation data, not as a reason to invent a new contract.

## Rules While Executing This Plan

1. Do not solve missing parity by inventing browser-only protocol shapes.
2. Do not ask the client to remap methods or notifications.
3. Fix mismatches in `wasm/app_server` whenever the issue is semantic.
4. Keep `wasm/browser` transport-only unless a responsibility is unavoidably
   browser-host-specific.
5. Keep host capabilities separate from core app-server parity work.
