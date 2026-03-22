# WASM Runtime Security Plan

## Status

This document is a working design and delivery plan for the security model of
`codex-rs/wasm`.

Current phase status:

- Phase 0 design review: complete
- Phase 1 config contract hardening: in progress
- Phases 2-5: not started

It is intentionally not an implementation checklist to execute blindly.

Important operating rule:

- every phase in this plan must be designed with the user separately before implementation starts
- do not jump ahead to later phases just because they are written down here
- anything marked as a phase is a design gate, not pre-approved implementation scope

This plan defines the security responsibilities of the browser-hosted WASM
runtime itself.

It also calls out the downstream responsibilities of `xcodexui`, but
`xcodexui` remains a separate consumer and is not the enforcement root.

## Why The Previous Plan Was Too Narrow

The earlier plan focused on:

- `runtimeMode`
- strict provider `baseUrl`
- filtering a few dangerous browser tools

That direction was correct, but incomplete.

The real problem is broader:

- `browser__evaluate` is arbitrary JavaScript execution in page context
- `browser__inspect_http` is already a network primitive
- provider `baseUrl` is a separate unrestricted network egress path
- browser interaction tools like click, fill, and navigate are side-effectful
- UI-only filtering is not enough because the runtime SDK is consumed by external clients
- approval plumbing is currently weak or absent on the browser path

So the correct target is not "hide a few tools".

The correct target is:

- capability firewall inside the runtime
- default deny semantics
- runtime-owned enforcement
- UI-owned mediation and consent

## Scope

This plan covers the browser runtime surface exported from `codex-rs/wasm`,
especially:

- `xcodex-runtime`
- runtime config materialization and normalization
- browser dynamic tool exposure and invocation
- browser model transport configuration
- capability and approval contracts needed by downstream UIs

This plan does not assume that the embedded demo web UI in this repository is
the primary consumer.

The authoritative consumer contract is the public browser runtime SDK used by
external clients such as `xcodexui`.

## Non-Goals

This plan does not try to solve:

- full browser XSS defense
- malicious third-party scripts already executing on the origin
- browser extension compromise
- secure secret storage redesign
- a generic cross-platform security model for every non-WASM Codex runtime

This plan improves safety against the agent/runtime surface.
It does not claim to fully secure a hostile browser environment.

## Core Principles

### 1. Default Deny

By default, the model should not have access to dangerous capabilities.

Not:

- "the model can do everything and we hide some things"

But:

- "the model gets only capabilities that the runtime explicitly grants"

### 2. Runtime Is The Enforcement Root

Security policy must be enforced inside the WASM runtime surface.

UI may:

- present policy
- explain risk
- collect consent
- persist grants

UI must not be the only place where policy exists.

### 3. Mediation Belongs To UI, Not Enforcement

The runtime decides whether a capability is structurally allowed.

The UI decides whether the human grants a specific action at runtime when a
human decision is required.

### 4. Unknown Must Not Inherit Full Power

New tools, aliases, and custom dynamic tool executors must not silently inherit
dangerous behavior.

Unknown or unclassified capability surface must fail closed.

### 5. Modes Are Presets, Not The Whole Security Model

`runtimeMode` is useful, but it is only a preset over a deeper capability model.

Modes alone are not enough.

### 6. Optional Architecture Hint Is Not An Enforcement Input

Consumers may choose to carry an architecture hint such as:

- `os`
- `wasm`

But for `codex-rs/wasm` this must not become an enforcement input.

The WASM runtime already knows it is the browser-hosted WASM runtime.

Therefore:

- if an architecture field is added, it is client-owned metadata only
- the WASM runtime must not trust or depend on that field for policy decisions
- browser security behavior must be derived from the runtime implementation
  itself, not from a mutable config value

## Threat Model

This plan is meant to reduce the following classes of risk:

1. Prompt-driven arbitrary JavaScript execution in the current page.
2. Prompt-driven reads of browser storage and cookies.
3. Prompt-driven network access to arbitrary domains or local/private hosts.
4. Prompt-driven page mutations such as clicks, fills, navigation, or form submission.
5. Token exfiltration through custom provider base URLs.
6. Capability bypass through alias names, custom dynamic tools, or discovery mismatches.
7. UI and runtime drifting apart so the UI claims one policy while the runtime executes another.

