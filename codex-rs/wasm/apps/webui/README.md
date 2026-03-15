# WebUI

`codex-rs/wasm/apps/webui` is the official browser UI for the WASM Codex runtime.

It is the maintained app surface for:

- chat-first interaction with streaming;
- tool execution and transcript rendering;
- citations, tools, and artifacts inspection;
- router settings and browser-hosted runtime integration.

Runtime semantics stay aligned with the WASM Codex stack under:

- `codex-rs/wasm/core`
- `codex-rs/wasm/browser`
- `codex-rs/wasm/app_server`

Legacy browser shells and experiments remain under `codex-rs/wasm-arch`.
