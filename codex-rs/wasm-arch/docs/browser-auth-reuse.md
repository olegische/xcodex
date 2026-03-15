# Browser Auth Reuse Notes

This note captures the current A4 direction for browser-hosted ChatGPT login and a minimal real model loop.

## Goal

For the browser-hosted WASM track, the next milestone after A3 is:

- log in with ChatGPT in the browser;
- persist auth state in browser storage;
- list available models;
- choose a model;
- send a simple user message;
- stream the assistant response.

## What Reuses Cleanly

The existing Rust codebase already provides the reusable auth and account model:

- `codex-rs/core/src/auth.rs`
  - shared auth types
  - ChatGPT token refresh logic
  - `CLIENT_ID`
  - persisted auth state model
- `codex-rs/protocol/src/openai_models.rs`
  - model preset list
  - auth-aware filtering via `ModelPreset::filter_by_auth(...)`
- `codex-rs/app-server-protocol/src/protocol/v2.rs`
  - `account/login/start`
  - `account/read`
  - `model/list`

## What Does Not Reuse As-Is

The current CLI ChatGPT login flow is not browser-native.

`codex-rs/login/src/server.rs` starts a short-lived local callback server and builds an auth URL that redirects to:

- `http://localhost:<port>/auth/callback`

That is correct for the CLI, but it is not the right baseline for browser-hosted WASM.

The browser runtime should not depend on:

- a localhost callback server;
- a native browser opener;
- local file/keyring auth persistence.

There is also a second existing login path in `codex-rs/login/src/device_code_auth.rs`.

That flow:

- requests a device code from `/api/accounts/deviceauth/usercode`;
- asks the user to confirm in a normal browser tab;
- polls `/api/accounts/deviceauth/token`;
- exchanges the returned authorization code through the same `/oauth/token` endpoint.

This path is useful because it does not require a localhost callback server, but it is still not a perfect browser-first UX. It is better treated as a fallback than as the primary browser login design.

## Recommended Browser Direction

For browser-hosted WASM, the preferred path is:

1. The browser host performs the auth redirect / popup flow.
2. The browser host receives ChatGPT auth tokens.
3. The browser host persists those tokens in browser storage.
4. The browser host passes auth state into the runtime through a browser-safe adapter.
5. The runtime uses the existing auth/account/model logic where it already fits.

In app-server terms, the most relevant existing path is:

- `account/login/start` with `chatgptAuthTokens`

This already acknowledges a client-managed auth flow:

- the client gets the tokens;
- Codex consumes them as external ChatGPT auth.

That is a much better fit for the browser than trying to port the CLI localhost callback server literally.

In other words, the browser baseline should run Codex in `external auth` mode, not in managed CLI-login mode.

## Client ID

`codex-rs/core/src/auth.rs` exposes:

- `pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";`

For browser auth, a hardcoded `client_id` is not inherently a problem.

Why:

- OAuth `client_id` for a public client is not a secret;
- browser clients are expected to use public-client flows;
- the security boundary is PKCE and redirect/origin validation, not hiding the `client_id`.

What matters more:

- the auth service must allow the browser redirect/origin we use;
- the browser flow must not require a `client_secret`;
- the token shape and scopes must match what Codex expects for ChatGPT-backed requests.

## A4 Working Assumption

The current A4 working assumption is:

- do not port `run_login_server(...)` into WASM;
- instead, add a browser-specific auth adapter that produces the same effective auth state that `CodexAuth` already understands.
- keep the runtime contract aligned with `chatgptAuthTokens` and `account/chatgptAuthTokens/refresh`.

## Browser Login Options

There are two realistic ways to supply those external tokens in the browser:

1. Browser-only popup/redirect + PKCE
   - Reuse the existing authorize URL shape from `codex-rs/login/src/server.rs`:
     - `/oauth/authorize`
     - `client_id`
     - `scope=openid profile email offline_access`
     - `code_challenge`
     - `state`
     - optional `allowed_workspace_id`
   - Replace `http://localhost:<port>/auth/callback` with a browser callback page controlled by the demo host.
   - Exchange the returned code for tokens and persist them in browser storage.

2. Browser-managed thin auth bridge
   - The browser host opens a provider-controlled login flow elsewhere.
   - A thin bridge returns ready-to-use ChatGPT tokens to the browser host.
   - The host stores those tokens and injects them into the runtime through the external-auth adapter.

Option 1 is architecturally cleaner for a pure browser target, but it depends on details we have not yet validated in this repo:

- whether the provider allows the browser callback/origin we control;
- whether token exchange can be completed from browser JavaScript in practice;
- whether the expected scopes and token shapes match the existing ChatGPT auth path.

If those constraints block a pure browser PKCE flow, option 2 becomes the fallback baseline.

## Recommended Implementation Order

1. Keep the runtime in external-auth mode.
2. Spike the popup/redirect + PKCE browser flow first.
3. If that flow is blocked by provider constraints, fall back to a thin auth bridge.
4. Keep device-code login as an optional fallback for demo/debugging, not as the primary UX.

## Immediate Implementation Consequences

- Build a browser auth adapter, not a localhost auth server.
- Reuse `chatgptAuthTokens`-style external auth as the baseline browser login path.
- Keep model selection aligned with existing `model/list` and `ModelPreset::filter_by_auth(...)`.
- Treat the first browser real-model demo as a minimal chat loop, not as a tools demo.
