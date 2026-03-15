# AI-Aware Web

`codex-rs/wasm-arch/examples/apsix-web` is a browser-native mission deck for Codex in WASM.

It starts from `webui-runtime-profiles`, but shifts the product idea:

- no fake desktop superpowers inside the browser;
- remote MCP over URL is first-class, and login state is part of the UI;
- `llms.txt` and `schema.org` become observable signals of AI-readable web surfaces;
- multi-agent orchestration is shown as the language of the shell, not buried in logs.

## What This Example Proves

- the real browser shell can still be driven by workspace-owned UI schema under `/workspace/ui/`;
- domain state can live beside UI state under `/workspace/ai-aware/`;
- the browser runtime can expose host-provided MCP tools into the model loop, not just local builtins;
- browser-side remote MCP login can run through an OAuth popup flow and sync back into workspace state;
- the browser runtime can express remote capability routing, auth posture, signal maps, and swarm lanes without changing the core runtime contract;
- Codex can rewrite both the shell and the mission documents from inside the browser workspace.

## Workspace Documents

UI control:

- `/workspace/ui/tokens.json`
- `/workspace/ui/profiles.json`
- `/workspace/ui/views.json`
- `/workspace/ui/dashboards.json`
- `/workspace/ui/layout.json`
- `/workspace/ui/widgets.json`

Mission control:

- `/workspace/ai-aware/mcp-servers.json`
- `/workspace/ai-aware/web-signals.json`
- `/workspace/ai-aware/swarm.json`
- `/workspace/ai-aware/README.md`

The MCP deck is live: `Remote MCP` can authorize a configured remote server, cache tools in the browser, and expose them to the WASM runtime as model-callable tools.
The browser deck is live too: the host exposes browser-native tools for current page context, AI-readability scans, and DOM extraction, then syncs those signals back into `/workspace/ai-aware/web-signals.json`.

## Research Basis

- Remote MCP and auth-driven tool fabric: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- AI-readable site manifests: [llmstxt.org](https://llmstxt.org)
- Typed semantic web substrate: [schema.org](https://schema.org)

## Why This Exists

If Codex lives in WASM inside a browser, the browser is not a degraded desktop. It is a different operating environment.

This example treats that seriously: browser context, remote capability fabrics, structured web signals, and persistent artifacts become the primary design material.
