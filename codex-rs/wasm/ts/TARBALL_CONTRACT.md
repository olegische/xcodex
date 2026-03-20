# XCodex WASM Tarball Contract

The canonical release-bundle contract for `xcodex-wasm.tar.gz` is:

```text
xcodex-wasm/
  manifest.json
  current/
    xcodex.js
    xcodex_bg.wasm
    xcodex-runtime.js
    xcodex-runtime.js.map
    xcodex.d.ts
    xcodex_bg.wasm.d.ts
```

This tarball is a browser asset bundle. It is not the canonical definition of
the SDK package surface.

Consumers should:

- load release assets through `manifest.json` and `current/*`
- treat `xcodex-runtime.js` as the single-file browser bundle for the root
  `xcodex-runtime` SDK API
- rely on root bundle exports for supported browser integration paths

Consumers should not assume the tarball provides:

- npm package layout
- `package.json`
- `dist/` layout
- package subpath import support

For the developer-facing SDK contract, use `xcodex-runtime` as the canonical
package API and treat `@browser-codex/*` packages as internal implementation
details unless they are explicitly promoted.
