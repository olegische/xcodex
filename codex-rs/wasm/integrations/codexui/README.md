# xcodexui WASM Integration

This directory contains the code worth copying into an `xcodexui` integration layer after the
runtime extraction work in `codex-rs/wasm/ts`.

What lives here:

- IndexedDB persistence for auth/config/session/user-config
- browser host assembly for `WasmBrowserRuntime`
- browser runtime assembly on top of `@browser-codex/wasm-browser-codex-runtime`

What does not live here anymore:

- old `/codex-api/*` compatibility shim
- pseudo app-server bridge code
- MCP-specific compatibility code

The intended copy target inside `xcodexui` is something like:

- `integrations/xcodex/persistence.ts`
- `integrations/xcodex/host.ts`
- `integrations/xcodex/runtime.ts`

Then `xcodexui` can wire its own UI state, provider config, browser tools, and request-user-input
callbacks on top of these adapters.