## Current Reality

This section describes the current state that motivates the plan.

### Dangerous Browser Tools

The current browser tool surface includes:

- storage inspection
- cookie inspection
- HTTP inspection
- page-context evaluation
- page mutation tools

That means the current surface already includes:

- sensitive reads
- network access
- arbitrary code execution
- side effects

### Provider Base URL Is Also A Security Surface

Provider selection is not just UX.

`baseUrl` is an egress channel carrying:

- model requests
- API keys
- potentially sensitive user prompts and workspace-derived content

So provider policy is part of runtime security, not just transport configuration.

### Existing Browser Approval Path Is Not Enough

The current browser runtime path does not yet provide a robust approval and
consent model for dangerous browser capabilities.

That means:

- we cannot rely on current approval plumbing as the final design
- runtime-owned capability enforcement must land before UI risk messaging is trusted

## Responsibility Split

## `codex-rs/wasm` Responsibilities

The runtime must own:

- the config contract for security-relevant settings
- provider `baseUrl` validation
- capability classification
- tool filtering in both discovery and invocation
- alias-aware enforcement
- default deny behavior for unknown browser capability surface
- approval request contracts for dangerous actions
- normalized error semantics when a capability is blocked

## `xcodexui` Responsibilities

Downstream UI must own:

- mode selection UI
- risk copy and visual warnings
- approval dialogs and consent UX
- persistence of session-level grants if the contract supports them
- rendering of pending approvals
- sending approval decisions back to the runtime

`xcodexui` must not:

- be the sole enforcement point
- invent policy that diverges from runtime policy
- bypass runtime policy with its own direct network or tool assumptions

## Security Model

## Layer 0: Runtime Identity

This plan applies to `codex-rs/wasm` specifically.

The WASM runtime does not need a config toggle to discover that fact.

If downstream clients want to attach architecture metadata for their own
purposes, that is allowed, but this runtime must not use that metadata as a
policy switch.

## Layer 1: Runtime Mode

Add `runtime_mode` to persisted config for the WASM runtime only.

Initial shape:

- `default`
- `demo`
- `chaos`

But mode is only a top-level preset.
It is not the final authority by itself.

## Layer 2: Authorization Scope Resolution

Built-in browser tools should not be modeled only as broad internal
"capabilities".

They should be modeled as authorization requests over explicit scopes using a
resource/action shape that can later map cleanly onto external authorization
systems such as OAuth-style scope strings.

The runtime should resolve each tool request into one or more required
authorization scopes.

Recommended scope naming style:

- `resource:action`
- or `resource.subresource:action` when more precision is needed

Examples:

- `browser.tools:read`
- `browser.page:read`
- `browser.dom:read`
- `browser.dom.html:read`
- `browser.interactives:read`
- `browser.storage:read`
- `browser.cookies:read`
- `browser.resources:read`
- `browser.performance:read`
- `browser.http:read`
- `browser.page:click`
- `browser.page:fill`
- `browser.page:navigate`
- `browser.page:wait`
- `browser.js:execute`

Important:

- scopes are implementation-defined by this runtime
- scopes must be stable and documented once introduced
- unknown tools or unresolved scope mappings must fail closed

If a tool cannot be confidently mapped to explicit scopes, it must be treated
as denied until explicitly classified.

## Layer 3: Runtime Policy

The runtime should evaluate a request using:

1. resolved required scopes
2. current `runtimeMode`
3. any explicit runtime policy rules
4. any approval state supplied through the approved contract

This means a tool is not simply "present" or "absent".

It is evaluated through a policy decision.

## Layer 4: UI Mediation

For actions that are structurally allowed by mode but require human consent,
the runtime must emit a structured approval request.

The UI then decides:

- deny
- allow once
- allow for session

The runtime executes only after the decision is returned through the runtime
contract.

## Proposed Mode Semantics

These are working semantics and must still be separately designed before
implementation.

### `default`

Allow only low-risk read surfaces by default.

Expected baseline:

- allow safe page inspection
- deny storage inspection
- deny cookie inspection
- deny arbitrary evaluation
- deny network tools by default
- deny mutation tools by default unless explicitly redesigned otherwise

