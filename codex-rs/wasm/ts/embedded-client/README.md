# xcodex-embedded-client

Primary browser SDK facade for the browser-hosted XCodex WASM runtime.

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
runtime and the recommended SDK surface for new browser integrations.

`xcodex-runtime` remains available as the lower-level runtime package for
compatibility and internal layering, but new browser consumers should import
from `xcodex-embedded-client`.

The intended public API is:

- `xcodex-embedded-client`
- `xcodex-embedded-client/assets`
- `xcodex-embedded-client/config`
- `xcodex-embedded-client/storage`
- `xcodex-embedded-client/transport`
- `xcodex-embedded-client/types`
- `xcodex-embedded-client/workspace`

## Distribution Model

`xcodex-embedded-client` is not intended as a separate package-manager product
for downstream browser apps.

It exists as a higher-level TypeScript SDK layer in this repository and is
expected to be bundled into the shipped browser runtime integration artifacts.

Today those browser bundles are published from the GitHub release tag:

- [xcodex-wasm](https://github.com/olegische/xcodex/releases/tag/xcodex-wasm)

In practice, the consumer-facing model is:

1. fetch or build the browser runtime bundle from this repository
2. ship the generated browser assets to the embedding app
3. have the embedding client integrate against the bundled runtime surface

This means embedders should think in terms of hosted browser assets and bundle
exports, not `pnpm add`, standalone npm package installation, or immutable-tag
release flows.

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

### `xcodex-embedded-client/assets`

Runtime asset loading helpers re-exported from `xcodex-runtime`.

### `xcodex-embedded-client/config`

Browser runtime config helpers and constants re-exported from `xcodex-runtime`.

### `xcodex-embedded-client/storage`

IndexedDB storage helpers re-exported from `xcodex-runtime`.

### `xcodex-embedded-client/transport`

Browser model transport helpers re-exported from `xcodex-runtime`.

### `xcodex-embedded-client/types`

Type-only exports for:

- embedded client contracts
- approval broker contracts
- stored thread summary contracts
- browser runtime/config/storage contracts

### `xcodex-embedded-client/workspace`

Browser workspace helpers re-exported from `xcodex-runtime`.

## Positioning

Use `xcodex-embedded-client` as the single public SDK surface for browser
integrations:

- import the high-level client facade from `xcodex-embedded-client`
- import browser runtime helpers from `xcodex-embedded-client/assets`,
  `xcodex-embedded-client/config`, `xcodex-embedded-client/storage`,
  `xcodex-embedded-client/transport`, and `xcodex-embedded-client/workspace`
- import shared contracts from `xcodex-embedded-client/types`

`xcodex-runtime` is the lower-level implementation layer underneath that
surface. It is still published, but it is no longer the preferred package for
new browser-facing integrations.

## Design Goal

`xcodex-runtime` owns low-level runtime creation, policy enforcement, storage,
workspace integration, and model transport, but new consumers should import
through `xcodex-embedded-client`.

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

The intended use is inside the repository's browser runtime bundle, or inside a
downstream application that consumes that generated bundle.

At the API level, the embedding surface looks like:

```ts
const approvalBroker = createBrowserToolApprovalBroker();

const client = createEmbeddedCodexClient({
  cwd: "/workspace",
  storage,
  workspace,
  approvalBroker,
});

const unsubscribe = await client.subscribe((notification) => {
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
