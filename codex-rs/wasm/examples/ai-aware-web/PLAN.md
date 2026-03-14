# AI-Aware Web Plan

This example exists to prove a more serious browser-native direction for Codex in WASM.

Current scope:

1. Fork the real `apps/webui` shell into `examples/ai-aware-web`.
2. Keep UI composition runtime-editable through `/workspace/ui/*.json`.
3. Seed browser-native mission documents under `/workspace/ai-aware/`.
4. Show remote MCP, AI-readable web signals, and swarm orchestration as first-class widgets.

Next likely steps:

1. Bind the visual `remote_mcp` surface to a real browser `HostMcp` adapter with OAuth/login flows.
2. Let the runtime inspect page metadata and update `web-signals.json` directly from page or extension context.
3. Add mission artifacts and thread-specific research trails instead of a single shared swarm brief.
