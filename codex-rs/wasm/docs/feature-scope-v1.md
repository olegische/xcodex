# codex-wasm V1 Feature Scope (A0 Freeze)

## Goal

Freeze a realistic V1 scope for browser-native Codex that can run without launching the native `codex` binary.

## V1 Includes

1. Browser agent loop
- Start/resume turns in-browser.
- Stream model output/events to UI.
- Maintain thread/turn state in browser storage.

2. File-centric tools via host adapters
- `readFile`
- `listDir`
- `search`
- `writeFile`
- `applyPatch`

3. Model transport via JS host
- HTTP(S) calls via browser `fetch`.
- Streaming over SSE-compatible bridge.
- Abort/cancel support.

4. Deterministic plan/tool orchestration
- Tool registry/spec generation for enabled V1 tools.
- Structured tool invocation and result events.
- Parallel tool execution where host supports it.

5. Browser-safe persistence
- IndexedDB metadata + OPFS blobs (or equivalent host-managed storage).
- Session replay for active thread history.

## V1 Excludes

1. Native shell/terminal execution
- No `shell`, `shell_command`, `unified_exec`, PTY, stdin/stdout process management.

2. Native OS sandbox orchestration
- No seatbelt/landlock/windows sandbox bootstrap.

3. OS keyring and native auth helpers
- No OS keyring integration in wasm runtime.

4. Native file watching semantics
- No direct `notify` watchers; host sends change events when available.

5. Full MCP parity
- No direct `rmcp` process/network client inside wasm runtime V1.
- Optional host-provided MCP bridge can be added later.

6. Full CLI parity
- No promise of byte-identical behavior to native `codex` CLI.

## Feature Flags for V1

- `wasm_v1_core`: enables browser-safe agent loop.
- `wasm_v1_file_tools`: enables file/search/patch tool set.
- `wasm_v1_transport_fetch`: enables JS-hosted model transport.
- `wasm_disable_native_exec`: hard-disables shell/unified_exec tools.
- `wasm_disable_native_sandbox`: hard-disables seatbelt/landlock/windows sandbox paths.

## Contract Requirements (Must Exist Before A1 Completion)

1. Host FS contract
- Read/list/search/write/apply patch operations.
- Absolute path semantics resolved by host workspace root policy.

2. Host model transport contract
- Request/stream lifecycle events.
- Retry/error class normalization.

3. Host tool contract
- `tool/list`, `tool/invoke`, `tool/cancel`.
- Structured success/error payload format.

4. Host session store contract
- Store/load thread metadata and item history.
- Optional compaction hooks.

## Acceptance Criteria for V1 Scope

1. Browser E2E scenario works end-to-end:
- Read code, propose patch, apply patch, produce final message.

2. No dependency on:
- `tokio::process`, PTY crates, keyring crates, OS sandbox binaries.

3. Explicitly documented unsupported features:
- Shell/TTY/sandbox parity and full MCP parity.

## Deferred to Post-V1

- Optional remote execution relay for shell-compatible actions.
- MCP compatibility layer with host-side gateway.
- Rich parity features (native-like policies, advanced approvals, terminal semantics).
