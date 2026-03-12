# Browser Chat Demo

This example is the current A4 browser chat scaffold for `codex-wasm`.

Frontend stack:

- Vite
- Svelte
- TypeScript

It demonstrates:

- browser-managed auth state;
- browser-managed secret storage keyed by `env_key`;
- codex-compatible provider config persisted in browser storage;
- `readAccount` and `listModels` through `WasmBrowserRuntime`;
- model selection in the browser UI;
- a minimal chat turn loop over the browser runtime.

Status:

- validated end-to-end on 2026-03-09 for embedded `xrouter-browser` transport
- validated chain:
  - `UI -> Codex WASM runtime -> browser host adapter -> xrouter-browser -> provider`

Current baseline:

- secrets are entered in the browser UI and stored locally in browser storage for local/dev usage;
- provider config stays codex-compatible across all transport modes (`model`, `model_provider`, `model_providers`, `env_key`);
- transport can target OpenAI directly, embedded `xrouter-browser`, or a custom OpenAI-compatible base URL;
- model listing calls the real provider `/models` endpoint;
- chat turns stream from the real provider `/responses` endpoint;
- the preferred path for external providers is router-first (`xrouter`-style), not direct provider integration;
- there is no ChatGPT account login in this demo or in the XCodex WASM baseline;
- authentication is `BYOK` only via provider or router-compatible API keys stored in browser-managed storage;
- when `XROUTER_BROWSER_DIR` is set during build, `XRouter Browser` mode uses the generated `xrouter-browser` wasm package.
- the default demo mode is `XRouter Browser` with the `DeepSeek` preset.

Embedded `xrouter-browser` semantics:

- Codex runtime does not call provider-specific URLs directly.
- The browser host resolves `env_key` from browser storage and hands provider/model/baseUrl/auth config to `xrouter-browser`.
- `xrouter-browser` performs the actual network I/O to the selected provider or router endpoint.
- Codex consumes the resulting stream as router-normalized model events.

## Run

1. Build the WASM package:

   ```bash
   ./build-demo.sh
   ```

   Recommended `xrouter-browser` path: use the prebuilt browser bundle tarball.

   Local tarball:

   ```bash
   XROUTER_BROWSER_TARBALL=/path/to/xrouter-browser-main.tar.gz ./build-demo.sh
   ```

   Direct release URL:

   ```bash
   XROUTER_BROWSER_TARBALL=https://github.com/olegische/xrouter/releases/download/xrouter-browser-main/xrouter-browser-main.tar.gz ./build-demo.sh
   ```

   Local source checkout is still supported for development:

   ```bash
   XROUTER_BROWSER_DIR=/path/to/xrouter/crates/xrouter-browser ./build-demo.sh
   ```

2. Install frontend dependencies:

   ```bash
   npm install
   ```

3. Start the Vite dev server:

   ```bash
   npm run dev
   ```

4. Open:

   [http://localhost:4174](http://localhost:4174)

## Demo Flow

1. Choose one of:
   - `OpenAI` for direct baseline testing
   - `XRouter Browser` for embedded router transport in the browser app
   - `OpenAI-compatible server` for any external `/models` + `/responses` endpoint
2. Paste the matching API key and base URL
3. Click `Refresh Account`
4. Click `Refresh Models`
5. Choose a model
6. Send a message

Expected live path in `XRouter Browser` mode:

- `Save Provider Config` persists a codex-compatible config plus browser-managed secret
- `Refresh Models` calls `runtime.listModels()` and then `xrouter-browser.fetchModelIds()`
- `Send Message` calls `runtime.runTurn()` and then `xrouter-browser.runTextStream()`
- `Turn Events` and transcript updates are produced by `codex-wasm-core`

The page will show:

- persisted auth state from browser storage;
- persisted codex-compatible config from browser storage;
- account and model payloads seen by the runtime;
- the streamed assistant output for the current turn;
- the accumulated transcript restored from the persisted thread snapshot.

## Provider Discovery

The browser host accepts any `/models` response with:

- top-level `data` array
- each model entry contains string `id`

That means it works with:

- OpenAI-style model lists
- richer supersets such as `xrouter` model catalogs

For external providers, the expected setup is:

- browser demo -> `xrouter-browser`
- `xrouter-browser` -> selected upstream provider/runtime

For HTTP router or relay deployments, use `OpenAI-compatible server` mode:

- browser demo -> router `/models` + `/responses`
- router -> selected upstream provider/runtime

Direct browser -> raw provider wiring is treated as a compatibility fallback, not the main path.

## Security Notes

- This demo stores API key values in browser storage on your machine for local development.
- The codex-compatible config keeps only logical secret references via `env_key`.
- Do not treat this as a production auth model.
- The production-grade path for browser-hosted Codex remains a thin relay/service-account design, not a public browser secret.

## Build Notes

- `build-demo.sh` writes a versioned package under `pkg/<build-id>/...`
- it mirrors the current package into `public/pkg/...` for Vite
- it mirrors the latest package into stable `public/pkg/current/...` and `public/xrouter-browser/current/...`
- it also writes `public/pkg/manifest.json`
- it also writes `public/xrouter-browser/manifest.json`
- the Svelte app reads that manifest at runtime, so browser reloads pick up the latest build without manual edits in frontend source
- `XROUTER_BROWSER_TARBALL` takes precedence over `XROUTER_BROWSER_DIR`
- the tarball must unpack into a browser bundle containing `xrouter_browser.js` and `xrouter_browser_bg.wasm`
- if multiple wasm modules share one page, keep `wasm-bindgen`, `wasm-bindgen-futures`, `js-sys`, and `web-sys` aligned across them
