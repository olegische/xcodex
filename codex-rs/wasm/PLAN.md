# WASM Runtime Security Plan

## Status

This document is a working design and delivery plan for the security model of
`codex-rs/wasm`.

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

## Layer 1: Runtime Mode

Add `runtimeMode` to persisted config.

Initial shape:

- `default`
- `demo`
- `chaos`

But mode is only a top-level preset.
It is not the final authority by itself.

## Layer 2: Capability Classification

Every built-in browser tool should be assigned a capability class.

Initial capability classes:

- `read`
  - safe page inspection with low exfiltration risk
- `sensitive_read`
  - storage, cookies, HTML dumps, or other high-sensitivity reads
- `mutation`
  - click, fill, navigate, and similar side effects
- `network`
  - HTTP requests or any outward network access
- `code_exec`
  - arbitrary JavaScript execution or equivalent behavior

If a tool cannot be confidently classified, it must be treated as denied until
explicitly classified.

## Layer 3: Runtime Policy

The runtime should evaluate a request using:

1. tool classification
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

## Tool Classification Direction

The final mapping must be designed in its own phase, but the current direction
should look roughly like this.

### `read`

- `browser__tool_search`
- `browser__inspect_page`
- `browser__list_interactives`
- `browser__inspect_performance`
- tightly scoped DOM inspection if it does not expose sensitive HTML or secrets

### `sensitive_read`

- `browser__inspect_storage`
- `browser__inspect_cookies`
- DOM inspection modes that expose raw HTML or sensitive attributes
- resource inspection if it exposes high-sensitivity URLs or embedded data

### `mutation`

- `browser__click`
- `browser__fill`
- `browser__navigate`

### `network`

- `browser__inspect_http`
- any future network request tool
- any provider config path that causes outbound requests

### `code_exec`

- `browser__evaluate`
- aliases like `browser__run_probe`
- any future JS execution primitive

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
- policy wrapper classifies tool
- policy wrapper checks mode
- policy wrapper checks approval state if required
- policy wrapper returns explicit blocked errors

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

- add security-relevant config shape without changing runtime behavior too broadly yet

Expected outputs:

- `runtimeMode` in config types
- normalization and migration behavior
- strict provider base URL validation contract

Must be designed separately before implementation.

## Phase 2: Tool Classification And Policy Wrapper

Goal:

- introduce runtime-owned capability classification and blocking

Expected outputs:

- built-in tool classification
- deny-by-default policy for unknown tools
- wrapper enforcement in `list()` and `invoke()`
- alias-aware blocking

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
