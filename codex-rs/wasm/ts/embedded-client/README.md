# xcodex-embedded-client

High-level embedding client for the browser-hosted XCodex WASM runtime.

This package builds on top of [`xcodex-runtime`](../browser-runtime/README.md)
and provides the missing integration layer that most embedders otherwise end up
rewriting themselves:

- managed runtime context lifecycle with explicit invalidation
- browser-tool approval broker with pending-request queue
- merged runtime and approval notifications
- thread helpers backed by runtime APIs plus stored-session fallback
- stored thread summary/search helpers based on runtime-owned persistence

## Status

This package is an early `v0.1.0` embedding facade for the XCodex browser
runtime.

The intended public API is:

- `xcodex-embedded-client`
- `xcodex-embedded-client/types`

## Installation

```bash
pnpm add xcodex-embedded-client xcodex-runtime
```

## Exports

### `xcodex-embedded-client`

- `createBrowserToolApprovalBroker`
- `createEmbeddedCodexClient`
- `createEmbeddedCodexClientWithDeps`
- `formatBrowserToolApprovalReason`
- `listStoredThreadSummaries`
- `searchStoredThreadSummaries`
- `toStoredThreadSummary`
- `toStoredThreadReadResponse`
- `toIsoDateTime`

### `xcodex-embedded-client/types`

Type-only exports for:

- embedded client contracts
- approval broker contracts
- stored thread summary contracts

## Design Goal

`xcodex-runtime` owns low-level runtime creation, policy enforcement, storage,
workspace integration, and model transport.

`xcodex-embedded-client` owns the reusable embedding layer above that runtime:

- pending request mediation
- notification fanout
- context caching and reset
- convenient thread and model helpers

UI applications should still own presentation concerns such as:

- settings forms
- approval dialogs
- routing and screen state
- product-specific provider guidance text

## Example

```ts
import {
  createBrowserToolApprovalBroker,
  createEmbeddedCodexClient,
} from "xcodex-embedded-client";
import {
  createIndexedDbCodexStorage,
  createLocalStorageWorkspaceAdapter,
  DEFAULT_CODEX_CONFIG,
  normalizeCodexConfig,
} from "xcodex-runtime";

const approvalBroker = createBrowserToolApprovalBroker();

const client = createEmbeddedCodexClient({
  cwd: "/workspace",
  storage: createIndexedDbCodexStorage({
    dbName: "codex-wasm-browser-terminal",
    dbVersion: 1,
    defaultConfig: DEFAULT_CODEX_CONFIG,
    normalizeConfig: normalizeCodexConfig,
    getSessionId(session) {
      return session.metadata.threadId;
    },
    getSessionMetadata(session) {
      return session.metadata;
    },
  }),
  workspace: createLocalStorageWorkspaceAdapter({
    rootPath: "/workspace",
  }),
  approvalBroker,
});

const unsubscribe = client.subscribe((notification) => {
  console.log(notification.method, notification.params);
});

const thread = await client.startThread({
  cwd: "/workspace",
  model: null,
  experimentalRawEvents: false,
  persistExtendedHistory: true,
});

const pending = await client.getPendingServerRequests();
await client.replyToServerRequest(pending[0].id, {
  result: { decision: "allow_once" },
});

unsubscribe();
```
