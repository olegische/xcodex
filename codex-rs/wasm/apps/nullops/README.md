# NullOps

`codex-rs/wasm/apps/nullops` is a WASM browser app built from the `webui` runtime stack, but tuned for one workflow:
chat first, then generate a live app directly into runtime.

## Core idea

- the chat stays primary
- when the model writes `/workspace/nullops/app.html`, NullOps renders it immediately in a sandboxed live preview
- generated apps should be self-contained HTML with inline CSS and JavaScript, so they run without a build step

## Current target

The first intended demo is:

- ask for a calculator
- the runtime creates `/workspace/nullops/app.html`
- the calculator appears next to the chat and can be used immediately

## Relationship to `webui`

NullOps currently reuses most of the `apps/webui` runtime and UI structure.
That is intentional for speed. It should diverge over time toward a much smaller product surface centered on runtime app generation.
