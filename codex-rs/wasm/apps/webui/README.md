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

## Running the demo

From the repository root, build the browser runtime assets for the official app:

```bash
cd /Users/olegromanchuk/Projects/browser-codex
just wasm-build-runtime apps/webui wasm
```

This command builds:

- the WASM Codex browser runtime;
- the app assets under `codex-rs/wasm/apps/webui/public/pkg`;
- the `xrouter-browser` bundle under `codex-rs/wasm/apps/webui/public/xrouter-browser`.

`xrouter-browser` comes from the XRouter repository:

- [olegische/xrouter](https://github.com/olegische/xrouter)

If you want to audit how browser routing, provider access, and API-key handling work, start there.

By default, the build script pulls the `xrouter-browser` release tarball from GitHub. You can
override that with:

- `XROUTER_BROWSER_TARBALL=/path/to/xrouter-browser.tar.gz`
- `XROUTER_BROWSER_DIR=/path/to/local/xrouter`

Then start the app:

```bash
cd /Users/olegromanchuk/Projects/browser-codex/codex-rs/wasm/apps/webui
npm run dev
```

Open the local URL from Vite, usually:

```text
http://localhost:4181/
```

## Using the demo

On first launch:

1. Open `Settings`.
2. Choose a provider route exposed through `xrouter-browser`.
3. Paste the provider API key when the selected route requires it.
4. Pick a model and send a prompt.

The current demo supports:

- chat with streaming;
- browser-hosted tools;
- workspace tools;
- app-server protocol notifications;
- citations, tools, and artifacts inspection.

## Current status

This is releaseable as an open-source demo of WASM Codex.

Known caveats:

- MCP integration exists in the runtime path but still needs fresh end-to-end verification in this app.
- Browser extension / deeper DevTools integration is not required for the current demo, but would unlock richer browser inspection later.
