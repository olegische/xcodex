# xcodex-runtime

XCodex WASM Runtime SDK for integrating the browser-hosted WASM app-server runtime into web applications.

This package provides a facade over the internal browser/WASM modules in `codex-rs/wasm/ts`:

- runtime context creation
- config helpers
- IndexedDB-backed storage
- browser workspace adapters and helpers
- type exports for browser runtime integrations

It is intended to be the public TypeScript SDK surface for the XCodex browser runtime.

## Status

This package is an early `v0.1.0` SDK surface for the XCodex WASM Runtime.

The intended public API is:

- `xcodex-runtime`
- `xcodex-runtime/assets`
- `xcodex-runtime/transport`
- `xcodex-runtime/workspace`
- `xcodex-runtime/config`
- `xcodex-runtime/storage`
- `xcodex-runtime/types`

Internal `wasm-*` packages should be treated as implementation details behind the XCodex WASM Runtime facade.

## Contracts

### Package contract

`xcodex-runtime` is the canonical browser integration SDK. Real browser consumers
should prefer root exports from `xcodex-runtime` and only use subpaths as an
optional organizational convenience.

Internal `@browser-codex/*` packages are runtime implementation details. They
are not part of the supported integration contract for external consumers.
`@browser-codex/wasm-runtime-client` specifically is a transitional internal
composition layer, not the browser SDK surface.

### Release bundle contract

The release tarball is a browser asset bundle, not an unpacked npm package. The
official tarball contract is:

```text
xcodex-wasm/
  manifest.json
  current/
    xcodex.js
    xcodex_bg.wasm
    xcodex-runtime.js
    xcodex-runtime.js.map
    xcodex.d.ts
    xcodex_bg.wasm.d.ts
```

Tarball consumers should load `manifest.json` and `current/*` assets and treat
`xcodex-runtime.js` as the single-file browser bundle for the root SDK API.
They should not assume npm package semantics such as `package.json`, package
subpath imports, or a `dist/` layout inside the tarball.

## Installation

```bash
pnpm add xcodex-runtime
```

## Exports

### `xcodex-runtime`

- `createBrowserCodexRuntimeContext`
- `createIndexedDbCodexStorage`
- `createLocalStorageWorkspaceAdapter`
- `createBrowserWorkspaceAdapter`
- `readWorkspaceFile`
- `listWorkspaceDir`
- `searchWorkspace`
- `applyWorkspacePatch`
- `loadStoredWorkspaceSnapshot`
- `saveStoredWorkspaceSnapshot`
- `normalizeWorkspaceFilePath`
- `normalizeWorkspaceDirectoryPath`
- `DEFAULT_CODEX_CONFIG`
- `DEFAULT_DEMO_INSTRUCTIONS`
- `XROUTER_PROVIDER_OPTIONS`
- `materializeCodexConfig`
- `normalizeCodexConfig`
- `detectTransportMode`
- `getActiveProvider`
- `activeProviderApiKey`
- `formatError`

### `xcodex-runtime/workspace`

- `createLocalStorageWorkspaceAdapter`
- `createBrowserWorkspaceAdapter`
- `readWorkspaceFile`
- `listWorkspaceDir`
- `searchWorkspace`
- `applyWorkspacePatch`
- `loadStoredWorkspaceSnapshot`
- `saveStoredWorkspaceSnapshot`
- `normalizeWorkspaceFilePath`
- `normalizeWorkspaceDirectoryPath`

### `xcodex-runtime/assets`

- `loadBuildManifest`
- `loadRuntimeModule`
- `loadXrouterRuntime`
- `toBrowserAssetUrl`
- `toBrowserModuleUrl`

### `xcodex-runtime/transport`

- `createBrowserRuntimeModelTransportAdapter`

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
  createIndexedDbCodexStorage,
  createLocalStorageWorkspaceAdapter,
  DEFAULT_CODEX_CONFIG,
} from "xcodex-runtime";
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
  workspace: createLocalStorageWorkspaceAdapter(),
});
```

## Workspace Adapter

`createBrowserCodexRuntimeContext()` expects a workspace adapter with four host methods:

- `readFile`
- `listDir`
- `search`
- `applyPatch`

The root `xcodex-runtime` entrypoint exposes the normal browser happy-path API.
`xcodex-runtime/workspace` remains available if you want direct helper imports
for manual adapter assembly:

```ts
import {
  applyWorkspacePatch,
  listWorkspaceDir,
  readWorkspaceFile,
  searchWorkspace,
} from "xcodex-runtime/workspace";

const workspace = {
  readFile: readWorkspaceFile,
  listDir: listWorkspaceDir,
  search: searchWorkspace,
  applyPatch: applyWorkspacePatch,
};
```

## Storage

`createIndexedDbCodexStorage()` is available from both `xcodex-runtime` and
`xcodex-runtime/storage`. It creates a generic IndexedDB-backed store for:

- auth state
- runtime config
- user config
- thread sessions

You can use your own storage implementation as long as it satisfies the exported `BrowserRuntimeStorage` contract.

## Build

```bash
cd /Users/olegromanchuk/Projects/xcodex/codex-rs/wasm
npm install
npm --workspace xcodex-runtime run build
```

The shared TypeScript toolchain lives at the `codex-rs/wasm` workspace root.
`apps/webui` consumes the built runtime artifacts; it does not define the SDK
build contract.

## License

Apache-2.0. See [LICENSE](./LICENSE).
