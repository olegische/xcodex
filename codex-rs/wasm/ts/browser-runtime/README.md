# xcodex-runtime

XCodex WASM Runtime SDK for integrating the browser-hosted WASM app-server runtime into web applications.

This package provides a facade over the internal browser/WASM modules in `codex-rs/wasm/ts`:

- runtime context creation
- config helpers
- IndexedDB-backed storage
- type exports for browser runtime integrations

It is intended to be the public TypeScript SDK surface for the XCodex browser runtime.

## Status

This package is an early `v0.1.0` SDK surface for the XCodex WASM Runtime.

The intended public API is:

- `xcodex-runtime`
- `xcodex-runtime/config`
- `xcodex-runtime/storage`
- `xcodex-runtime/types`

Internal `wasm-*` packages should be treated as implementation details behind the XCodex WASM Runtime facade.

## Installation

```bash
pnpm add xcodex-runtime
```

## Exports

### `xcodex-runtime`

- `createBrowserCodexRuntimeContext`
- `DEFAULT_CODEX_CONFIG`
- `DEFAULT_DEMO_INSTRUCTIONS`
- `XROUTER_PROVIDER_OPTIONS`
- `materializeCodexConfig`
- `normalizeCodexConfig`
- `detectTransportMode`
- `getActiveProvider`
- `activeProviderApiKey`
- `formatError`

### `xcodex-runtime/storage`

- `createIndexedDbCodexStorage`

### `xcodex-runtime/types`

Type-only exports for:

- runtime context contracts
- storage contracts
- config types
- thread session/core types

## Example

```ts
import {
  createBrowserCodexRuntimeContext,
  DEFAULT_CODEX_CONFIG,
} from "xcodex-runtime";
import { createIndexedDbCodexStorage } from "xcodex-runtime/storage";
import type {
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from "xcodex-runtime/types";

const storage = createIndexedDbCodexStorage<
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata
>({
  dbName: "codex-browser-runtime",
  dbVersion: 1,
  defaultConfig: DEFAULT_CODEX_CONFIG,
  normalizeConfig(config) {
    return config;
  },
  getSessionId(session) {
    return session.metadata.threadId;
  },
  getSessionMetadata(session) {
    return session.metadata;
  },
});

const context = await createBrowserCodexRuntimeContext({
  cwd: "/workspace",
  storage,
  workspace: {
    async readFile(request) {
      return request;
    },
    async listDir(request) {
      return request;
    },
    async search(request) {
      return request;
    },
    async applyPatch(request) {
      return request;
    },
  },
});
```

## Workspace Adapter

`createBrowserCodexRuntimeContext()` expects a workspace adapter with four host methods:

- `readFile`
- `listDir`
- `search`
- `applyPatch`

Each method currently accepts and returns `JsonValue`, so the runtime can pass browser-host protocol payloads through the adapter boundary without exposing internal host implementation modules as public API.

## Storage

`createIndexedDbCodexStorage()` creates a generic IndexedDB-backed store for:

- auth state
- runtime config
- user config
- thread sessions

You can use your own storage implementation as long as it satisfies the exported `BrowserRuntimeStorage` contract.

## Build

```bash
pnpm --filter xcodex-runtime build
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
