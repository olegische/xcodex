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

The app now targets the public `xcodex-embedded-client` browser SDK contract and the
released runtime bundle layout:

- `/pkg/manifest.json`
- `/pkg/current/*`
- `/xrouter-browser/manifest.json`
- `/xrouter-browser/current/*`

`apps/webui` now uses released tarballs for both `xcodex-wasm` and
`xrouter-browser`. It does not need a local Rust/WASM rebuild for routine demo
startup.

From the repository root, refresh the local browser runtime assets when needed:

```bash
cd /Users/olegromanchuk/Projects/xcodex
just wasm-runtime-pull apps/webui
```

This refresh step prepares:

- the `xcodex-wasm` assets under `codex-rs/wasm/apps/webui/public/pkg`;
- the `xrouter-browser` assets under `codex-rs/wasm/apps/webui/public/xrouter-browser`;
- matching manifests under `pkg/` and `xrouter-browser-pkg/`.

`xrouter-browser` comes from the XRouter repository:

- [olegische/xrouter](https://github.com/olegische/xrouter)

If you want to audit how browser routing, provider access, and API-key handling work, start there.

By default, the runtime pull step prefers a local `dist/xcodex-wasm.tar.gz`
from the repository root when it exists, and falls back to the GitHub release
tarball otherwise.

`xrouter-browser` reuses the already installed local `xrouter-browser-pkg/current`
bundle when present, and otherwise falls back to the GitHub release tarball.

You can override either source explicitly with:

- `XCODEX_WASM_TARBALL=/path/to/xcodex-wasm.tar.gz`
- `XROUTER_BROWSER_TARBALL=/path/to/xrouter-browser.tar.gz`

Then start the app:

```bash
cd /Users/olegromanchuk/Projects/xcodex
just wasm-webui-dev
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

Browser workspace patch writes are exposed through the browser-owned tool
`browser__submit_patch`. This keeps browser runtime tool identity separate from
the upstream core builtin `apply_patch` while still reusing the same browser
workspace patch backend.

## Current status

This is releaseable as an open-source demo of WASM Codex.

Known caveats:

- MCP integration exists in the runtime path but still needs fresh end-to-end verification in this app.
- Browser extension / deeper DevTools integration is not required for the current demo, but would unlock richer browser inspection later.
