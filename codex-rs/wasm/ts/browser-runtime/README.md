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
- browser tool approval request/response types
- thread session/core types

## Security Contract

The browser runtime now enforces several security-relevant parts of the public
SDK contract:

- `runtime_mode` controls baseline browser-tool capability grants
- `browser_security` controls allowed browser origins plus explicit localhost
  and private-network opt-ins
- dangerous browser tools may require `requestBrowserToolApproval`
- `openai-compatible` provider `baseUrl` values are runtime-validated and may be
  blocked before model requests are sent

These checks are enforced by the runtime itself. Downstream UI is responsible
for presenting policy and approval UX, not for replacing runtime enforcement.

## Consumer Responsibilities

Browser SDK consumers are expected to:

- load and persist `CodexCompatibleConfig`
- explicitly set `runtime_mode` and `browser_security` when non-default behavior
  is desired
- provide `requestBrowserToolApproval` if they want the runtime to mediate
  dangerous browser tools instead of fail-closing them
- handle runtime validation errors from blocked provider URLs or denied browser
  tool actions

Browser SDK consumers are not expected to:

- re-implement browser tool policy decisions
- bypass runtime provider validation
- treat internal `@browser-codex/*` packages as the supported integration
  contract

## Approval Mediation

Dangerous browser tools can surface a browser-tool approval request through the
optional `requestBrowserToolApproval` callback on
`createBrowserCodexRuntimeContext(...)`.

The exported approval types are:

- `BrowserToolApprovalRequest`
- `BrowserToolApprovalResponse`

If `requestBrowserToolApproval` is omitted:

- dangerous browser tools fail closed
- the runtime returns structured blocked errors instead of executing the action

The first browser-tool approval contract is intentionally narrow and applies to:

- `browser__evaluate`
- `browser__inspect_http`
- `browser__navigate`

## Provider Validation

Built-in providers keep their runtime-owned allowlist validation.

For `openai-compatible` providers:

- custom endpoints must use absolute `https` URLs
- localhost and loopback are denied by default
- private-network and link-local targets are denied by default
- localhost access requires `browser_security.allow_localhost`
- private-network access requires `browser_security.allow_private_network`

This is a transport-layer runtime check. It is not mediated by the browser tool
approval callback.

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
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
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
  requestBrowserToolApproval: async (
    request: BrowserToolApprovalRequest,
  ): Promise<BrowserToolApprovalResponse> => {
    const allow = window.confirm(
      `Allow ${request.canonicalToolName} for ${request.displayOrigin}?`,
    );
    return {
      decision: allow ? "allow_once" : "deny",
    };
  },
});
```

## Config Notes

Relevant config fields for browser security:

- `runtime_mode`
  - `default`
  - `demo`
  - `chaos`
- `browser_security.allowed_origins`
- `browser_security.allow_localhost`
- `browser_security.allow_private_network`

Example:

```ts
const config: CodexCompatibleConfig = {
  ...DEFAULT_CODEX_CONFIG,
  runtime_mode: "demo",
  browser_security: {
    allowed_origins: ["https://app.example.com"],
    allow_localhost: false,
    allow_private_network: false,
  },
};
```

## Failure Modes

Consumers should treat the following as expected runtime behavior, not SDK bugs:

- dangerous browser tools fail when no approval mediator is configured
- browser tool requests fail when origin policy blocks the current page or
  target URL
- `openai-compatible` providers fail with `invalid_provider_base_url` when the
  target URL violates runtime transport policy

The runtime returns structured errors so consumers can render clear messages
without re-implementing the enforcement logic.

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
