# xcodex-sdk

Unified SDK for Codex App Server Protocol adapters.

This package is meant to host multiple protocol adapters over the same Codex
app-server connection layer:

- OpenAI `Responses API`
- Google `A2A`
- LangChain `Agent Protocol`

Implemented adapters today:

- OpenAI `Responses API`
- Google `A2A` v1

The SDK is built around one shared Codex app-server connection layer and then
projects it into protocol-specific surfaces.

The package exposes:

- core connection factories:
  - `createRpcCodexConnection(...)`
  - `createAbiCodexConnection(...)`
- OpenAI adapter:
  - `createCodexOpenAIClient(...)`
  - `createCodexResponsesFetch(...)`
- A2A adapter:
  - `createCodexA2AAgentCard(...)`
  - `createCodexA2AClient(...)`
  - `createCodexA2AFetch(...)`

## OpenAI adapter

This lets you point the official `openai` JavaScript SDK at a Codex
app-server connection instead of the network `Responses API`.

Currently implemented:

- `responses.create()`
- streaming `responses.create({ stream: true })`
- in-memory `responses.retrieve()`
- in-memory `responses.inputItems.list()`

## A2A adapter

This adapter is built to work with the official `@a2a-js/sdk` client.

Current `A2A v1` scope:

- `message/send`
- `message/stream`
- `tasks/get`
- `tasks/cancel`
- text input / text output
- `Task = Thread` mapping

Example:

```ts
import { createCodexA2AClient, createAbiCodexConnection } from "xcodex-sdk";

const connection = await createAbiCodexConnection({
  runtimeModule,
  host,
});

const client = await createCodexA2AClient({
  connection,
  baseUrl: "https://xcodex.local",
  defaultModel: "gpt-5",
});

const task = await client.sendMessage({
  message: {
    kind: "message",
    messageId: crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text: "Summarize the repo status." }],
  },
});
```

Known tradeoffs in `A2A v1`:

- approvals and elicitation are projected lossily
- dynamic client-side tool calls are not represented losslessly
- push notifications are not supported
- task history is session-local and in-memory
- `blocking`/advanced configuration fields are currently best-effort, not full fidelity
