# Architecture

This document describes the high-level architecture of `codex-rs/wasm/ts`.
Read this together with `PLAN.md`:

- `PLAN.md` describes the refactor and migration work.
- `ARCHITECTURE.md` describes the intended steady-state layout.

## Bird's Eye View

`codex-rs/wasm/ts` exists to ship a browser-facing SDK for the WASM Codex
runtime without confusing three different concerns:

1. the SDK contract for integrators
2. the internal runtime implementation
3. the release bundle format

The top-level rule is:

- `xcodex-runtime` is the canonical browser SDK
- internal `@browser-codex/*` packages are implementation details
- `xcodex-wasm.tar.gz` is a browser asset bundle, not an npm package

## Code Map

### `browser-runtime`

This is the SDK boundary.

If you are deciding where a browser-facing helper should live, start here.
This package owns:

- the public root API
- browser-facing workspace/storage/config helpers
- browser-facing asset loading helpers
- browser-facing transport helpers
- browser runtime context assembly

Architecture invariant:

- external browser consumers should be able to integrate through
  `xcodex-runtime` without reaching into internal `@browser-codex/*` packages
  for supported paths.

### `browser-codex-runtime`

This package contains the low-level runtime adapter around the WASM app-server
protocol runtime.

It is not the SDK contract.
Think of it as the runtime engine that `browser-runtime` composes.

### `browser-tools`

Browser-specific tools and telemetry.

This package owns:

- browser-safe tool execution adapters
- page telemetry collection
- browser sandbox tool behavior

These are runtime implementation details unless a helper is intentionally
promoted into `browser-runtime`.

### `model-transport`

Transport and model-stream execution primitives.

This package owns:

- Responses API streaming execution
- XRouter browser execution
- browser model transport adapter primitives

Architecture invariant:

- this package is transport machinery, not the browser SDK façade

### `runtime-core`

Low-level shared runtime primitives.

This package owns:

- app-server client glue
- host-value normalization
- shared runtime protocol types
- dynamic tool name normalization

Architecture invariant:

- `runtime-core` stays low-level and shared
- it should not accrete browser integration surface just because it is widely
  depended on

### `browser-host`

Browser platform and MCP-specific host functionality that remains internal to
the runtime implementation layer.

Current intended scope:

- remote MCP browser integration
- MCP OAuth browser flows

Architecture invariant:

- browser-host should not act as a second SDK façade

### `runtime-client`

Transitional internal placeholder.

Historically this package carried browser-facing helpers that have now been
promoted into `browser-runtime`.

Current intended scope:

- do not grow new public-significant API here
- remove the package entirely once any remaining non-`ts/` consumers are
  migrated off it

## Boundaries

### SDK boundary

`browser-runtime` is the public boundary.

Rules at this boundary:

- root exports should cover the normal browser integration path
- subpaths are optional organization, not required plumbing
- browser-facing documentation should describe this package first

### Internal runtime boundary

`browser-codex-runtime`, `browser-tools`, `model-transport`, `runtime-core`,
`browser-host`, and the remaining `runtime-client` placeholder are all internal.

Rules at this boundary:

- optimize for clear responsibilities, not for public ergonomics
- do not treat package roots as stable integration contracts unless explicitly
  promoted

### Distribution boundary

The release bundle contract is:

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

Architecture invariant:

- the tarball is a bundle contract only
- it must not imply npm package semantics such as `package.json`, `dist/`, or
  package subpath imports

## Cross-Cutting Invariants

- `browser-runtime/src/index.ts` defines the public root bundle surface.
- if a real external browser client needs a helper for supported integration,
  prefer putting it in `browser-runtime`.
- demo apps are consumers of shared runtime artifacts, not owners of the SDK
  build contract.
- workspace-root JS tooling under `codex-rs/wasm` is the build boundary for the
  shared TypeScript runtime packages.
- internal packages may change shape as responsibilities are clarified; the SDK
  contract should stay simpler than the internal package graph.
