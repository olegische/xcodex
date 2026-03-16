# codexui Integration Plan

## Goal

Build a dedicated compatibility package for `codexUI` on top of the canonical WASM runtime.

This package must let a `codexUI`-class client run against browser-native Codex without changing
the client's domain contract. The runtime remains canonical in:

- `codex-rs/wasm/app_server`
- `codex-rs/wasm/browser`

The `codexui` integration package owns only compatibility ingress and browser host capabilities.

## Architectural Rule

`codex-rs/wasm/integrations/codexui` is not a second runtime and not a second app-server.

It is a compatibility package that:

- hosts `WasmBrowserRuntime`
- exposes the transport surface expected by `codexUI`
- forwards canonical app-server requests into the WASM runtime
- surfaces browser-specific helper capabilities needed by `codexUI`

It must not:

- redefine app-server semantics
- fork the app-server protocol
- move runtime ownership out of `wasm/app_server`

## Package Responsibility Split

### Owned by `wasm/app_server`

- app-server protocol semantics
- request routing
- thread lifecycle
- turn lifecycle
- config read/write semantics
- skills semantics
- server request lifecycle

### Owned by `wasm/browser`

- wasm-bindgen boundary
- browser host bootstrap
- browser transport queueing
- runtime message ingress/egress

### Owned by `wasm/integrations/codexui`

- `/codex-api/*` compatibility ingress
- codexUI transport contract emulation
- SSE / WebSocket / polling compatibility behavior
- compatibility shaping for pending server requests
- browser capability endpoints used by `codexUI`

## Public Contract of the Package

The package should export a bootstrap API along these lines:

```ts
type CodexUiWasmAdapter = {
  rpc(body: { method: string; params?: unknown }): Promise<unknown>
  subscribeNotifications(cb: (notification: unknown) => void): () => void
  listPendingServerRequests(): Promise<unknown[]>
  respondServerRequest(body: { id: number; result?: unknown; error?: unknown }): Promise<void>
  methodCatalog(): Promise<string[]>
  notificationCatalog(): Promise<string[]>
}
```

And optionally an HTTP-style adapter:

```ts
type CodexUiHttpCompatibility = {
  handleRpc(request: Request): Promise<Response>
  handleEvents(request: Request): Promise<Response>
  handlePendingServerRequests(request: Request): Promise<Response>
  handleRespondServerRequest(request: Request): Promise<Response>
}
```

The exact API may differ, but the package must support both:

- direct in-process integration
- wrapping into a tiny local browser/server bridge if needed

## Compatibility Surface for `codexUI`

### Core endpoints backed by canonical app-server

- `POST /codex-api/rpc`
- `GET /codex-api/meta/methods`
- `GET /codex-api/meta/notifications`
- `GET /codex-api/server-requests/pending`
- `POST /codex-api/server-requests/respond`
- `GET /codex-api/events`
- `GET /codex-api/ws`

These must forward into `wasm/browser` and `wasm/app_server` without semantic remap of app-server
methods.

### Browser host capability endpoints

These are not app-server protocol and should be implemented in the integration package or its host
capability submodules:

- `GET /codex-api/workspace-roots-state`
- `PUT /codex-api/workspace-roots-state`
- `POST /codex-api/worktree/create`
- `GET /codex-api/home-directory`
- `POST /codex-api/project-root`
- `GET /codex-api/project-root-suggestion`
- `POST /codex-api/composer-file-search`
- `POST /codex-api/thread-search`
- `GET /codex-api/thread-titles`
- `PUT /codex-api/thread-titles`
- `POST /codex-api/upload-file`

Additional optional surface:

- `skills-hub/*`
- `transcribe`
- local browse helpers

These should be clearly separated from canonical app-server forwarding.

## Required Internal Modules

The package should likely be split into modules like:

- `runtime-host.ts`
  Creates and owns `WasmBrowserRuntime`.

- `rpc-bridge.ts`
  Converts codexUI RPC ingress into runtime `send(...)`.

- `notification-stream.ts`
  Fans out runtime messages into notification subscribers, SSE, or WebSocket sinks.

- `server-requests.ts`
  Tracks pending server requests in codexUI-compatible shape.

- `capabilities/`
  Browser capability endpoints and storage-backed helpers.

- `catalog.ts`
  Method and notification catalog exposure.

- `http-compat.ts`
  Optional thin HTTP-style facade for `/codex-api/*`.

## Phase Plan

### Phase 1: Minimal core bridge

Deliver a package that supports:

- `rpc`
- notification subscription
- pending server requests
- respond server request
- method catalog
- notification catalog

Success criteria:

- `codexUI` can initialize
- `thread/list`
- `thread/read`
- `thread/start`
- `turn/start`
- `turn/interrupt`
- approvals work

### Phase 2: Browser capability layer

Add capability modules for:

- workspace roots state
- project root helpers
- composer file search
- thread title cache
- upload handling

Success criteria:

- `codexUI` can run without stubbing its current helper calls

### Phase 3: Delivery shape

Support one or both distribution forms:

- direct JS package integration
- HTTP compatibility wrapper over the JS package

Success criteria:

- external client can “install package, point client at it, run wasm runtime”

## Capability Storage Model

The package should rely on browser-backed stores, not filesystem assumptions.

Likely storage buckets:

- thread session storage
- config storage
- workspace roots preferences
- thread title cache
- upload blobs / references

Where possible, reuse existing runtime host seams instead of inventing parallel persistence paths.

## Non-Goals

- Rewriting `codexUI`
- Moving client quirks into `wasm/app_server`
- Forking app-server protocol
- Making `wasm/browser` own client-specific helper semantics

## Definition of Done

This package is done for first release when:

- `codexUI` can run against it without app-server contract remapping
- only transport hookup is needed client-side
- helper endpoints used by `codexUI` are available or intentionally stubbed behind explicit flags
- canonical runtime ownership still lives in `wasm/app_server` and `wasm/browser`

## Immediate Next Step

Implement package skeleton:

- create package/module entrypoint
- create runtime host wrapper
- create `rpc + notifications + pending server requests` bridge
- wire minimal method/notification catalogs