### `demo`

Allow a wider surface, but still keep explicit danger boundaries.

Expected baseline:

- allow broader inspection capabilities
- allow selected mutations only if approved by UI
- allow selected network actions only if approved by UI
- still deny arbitrary evaluation unless this mode is explicitly redesigned to include it

### `chaos`

Expose the largest surface, but still require explicit unsafe labeling and
approval semantics for the highest-risk actions.

Important:

- `chaos` means "maximum available surface"
- it does not mean "silent execution with no warnings"

`code_exec` should still be noisy and explicit even in `chaos`.

## Scope Mapping Direction

The final mapping must be designed in its own phase, but the current direction
should look roughly like this.

### Baseline Read Scopes

- `browser__tool_search` -> `browser.tools:read`
- `browser__inspect_page` -> `browser.page:read`
- `browser__list_interactives` -> `browser.interactives:read`
- `browser__inspect_performance` -> `browser.performance:read`
- `browser__wait_for` -> `browser.page:wait`
- `browser__inspect_dom` without HTML expansion -> `browser.dom:read`

### Sensitive Read Scopes

- `browser__inspect_storage` -> `browser.storage:read`
- `browser__inspect_cookies` -> `browser.cookies:read`
- `browser__inspect_resources` -> `browser.resources:read`
- `browser__inspect_dom` with HTML expansion -> `browser.dom.html:read`

### Network Scopes

- `browser__inspect_http` -> `browser.http:read`
- any future browser-originated request tool -> an explicit `browser.http:*`
  or equivalent network scope
- provider transport paths remain a separate runtime security surface and are
  not granted by browser tool scopes

### Mutation Scopes

- `browser__click` -> `browser.page:click`
- `browser__fill` -> `browser.page:fill`
- `browser__navigate` -> `browser.page:navigate`

### Code Execution Scopes

- `browser__evaluate` -> `browser.js:execute`
- aliases like `browser__run_probe` -> `browser.js:execute`
- any future JS execution primitive -> explicit execute-style scope

## Provider Base URL Policy

## Goal

Provider `baseUrl` must be validated as part of runtime security policy.

## Rules

### `openai`

- canonical URL only
- normalize to `https://api.openai.com/v1`
- reject arbitrary overrides

### `xrouter-browser`

- canonical URL only for the selected upstream provider
- reject arbitrary overrides

### `openai-compatible`

- custom URL allowed
- but only through explicit validation rules

Recommended baseline:

- require `https:`
- reject empty hosts
- reject localhost
- reject loopback IPs
- reject private network ranges
- reject link-local and other local-only addressing

If local development support is needed later, it should be an explicit separate
policy knob, not silent acceptance.

## Why This Matters

Important design constraint for phase 1:

- `baseUrl` validation must not rely on persisted browser config integrity
- IndexedDB is only a storage mechanism, not a trust boundary
- provider URL enforcement must happen at the transport boundary where Codex
  hands a request to the model transport / router path
- config normalization may canonicalize or trim URLs, but transport must remain
  the enforcement root for provider URL restrictions

If `baseUrl` stays loose:

- API keys can be sent to arbitrary hosts
- user prompts can be exfiltrated
- the runtime has a bypass around browser tool policy

## Dynamic Tool Enforcement Architecture

## Required Property

Tool filtering must happen in both:

- `list()`
- `invoke()`

Filtering only discovery is insufficient.

## Required Property

Tool aliases must resolve through the same policy layer.

Examples:

- `browser__evaluate`
- `browser__run_probe`
- `browser__inspect_http`
- `browser__probe_http`

must not diverge in policy behavior.

## Required Property

Custom dynamic tool executors passed by downstream consumers must also go
through a runtime-owned policy wrapper.

The public SDK must not assume that the caller-provided executor is safe.

## Desired Shape

Introduce a policy-aware wrapper around the raw tool executor.

Suggested conceptual shape:

- raw executor exposes full underlying capability surface
- policy wrapper normalizes aliases to canonical tool identity
- policy wrapper resolves required scopes for the request
- policy wrapper checks mode-derived granted scopes
- policy wrapper checks approval state if required
- policy wrapper returns explicit authorization-style blocked errors

