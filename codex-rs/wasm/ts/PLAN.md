# WASM TS Refactor Plan

## Purpose

This document defines the target architecture for `codex-rs/wasm/ts` and the
phased refactor plan needed to get there.

The current pain comes from mixing three different concerns:

1. SDK contract for integrators
2. Runtime implementation and browser adapters
3. Release/distribution format

The refactor goal is to make those concerns explicit, reduce coupling to demo
clients, and give tarball-only consumers a stable contract.

## Status

Current implementation status as of this plan update:

- Phase 1 is effectively complete.
- Phase 2 is largely complete.
- Phase 3 is effectively complete.
- Phase 4 is effectively complete for `ts/browser-runtime`.
- Phase 5 is effectively complete for the current SDK/internal package split.

What is already done:

- `browser-runtime/README.md` now documents the package contract, root API, and
  tarball/bundle contract.
- `TARBALL_CONTRACT.md` documents the canonical `xcodex-wasm.tar.gz` layout.
- `xcodex-runtime` root exports now include the browser happy-path API,
  including IndexedDB storage and workspace helpers.
- `xcodex-runtime` now owns browser-facing `assets` and `transport` entrypoints
  instead of delegating that SDK surface through `runtime-client`.
- `browser-runtime` no longer depends on `runtime-client` source modules for
  config, storage, assets, transport, or public types.
- `browser-runtime` no longer depends on `browser-host` for bootstrap/runtime
  host composition helpers.
- the `browser-runtime` build now runs from `codex-rs/wasm` workspace-root
  tooling instead of relying on demo-app-local install behavior.
- root entrypoint coverage exists for the browser happy-path API.
- `browser-host` now exposes MCP/browser-platform concerns instead of acting as
  a mixed public helper surface.
- `runtime-client` no longer exports browser-facing assets, transport, or
  workspace helpers from its package root.

What remains:

- trim compatibility exports and internal shims that are no longer needed after
  the SDK promotion work.
- optionally add a short follow-up status note or completion checklist once
  the remaining internal packages are pared down further.

## Current Problems

### Contract confusion

- `xcodex-runtime` behaves partly like an SDK package and partly like a release
  bundle façade.
- `xcodex-runtime.js` is published as a single-file bundle, but the package API
  is split across multiple entrypoints such as `storage`, `workspace`, and
  `types`.
- Tarball consumers expect package-style semantics, but the release format only
  guarantees browser assets.

### Build coupling

- Shared runtime bundling was coupled to `apps/webui` as a build host.
- Release CI historically installed dependencies under the demo app and then
  tried to bundle `ts/browser-runtime`.
- This inverted the intended dependency direction: `webui` should depend on the
  runtime SDK, not host its build environment.

### Unclear public surface

- Some browser integration helpers lived only in internal packages.
- Root exports did not consistently cover the real browser client happy path.
- Consumers had to add local fallbacks for missing release-bundle exports.

## Target Architecture

The TypeScript WASM layer should be treated as three explicit layers.

### 1. SDK Layer

Package: `xcodex-runtime`

Responsibility:

- provide the canonical browser integration API
- define the public TypeScript contract for integrators
- expose the browser happy-path API from the root entrypoint

This is the package a client should conceptually depend on.

### 2. Runtime Implementation Layer

Packages:

- `@browser-codex/wasm-browser-codex-runtime`
- `@browser-codex/wasm-browser-host`
- `@browser-codex/wasm-browser-tools`
- `@browser-codex/wasm-model-transport`
- `@browser-codex/wasm-runtime-client`
- `@browser-codex/wasm-runtime-core`

Responsibility:

- implement wasm/browser runtime behavior
- implement browser FS, tools, transport, telemetry, and low-level adapters
- remain internal implementation detail unless a package is intentionally
  promoted into the public SDK

These packages should be treated as internal runtime building blocks.

### 3. Distribution Layer

Artifact:

- `xcodex-wasm.tar.gz`

Responsibility:

- ship browser-ready assets
- define the release-bundle contract
- avoid pretending to be an unpacked npm package

This layer is a delivery format, not the canonical API definition.

## Canonical Contracts

### SDK Contract

The canonical developer-facing contract is the `xcodex-runtime` package API.

The root entrypoint must be sufficient for a real browser client to integrate
without reaching into internal packages or local fallback copies.

### Release Bundle Contract

The canonical tarball contract must be explicitly documented as:

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

The release tarball must not imply:

- npm package layout
- `package.json` availability
- `dist/` layout
- package subpath import support

## Public API Design

### Root happy-path API

The root `xcodex-runtime` API should include everything a tarball-only browser
consumer needs for normal integration.

Target root exports:

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
- config helpers already intended for integrators

Rule:

- if an external browser client realistically needs it, it should be available
  from the root entrypoint

### Optional subpaths

Subpaths may remain for organization and ergonomics:

- `xcodex-runtime/storage`
- `xcodex-runtime/workspace`
- `xcodex-runtime/types`
- `xcodex-runtime/config`

But subpaths must be optional convenience, not the only way to reach
browser-critical integration functionality.

### What stays internal

These packages should remain internal unless intentionally promoted:

- `@browser-codex/wasm-browser-codex-runtime`
- `@browser-codex/wasm-browser-host`
- `@browser-codex/wasm-browser-tools`
- `@browser-codex/wasm-model-transport`
- `@browser-codex/wasm-runtime-client`
- `@browser-codex/wasm-runtime-core`

