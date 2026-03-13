# Runtime UI Profiles Plan

This example exists to prove a Codex-in-WASM loop where the model can change the browser UI by
editing workspace files.

Current scope:

1. Fork the real `apps/webui` shell into `examples/webui-runtime-profiles`.
2. Store runtime-editable UI profiles in `/workspace/ui/profiles.json`.
3. Hot-apply the active profile in the running app.
4. Keep the first schema intentionally small: theme and sidebar side.

Next likely steps:

1. Let Codex create/switch profiles via natural-language instructions.
2. Expand the schema to panel visibility, labels, density, and metrics widgets.
3. Add explicit workspace/file inspection UI so profile diffs are visible in the app.