## Standard Authorization Model Direction

Phase 2 should follow standard authorization architecture patterns rather than
an ad hoc "tool toggle" design.

Recommended structure:

- authorization registry: canonical tool identity, aliases, scope resolution
- policy decision point (PDP): decides allow/deny from request context
- policy enforcement point (PEP): wraps `list()` and `invoke()` and enforces
  PDP decisions

This lines up with established policy-engine / enforcement separation and keeps
the runtime-owned enforcement root clear.

### Reference Material

The Phase 2 design should be implemented with the following references in mind:

- OAuth 2.0 scope semantics:
  [RFC 6749 §3.3](https://www.rfc-editor.org/rfc/rfc6749#section-3.3)
- Bearer-token authorization error semantics such as `insufficient_scope`:
  [RFC 6750 §3.1](https://www.rfc-editor.org/rfc/rfc6750#section-3.1)
- Resource indicators and resource-oriented authorization context:
  [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)
- Policy decision / policy enforcement separation:
  [OPA documentation](https://www.openpolicyagent.org/docs)
- Policy Enforcement Point definition:
  [NIST PEP glossary](https://csrc.nist.gov/glossary/term/policy_enforcement_point)
- Practical least-privilege and incremental-authorization guidance:
  [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)

These references do not dictate the exact WASM runtime implementation, but they
should inform:

- scope naming
- blocked error shape
- least-privilege defaults
- PDP / PEP separation
- future compatibility with external authorization systems

### Registry Responsibilities

The registry should own:

- canonical tool names
- alias mappings
- discovery-time scope requirements
- invoke-time scope resolution

Important:

- invoke-time resolution may depend on input, not only on tool name
- this is required for tools like DOM inspection where arguments can change the
  sensitivity of the request

### PDP Responsibilities

The policy decision point should accept at least:

- canonical tool name
- original requested tool name
- required scopes
- runtime mode
- request phase (`list` or `invoke`)
- request input when needed

And should return a structured decision:

- `allow`
- `deny`
- later phases may add `allow_with_approval`

### PEP Responsibilities

The enforcement point should:

- wrap both `list()` and `invoke()`
- filter denied tools from discovery
- block denied invocations even if the caller already knows the tool name
- normalize aliases before dispatch
- surface structured blocked errors

### Error Semantics

Blocked tool access should follow authorization-style error semantics.

Recommended baseline:

- code: `insufficient_scope`
- include canonical tool name
- include original requested tool name
- include required scopes
- include current `runtime_mode`
- include a stable machine-readable reason

This is intentionally close to OAuth bearer resource semantics and keeps the
door open for future integration with external permission systems.

### Deny-By-Default Rules

The following must be denied by default:

- unknown tools
- unknown aliases
- tools without explicit scope mappings
- custom browser dynamic tools without explicit authorization metadata
- any invoke path that bypasses discovery filtering

### Input-Sensitive Policy

Some tools must resolve scopes from both name and input.

Initial required case:

- `browser__inspect_dom`
  - without `includeHtml` -> `browser.dom:read`
  - with `includeHtml: true` -> `browser.dom.html:read`

The runtime must support this distinction from the beginning rather than
pretending all tool requests are name-only.

### Runtime Mode As Scope Grant Preset

`runtime_mode` should not directly hardcode tool names in policy checks.

Instead, each mode should expand to a granted-scope set.

Initial grant presets:

#### `default`

Grant:

- `browser.tools:read`
- `browser.page:read`
- `browser.dom:read`
- `browser.interactives:read`
- `browser.performance:read`
- `browser.page:wait`

Deny by omission:

- `browser.dom.html:read`
- `browser.storage:read`
- `browser.cookies:read`
- `browser.resources:read`
- `browser.http:read`
- `browser.page:click`
- `browser.page:fill`
- `browser.page:navigate`
- `browser.js:execute`

#### `demo`

Grant everything from `default`, plus:

- `browser.storage:read`
- `browser.cookies:read`
- `browser.resources:read`

Deny by omission:

- `browser.http:read`
- `browser.page:click`
- `browser.page:fill`
- `browser.page:navigate`
- `browser.js:execute`

#### `chaos`

Grant everything from `demo`, plus:

- `browser.http:read`
- `browser.page:click`
- `browser.page:fill`
- `browser.page:navigate`

Deny by omission:

- `browser.js:execute`

Important:

- `chaos` still does not silently permit arbitrary JS execution
- `browser.js:execute` remains denied until the explicit approval contract is
  designed and implemented

### Phase 2 Module Shape

Phase 2 should introduce new modules rather than growing `browser-tools.ts`
indefinitely.

Recommended split:

- `tool-authorization-registry.ts`
- `tool-policy.ts`
- `policy-aware-executor.ts`

Possible responsibilities:

- `tool-authorization-registry.ts`
  - canonical names
  - aliases
  - request-to-scope resolution
- `tool-policy.ts`
  - granted scopes per runtime mode
  - decision function
  - blocked error builders
- `policy-aware-executor.ts`
  - wrap raw executor
  - enforce decisions in `list()` and `invoke()`

## Approval And Consent Contract

This is a separate phase and must be designed before implementation.

But the plan direction is clear.

## Requirements

The browser runtime needs a structured approval contract for dangerous actions.

It must support at least:

- request metadata
- capability type
- tool name
- target domain or origin if applicable
- human-readable summary
- structured decision response

## Decision Types

Minimum decision set:

- deny
- allow once
- allow for session

Avoid default "allow forever" semantics.

## UI Contract Requirement

The runtime contract must be strong enough that downstream UI can:

- list pending approvals
- render the risk clearly
- return the human decision
- persist session-scoped grants if allowed

## Important Constraint

Approval is not a substitute for capability policy.

Approval only applies after runtime policy says:

- this action is potentially allowed in this mode
- but requires user mediation

## Evaluate Policy

`browser__evaluate` is the sharpest edge in the current browser runtime.

This plan treats it as:

- `code_exec`
- not a normal inspection tool
- not a feature that should silently run in ordinary mode

## Working Direction

- deny in `default`
- deny in `demo` unless a later design explicitly changes that
- expose only in `chaos`
- even in `chaos`, require explicit unsafe labeling and approval flow

If a later phase wants a safer scripting primitive, that should be a different
tool with a different contract, not a rebranding of arbitrary page-context JS.

## Downstream Consumer Guidance

The runtime must be safe even when consumed by an external client.

So this plan assumes:

- external UI may provide custom storage
- external UI may provide custom tool executors
- external UI may provide its own request/approval surface

Therefore:

- runtime enforcement cannot trust the client to do the right thing
- public SDK contracts must encode enough information to preserve security

## `xcodexui` Follow-Up Responsibilities

This is not implementation scope for this file, but it matters for planning.

`xcodexui` will need follow-up work to:

- load and save `runtimeMode`
- surface mode risk clearly
- lock or constrain strict provider base URLs
- stop using direct policy-bypassing network paths where possible
- implement real approval handling instead of placeholder responses
- render and answer pending approval requests

That downstream work depends on the runtime contract from this plan.

## Delivery Strategy

This plan must be delivered in phases.

Every phase below requires separate design review with the user before coding.

Do not skip phase review.

## Phase 0: Shared Design Pass

Goal:

- agree on the security model before any implementation

Design topics:

- exact threat model
- capability taxonomy
- what `default`, `demo`, and `chaos` should truly mean
- whether mutation tools belong in `default`
- whether `demo` should ever include `evaluate`
- what explicit approvals are required

Implementation status:

- not approved by this document alone

## Phase 1: Config Contract Hardening

Goal:

- add security-relevant runtime shape without coupling enforcement to UI or
  trusting persisted browser config

Expected outputs:

- optional architecture metadata may exist for downstream clients, but is not
  runtime enforcement input
- `runtime_mode` in WASM config types only
- normalization and migration behavior for legacy WASM config without
  `runtime_mode`
- transport-layer provider `baseUrl` validation contract

Phase 1 design decisions currently agreed:

- `runtime_mode` keeps snake_case naming and is WASM-only
- any architecture field is optional client-owned metadata and is not enforced
  by the WASM runtime
- provider URL validation is enforced in the transport adapter / router
  boundary, not by trusting IndexedDB config contents

Phase 1 implementation status:

- done: added `runtime_mode` to the WASM browser config contract
- done: legacy config without `runtime_mode` now normalizes to the safe default
  `default`
- done: optional architecture metadata may be carried through config as
  client-owned metadata only
- done: web UI config materialization preserves the new runtime metadata fields
- done: provider `baseUrl` validation now happens at the browser transport
  boundary
- done: strict allowlist enforcement is active for `openai`
- done: strict allowlist enforcement is active for `xrouter_browser`
- done: `openai_compatible` remains intentionally unrestricted at the `baseUrl`
  level
- done: regression tests cover config normalization and provider URL
  validation

Remaining phase 1 scope:

- none for the agreed phase 1 design

Must be designed separately before implementation.

## Phase 2: Tool Classification And Policy Wrapper

Goal:

- introduce runtime-owned authorization scope resolution and policy enforcement

Expected outputs:

- built-in tool-to-scope registry
- alias normalization through the policy layer
- deny-by-default policy for unknown or unmapped tools
- wrapper enforcement in `list()` and `invoke()`
- structured authorization-style blocked errors
- input-sensitive scope resolution where needed
- mode-to-scope grant presets for `default`, `demo`, and `chaos`

Phase 2 implementation plan:

1. Introduce a dedicated authorization registry module for built-in browser
   tools.
2. Normalize aliases to canonical tool identity in one place.
3. Resolve required scopes from tool name and input.
4. Introduce a policy decision function that evaluates:
   - required scopes
   - current `runtime_mode`
   - request phase (`list` or `invoke`)
5. Wrap raw tool discovery so denied tools are filtered out of `list()`.
6. Wrap raw invocation so denied requests are blocked before dispatch.
7. Ensure aliases and canonical names always share the same policy path.
8. Fail closed for custom browser dynamic tools unless they register explicit
   authorization metadata.
9. Add regression tests for:
   - discovery filtering
   - invoke blocking
   - alias parity
   - unknown tool denial
   - input-sensitive DOM inspection policy
   - `browser.js:execute` denial in all modes

Phase 2 review checkpoints:

- confirm final scope names before committing them as public contract
- confirm whether `browser.resources:read` belongs in `demo`
- confirm whether `browser.page:wait` should stay in `default`
- confirm whether future custom tools must declare scopes at registration time

Must be designed separately before implementation.

## Phase 3: Approval Contract

Goal:

- define structured human mediation for dangerous actions

Expected outputs:

- approval request payload shape
- approval response payload shape
- session-grant semantics
- runtime error behavior when no mediator exists

Must be designed separately before implementation.

## Phase 4: Network And Provider Integration

Goal:

- align tool policy and provider egress policy

Expected outputs:

- runtime policy for browser network tools
- runtime policy for provider base URLs
- private-network and localhost handling
- explicit story for local development exceptions if needed

Must be designed separately before implementation.

## Phase 5: Downstream Integration Contract

Goal:

- make the public SDK safe and consumable for clients like `xcodexui`

Expected outputs:

- updated public types
- updated README and integration docs
- explicit consumer responsibilities
- clear failure modes for clients that do not implement approval mediation

Must be designed separately before implementation.

## Testing Expectations

The final implementation should be test-covered, but the exact tests belong to
the corresponding phase design.

At minimum we should eventually cover:

1. config normalization backfills `runtimeMode`
2. strict provider URL validation works for all provider types
3. blocked tools are hidden from `list()`
4. blocked tools are rejected from `invoke()`
5. alias names follow the same policy as canonical names
6. unknown tools fail closed
7. `code_exec` tools are denied outside their allowed mode
8. network tools respect policy
9. approval-required tools fail predictably when no mediator is present
10. approval decisions are applied correctly for once vs session scope

## Documentation Requirement

When this work lands, documentation must be updated in the runtime-facing docs,
not only in implementation notes.

At minimum:

- public runtime README
- config contract docs if they exist
- downstream integration notes for approval handling

## Final Constraint

This plan is a roadmap for discussion and staged design.

It is intentionally more detailed than an implementation ticket so that we do
not improvise security model changes while coding.

Writing a phase here does not authorize implementation of that phase.

Each phase must be separately designed with the user before work begins.
