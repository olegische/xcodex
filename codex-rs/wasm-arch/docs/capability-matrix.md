# codex-wasm Capability Matrix (A0)

## Purpose

This document classifies `codex-rs/core` capabilities for a browser-native WASM runtime.

Categories:

- `portable`: logic can move as-is or with minimal glue.
- `needs abstraction`: logic is reusable, but currently coupled to OS/filesystem/process/network primitives.
- `native-only`: tied to OS-level sandbox/process/TTY behavior and excluded from browser V1.

## Evidence Snapshot

Primary signals from the current codebase:

- Native process spawning in core:
  - `core/src/spawn.rs:6`, `core/src/spawn.rs:66`, `core/src/spawn.rs:92`
  - `core/src/exec.rs:14`, `core/src/exec.rs:30`, `core/src/exec.rs:204`
- macOS/Linux/Windows sandbox integration:
  - `core/src/seatbelt.rs:1`, `core/src/seatbelt.rs:34`
  - `core/src/landlock.rs:1`, `core/src/landlock.rs:41`
  - `core/src/windows_sandbox.rs:119`
- PTY/process-group dependencies:
  - `core/src/unified_exec/process.rs:20`
  - `core/src/unified_exec/process_manager.rs:538`
  - `core/src/tools/spec.rs:109`
- Keyring-backed auth:
  - `core/src/auth/storage.rs:24`, `core/src/auth/storage.rs:154`
- File watcher:
  - `core/src/file_watcher.rs:13`
- MCP runtime (rmcp client and protocol):
  - `core/src/mcp_connection_manager.rs:41`
- Git command usage:
  - `core/src/git_info.rs:12`, `core/src/git_info.rs:265`
- Model transport includes reqwest + websocket paths:
  - `core/src/client.rs:74`, `core/src/client.rs:81`

Dependency audit (`cargo tree -p codex-core --target wasm32-unknown-unknown`) confirms heavy native/runtime crates in current graph:

- `codex-utils-pty`, `portable-pty`, `keyring`, `notify`, `sqlx`, `codex-state`, `tokio-tungstenite`, `rmcp`, `codex-rmcp-client`, `codex-windows-sandbox`, `codex-shell-command`, `codex-secrets`, `codex-apply-patch`.

## Matrix by Subsystem

| Subsystem | Core modules (examples) | Class | Why | A0 decision |
|---|---|---|---|---|
| Agent orchestration and turn state | `codex.rs`, `codex_thread.rs`, `thread_manager.rs`, `state/session.rs`, `context_manager/*` | `needs abstraction` | Core logic is reusable but directly references session services, tool runtime, model client, fs-backed rollout/state | Keep logic; split from runtime services behind `HostRuntime` traits |
| Tool registry/spec/orchestration | `tools/spec.rs`, `tools/registry.rs`, `tools/router.rs`, `tools/orchestrator.rs`, `tools/events.rs` | `portable` | Mostly protocol/schema/plumbing logic | Move first into `codex-wasm-core` |
| File read/list/search handlers | `tools/handlers/read_file.rs`, `list_dir.rs`, `grep_files.rs` | `needs abstraction` | Uses `tokio::fs`, absolute local paths, external `rg`/filesystem semantics | Replace direct fs/process with host file/search adapters |
| Patch tool runtime | `tools/handlers/apply_patch.rs`, `tools/runtimes/apply_patch.rs`, `apply_patch.rs` | `needs abstraction` | Current path assumes local filesystem and local patch application | Keep parser/patch model; execute through host-provided apply-patch API |
| Shell/unified exec runtime | `tools/handlers/shell.rs`, `tools/runtimes/shell.rs`, `unified_exec/*`, `exec.rs`, `spawn.rs`, `shell_snapshot.rs` | `native-only` (V1) | Depends on process spawn, PTY, process groups, OS shell integration | Exclude from browser V1; add optional host `exec` capability later |
| OS sandbox enforcement | `seatbelt.rs`, `landlock.rs`, `windows_sandbox.rs`, `sandboxing/mod.rs` | `native-only` (V1) | Explicit OS-specific sandbox binaries/APIs (`sandbox-exec`, `codex-linux-sandbox`, Windows sandbox) | Not in WASM runtime; policy becomes host capability contract |
| Git-backed context/diff metadata | `git_info.rs`, `turn_diff_tracker.rs`, `turn_metadata.rs`, `review_prompts.rs` | `needs abstraction` | Uses `git` process calls and repo-local assumptions | Route via host git adapter or disable per feature flag |
| MCP runtime | `mcp_connection_manager.rs`, `mcp/*`, `mcp_tool_call.rs` | `needs abstraction` | Uses `codex-rmcp-client`/network/client flows that are not browser-safe as-is | Introduce browser MCP gateway interface; keep protocol models |
| Model transport | `client.rs`, `default_client.rs`, `client_common.rs`, `api_bridge.rs` | `needs abstraction` | Contains reqwest and websocket lifecycle, retries and telemetry coupling | Keep request/response shaping; move transport to JS/fetch/SSE bridge |
| Auth/secrets storage | `auth/storage.rs`, `auth.rs`, `secrets` integration | `needs abstraction` | File + OS keyring behavior | Browser auth storage via IndexedDB/Memory; no OS keyring |
| Persistence and indexing | `rollout/*`, `state_db.rs`, `memories/*` | `needs abstraction` | Mix of file rollouts, sqlite runtime, and db backfills | Replace with browser session store adapter (IndexedDB/OPFS) |
| File watching and dynamic reload | `file_watcher.rs`, `skills/loader.rs`, `plugins/*` | `needs abstraction` | `notify` and OS watch semantics | Host-driven change events in browser |
| Pure data/config/policy models | `config/types.rs`, `protocol mappings`, `tools/context.rs`, parts of `truncate.rs`/`util.rs` | `portable` | Mostly serde models and deterministic logic | Move early to wasm core |

## Candidate `codex-wasm-core` Cut (A0 Proposal)

Move first:

- Tool schema + protocol shaping (`tools/spec`, `tools/registry`, `client_common`-level event shaping).
- Deterministic transforms (`truncate`, parts of `context_manager`, prompt assembly sections).
- Config model parsing/validation that does not touch OS/filesystem.

Keep behind adapters:

- Filesystem operations.
- Network/model transport.
- Tool execution.
- Session persistence.
- Git.
- MCP.

Exclude from V1:

- Native shell runtime, PTY, OS sandbox orchestration.

## Immediate Interface Contracts to Define Next (A1 input)

- `HostFs`: read/list/search/write/apply_patch.
- `HostModelTransport`: stream request/response events.
- `HostToolExecutor`: invoke/cancel custom host tools.
- `HostSessionStore`: persist/load thread and turn artifacts.
- `HostGit`: optional metadata/diff provider.
- `HostMcp`: optional bridge for MCP tools/resources.

## Risk Notes from A0

- `codex.rs` is a high-coupling hotspot; direct extraction without trait boundaries will fail.
- `tools/spec` contains shell-centric assumptions; V1 must ship with feature-gated tool catalog.
- sqlite/keyring/notify/pty are currently transitively pulled into `codex-core`; a clean wasm crate must avoid these dependencies entirely.
