# xcodex-sdk

Unified SDK for Codex App Server Protocol adapters.

This package is meant to host multiple protocol adapters over the same Codex
app-server connection layer:

- OpenAI `Responses API`
- Google `A2A`
- LangChain `Agent Protocol`

The first implemented adapter is OpenAI compatibility. It lets you point the
official `openai` JavaScript SDK at a Codex app-server connection instead of
the network `Responses API`.

Current focus:

- `responses.create()`
- streaming via `client.responses.create({ ..., stream: true })`
- in-memory `responses.retrieve()`
- in-memory `responses.inputItems.list()`

The package exposes:

- core connection factories:
  - `createRpcCodexConnection(...)`
  - `createAbiCodexConnection(...)`
- OpenAI adapter:
- `createCodexOpenAIClient(...)`
- `createCodexResponsesFetch(...)`