Clients should not need direct imports from these packages for supported
integration scenarios.

## Package Responsibilities

### `browser-runtime`

Target role:

- canonical SDK package
- stable public browser integration API
- release bundle source-of-truth

Required properties:

- root exports cover happy path
- build does not depend on `apps/webui`
- README documents both package consumption and tarball consumption clearly

### `runtime-client`

Target role:

- transitional internal compatibility layer
- transport/config/runtime helpers shared by `browser-runtime`

Refactor direction:

- keep only internal composition utilities here
- move externally useful browser integration helpers into `browser-runtime`
- reduce external significance over time

### `browser-host`

Target role:

- browser runtime host implementation details
- internal browser platform functionality

Refactor direction:

- move browser-client-facing helpers out of `browser-host` when they become
  part of the public SDK contract
- keep host internals private where possible

### `runtime-core`

Target role:

- low-level shared runtime primitives
- host-value normalization, app-server client, shared types

Refactor direction:

- keep it focused on runtime primitives
- avoid turning it into a public integration surface unless there is a clear
  reason

## Build and Release Design

### Principles

- the shared runtime SDK must not be built through `apps/webui`
- workspace root is the build/install boundary for shared TypeScript runtime
  tooling
- release workflow must not depend on demo-app-local install layout

### Desired build shape

- `codex-rs/wasm` workspace root owns shared JS tool dependencies
- `ts/browser-runtime` can be built from workspace-root tooling
- `apps/webui` consumes the SDK; it does not host its build contract

### Release behavior

- release bundle is built from `ts/browser-runtime/src/index.ts`
- root exports in that entrypoint define the public single-file bundle surface
- release docs must describe `xcodex-runtime.js` as a bundle, not a package

## Refactor Phases

### Phase 1: Freeze the contracts

Status: complete

Deliverables:

- document the release tarball layout as the official bundle contract
- document the `xcodex-runtime` root happy-path API
- explicitly state that internal `@browser-codex/*` packages are not public
  integration dependencies

Acceptance criteria:

- no ambiguity about whether tarball implies npm package semantics
- no ambiguity about what `xcodex-runtime.js` is

### Phase 2: Finish public API promotion in `browser-runtime`

Status: mostly complete

Deliverables:

- move all browser-client-facing helpers needed by real consumers into
  `browser-runtime`
- re-export those helpers from the root entrypoint
- remove the need for consumer fallbacks such as local storage/workspace copies

Acceptance criteria:

- `xcodexui`-class consumers do not import internal `@browser-codex/*` packages
  for supported integration paths

### Phase 3: Make root bundle self-sufficient

Status: complete

Deliverables:

- ensure `xcodex-runtime.js` exports the full root happy-path API
- specifically include storage and workspace factories in the root bundle

Acceptance criteria:

- tarball-only consumer can integrate using only root bundle exports
- no local fallback for `createIndexedDbCodexStorage`

### Phase 4: Remove build coupling to demo clients

Status: mostly complete

Deliverables:

- keep shared build dependencies at workspace root or package-local scope
- remove remaining runtime SDK build assumptions tied to `apps/webui`

Acceptance criteria:

- release build does not require demo-client-local install behavior
- `apps/webui` is a consumer, not a build host

### Phase 5: Simplify internals

Status: effectively complete

Deliverables:

- reduce public-significant logic inside `runtime-client` and `browser-host`
- leave internal-only responsibilities where they belong
- trim legacy exports and compatibility shims no longer needed

Acceptance criteria:

- public integration path is easy to describe in one page
- internal package graph is less surprising

## Migration Strategy

### For tarball consumers

Short term:

- consume release assets from `manifest.json` and `current/*`
- import or load `xcodex-runtime.js` only through the root bundle contract

Medium term:

- rely only on root exports exposed by `xcodex-runtime.js`
- avoid assumptions about package subpaths inside tarballs

### For package consumers

Short term:

- prefer root `xcodex-runtime` exports whenever possible
- use subpaths only where there is a strong reason

Medium term:

- treat subpaths as optional organization, not required integration plumbing

## Documentation Work

Required docs after refactor:

- `browser-runtime/README.md`
  - package contract
  - release-bundle contract
  - root happy-path API
- release workflow comments
  - why the workflow installs/builds the way it does
- a short tarball contract note
  - either in release metadata docs or a dedicated markdown file

## Non-Goals

This refactor is not trying to:

- make the release tarball behave exactly like an npm package
- expose every internal helper publicly
- unify every internal package into one file or one source tree
- remove wasm/runtime knowledge from the SDK at all costs

## Decision Rules

Use these rules for future changes:

1. If a real external browser consumer needs it, put it in root `xcodex-runtime`
   exports.
2. If it only matters for internal runtime assembly, keep it in internal
   packages.
3. If it is published in `xcodex-wasm.tar.gz`, document it as a bundle asset,
   not a package file.
4. Demo clients must consume shared runtime artifacts, never define their build
   contract.
5. Prefer one obvious integration story over many partial stories.

## End State

At the end of this refactor:

- `xcodex-runtime` is clearly the browser integration SDK
- `xcodex-runtime.js` is clearly the single-file browser distribution of the
  root SDK API
- `xcodex-wasm.tar.gz` is clearly a release bundle, not a package
- `apps/webui` and `xcodexui` are clearly consumers
- internal `@browser-codex/*` packages stop leaking into consumer integration
  paths
