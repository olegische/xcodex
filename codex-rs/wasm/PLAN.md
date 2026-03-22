# WASM Runtime Modes And Provider Policy Plan

## Status

This document is the working plan for the `codex-rs/wasm` side.

It covers:
- strict provider `baseUrl` policy
- runtime modes as part of the main wasm config
- dynamic tool filtering by mode

It does not claim that broader `xcodex` changes are already designed. Any work outside the wasm runtime surface is noted as a hypothesis and must be designed separately by the `xcodex` side.

## Goals

1. Make runtime mode part of the persisted wasm config, not a UI-only toggle.
2. Enforce strict `baseUrl` validation for every provider except `openai-compatible`.
3. Make tool exposure and tool invocation mode-aware inside the wasm runtime itself.
4. Keep UI as a thin editor of policy, not the policy enforcement point.

## Runtime Modes

Add a new field to the wasm config model:

- `runtimeMode: "default" | "demo" | "chaos"`

Mode semantics:

- `default`
  - dangerous tools disabled
  - specifically disable:
    - `browser__inspect_storage`
    - `browser__inspect_cookies`
    - `browser__evaluate`
- `demo`
  - enable all current browser tools except `browser__evaluate`
  - specifically allow:
    - `browser__inspect_storage`
    - `browser__inspect_cookies`
  - still disable:
    - `browser__evaluate`
- `chaos`
  - enable all current browser tools
  - includes:
    - `browser__evaluate`

## Config Contract Changes

Primary files:

- `ts/browser-runtime/src/types/config.ts`
- `ts/browser-runtime/src/config.ts`

Planned changes:

1. Extend `CodexCompatibleConfig` with `runtimeMode`.
2. Extend `DEFAULT_CODEX_CONFIG` with `runtimeMode: "default"`.
3. Extend `materializeCodexConfig()` to accept `runtimeMode`.
4. Extend `normalizeCodexConfig()` so old configs without `runtimeMode` normalize to `default`.
5. Ensure any downstream helpers preserve `runtimeMode` instead of dropping it during re-materialization.

## Strict Base URL Policy

Primary file:

- `ts/browser-runtime/src/config.ts`

Rule set:

- `openai`
  - only allow canonical OpenAI URL
  - target should normalize to `https://api.openai.com/v1`
- `xrouter-browser`
  - only allow canonical URL for the selected `xrouterProvider`
  - no arbitrary override
- `openai-compatible`
  - allow custom `baseUrl`
  - this remains the only flexible provider mode

Implementation direction:

1. Introduce a helper like `validateAndResolveProviderBaseUrl(...)`.
2. Parse with `new URL(...)`.
3. Strip trailing slash noise.
4. For `openai` and `xrouter-browser`, reject non-canonical origins and paths.
5. For `openai-compatible`, keep custom URL support.
6. Use this helper from `createProviderConfig()` so enforcement happens at config materialization time.
7. Reuse the same validation path from any settings or migration helper to avoid split policy.

Open policy question for wasm side:

- Whether `openai-compatible` should require `https:` only, or whether local `http://localhost` is intentionally allowed.

My recommendation:

- default to `https:` for `openai-compatible`
- if local HTTP support is needed later, design it as an explicit separate policy knob rather than silent acceptance

## Tool Filtering Architecture

Primary files:

- `ts/browser-tools/src/browser-tools.ts`
- `ts/browser-runtime/src/runtime-context-core.ts`
- `ts/browser-runtime/src/types/runtime.ts`

Desired architecture:

1. Keep `createBrowserAwareToolExecutor()` as the raw full-capability executor.
2. Add a wrapper executor that is mode-aware.
3. Resolve current mode from persisted config via `loadConfig()`.
4. Filter tools in both places:
   - `list()`
   - `invoke()`

This is mandatory:

- filtering only in `list()` is insufficient
- `invoke()` must reject forbidden tools even if a caller bypasses discovery

Suggested shape:

- `createModeAwareToolExecutor({ base, loadConfig })`
- `isToolAllowedInRuntimeMode(toolName, runtimeMode)`
- `listAllowedBrowserTools(runtimeMode)`

Error behavior:

- reject explicitly, for example:
  - `Tool browser__evaluate is disabled in default mode.`

## Tool Policy Matrix

Current policy proposal:

- `default`
  - allow:
    - `browser__tool_search`
    - `browser__inspect_page`
    - `browser__inspect_dom`
    - `browser__list_interactives`
    - `browser__click`
    - `browser__fill`
    - `browser__navigate`
    - `browser__wait_for`
    - `browser__inspect_http`
    - `browser__inspect_resources`
    - `browser__inspect_performance`
  - deny:
    - `browser__inspect_storage`
    - `browser__inspect_cookies`
    - `browser__evaluate`

- `demo`
  - allow everything from `default`
  - additionally allow:
    - `browser__inspect_storage`
    - `browser__inspect_cookies`
  - deny:
    - `browser__evaluate`

- `chaos`
  - allow everything, including:
    - `browser__evaluate`

If new browser tools are added later, they must not silently inherit `chaos` behavior by accident. The mode policy should therefore be explicit and test-covered.

## Runtime Wiring

Primary file:

- `ts/browser-runtime/src/runtime-context-core.ts`

Plan:

1. Build raw tools with `options.dynamicTools ?? deps.createBrowserAwareToolExecutor()`.
2. Wrap them with a mode-aware executor before passing into runtime deps.
3. The wrapper should use the same persisted config source that runtime already uses.

Reason:

- mode must be enforced in the runtime execution path, not only in app-specific shells
- every consumer of `createBrowserCodexRuntimeContext()` should get identical policy behavior by default

## Compatibility And Migration

Required behavior:

- old configs load as `runtimeMode: "default"`
- no manual migration step should be required
- UI can safely start reading the field once the updated runtime bundle ships

## Tests

Minimum test coverage expected in `codex-rs/wasm`:

1. `normalizeCodexConfig()` backfills `runtimeMode: "default"`.
2. `materializeCodexConfig()` preserves explicit mode.
3. `openai` rejects non-canonical `baseUrl`.
4. `xrouter-browser` rejects non-canonical `baseUrl`.
5. `openai-compatible` still allows custom `baseUrl`.
6. mode-aware executor hides forbidden tools in `list()`.
7. mode-aware executor rejects forbidden tools in `invoke()`.
8. `chaos` allows `browser__evaluate`.
9. `demo` denies `browser__evaluate`.
10. `default` denies storage and cookies inspection tools.

## UI Impact For Consumers

Expected downstream consumer behavior after wasm core lands:

- UI reads `runtimeMode` from config
- UI writes `runtimeMode` through normal config save flow
- UI can render mode-specific warnings, but runtime remains the source of truth

## XCodex Hypotheses

The following items are hypotheses only and are not part of this wasm plan unless separately designed upstream:

- a shared cross-runtime policy model between wasm and non-wasm Codex runtimes
- generic approval semantics shared with desktop/app-server flows
- a central security classification system for all tools, not only browser wasm tools
- server-side or core-level policy inheritance outside browser wasm

If `xcodex` wants a single policy contract across runtimes, that must be designed separately. For now, this plan is intentionally scoped to `codex-rs/wasm`.

## Recommended Delivery Order

1. Add `runtimeMode` to wasm config types and normalization.
2. Add strict provider `baseUrl` validation.
3. Add mode-aware tool policy wrapper.
4. Wire wrapper into runtime context creation.
5. Add tests for config and tool policy.
6. Publish updated wasm runtime artifacts.
7. Only after that, adapt `xcodexui` UI and gateway behavior.
