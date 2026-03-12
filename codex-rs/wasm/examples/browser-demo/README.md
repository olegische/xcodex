# Browser Demo

This example is the A3 browser-hosted demo for `codex-wasm`.

It is intentionally:

- browser-only;
- free of `WebContainer`;
- backed by browser APIs plus a small JS host object for the WASM runtime.

## What it demonstrates

- loading `codex-wasm-core` in the browser;
- starting and resuming a persisted thread via `WasmBrowserRuntime`;
- browser-side file search and file reads over a demo workspace;
- streamed model events from a browser host model adapter;
- extracting and applying an `apply_patch`-style patch;
- showing the resulting diff in the page.

The demo uses a deterministic mock model transport so it can run without API keys.

## Run

1. Install the Rust target:

   ```bash
   rustup target add wasm32-unknown-unknown
   ```

2. Build the browser package for this example.

   Recommended path:

   ```bash
   cargo build -p codex-wasm-core --target wasm32-unknown-unknown --release
   wasm-bindgen ../../target/wasm32-unknown-unknown/release/codex_wasm_core.wasm \
     --target web \
     --out-dir ./pkg
   ```

   Alternative path if `wasm-pack` works in your local toolchain:

   ```bash
   wasm-pack build ../../core --target web --out-dir ./pkg
   ```

3. Serve the example directory over HTTP:

   ```bash
   python3 -m http.server 4173
   ```

4. Open:

   [http://localhost:4173](http://localhost:4173)

## Notes

- The generated `pkg/` directory is intentionally not committed.
- Session state is stored in IndexedDB.
- The demo workspace itself is in-memory so the patch/diff flow stays deterministic.
- The browser host contract is documented in [browser-runtime-host.md](../../docs/browser-runtime-host.md).
