# xcodex-sdk

`xcodex-sdk` is a frontend-friendly adapter SDK for the Codex app-server protocol.

It lets you keep `Codex app-server` as the execution/runtime layer and expose it
through familiar client APIs:

- OpenAI `Responses API`
- Google `A2A`

The goal is straightforward: your app talks to official SDKs, while `xcodex-sdk`
bridges those SDK calls into a local or embedded Codex runtime.

## What This Package Is

This package is not a model SDK by itself.

It is an adapter layer that sits between:

- a Codex app-server connection
- an official client SDK such as `openai` or `@a2a-js/sdk`

Today it supports two integration styles:

1. `ABI mode`
   Connect directly to an in-process/browser WASM runtime via `createAbiCodexConnection(...)`.
2. `RPC mode`
   Bring your own app-server transport and expose it through `createRpcCodexConnection(...)`.

## Installation

```bash
npm install xcodex-sdk openai @a2a-js/sdk
```

If you are using the Codex WASM runtime packages from this repo, you will
typically also depend on the appropriate browser/runtime package that provides
your runtime module and host integration.

## Mental Model

`xcodex-sdk` keeps one shared Codex connection layer and projects it into
protocol-specific shapes.

### OpenAI Responses

- OpenAI `Response` maps to one Codex turn result
- `previous_response_id` is used to continue within the same Codex thread
- streaming is emitted as Responses-compatible SSE

### A2A

- `Task = Codex Thread`
- active task execution = current Codex turn
- `message/send` and `message/stream` create or continue work on a thread
- `tasks/get` reads the current in-memory task snapshot
- `tasks/cancel` maps to `turn/interrupt`

This is intentional. A2A is treated as an interoperability surface, not as a
lossless export of every internal app-server event.

## Public API

### Connection factories

- `createRpcCodexConnection(...)`
- `createAbiCodexConnection(...)`

### OpenAI adapter

- `createCodexOpenAIClient(...)`
- `createCodexResponsesFetch(...)`

### A2A adapter

- `createCodexA2AAgentCard(...)`
- `createCodexA2AClient(...)`
- `createCodexA2AFetch(...)`

## Choosing RPC vs ABI

Use `createAbiCodexConnection(...)` when:

- your app embeds the Codex WASM runtime directly
- you already have `runtimeModule + host` or a `WasmProtocolRuntime`
- you want the shortest path from UI to runtime

Use `createRpcCodexConnection(...)` when:

- you already have your own transport layer
- you are proxying app-server calls over websocket, postMessage, worker RPC, or another bridge
- you do not want `xcodex-sdk` to own runtime bootstrap

## Quickstart: OpenAI Responses

This is the main path if you want to reuse the official `openai` JavaScript SDK.

```ts
import {
  createAbiCodexConnection,
  createCodexOpenAIClient,
} from "xcodex-sdk";

const connection = await createAbiCodexConnection({
  runtimeModule,
  host,
});

const openai = createCodexOpenAIClient({
  connection,
  apiKey: "xcodex-local",
  baseURL: "https://xcodex.local/v1",
  defaultModel: "gpt-5",
  defaultCwd: "/workspace",
});

const response = await openai.responses.create({
  model: "gpt-5",
  input: "Summarize the current workspace.",
});

console.log(response.output_text);
```

### Streaming Responses

```ts
const stream = openai.responses.stream({
  model: "gpt-5",
  input: "Walk me through the repo structure.",
});

for await (const event of stream) {
  // Official OpenAI SDK event stream
}

const finalResponse = await stream.finalResponse();
console.log(finalResponse.output_text);
```

### Low-level Responses Fetch

Use this if you do not want `xcodex-sdk` to instantiate `new OpenAI(...)` for you.

```ts
import { createCodexResponsesFetch } from "xcodex-sdk";

const fetch = createCodexResponsesFetch({
  connection,
  defaultModel: "gpt-5",
  defaultCwd: "/workspace",
});

const response = await fetch("https://xcodex.local/v1/responses", {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-5",
    input: "hello",
  }),
});

console.log(await response.json());
```

## Quickstart: A2A

This path is built to work with the official `@a2a-js/sdk` client.

```ts
import {
  createAbiCodexConnection,
  createCodexA2AClient,
} from "xcodex-sdk";

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

console.log(task.id, task.status.state);
```

### Streaming A2A

```ts
const stream = client.sendMessageStream({
  message: {
    kind: "message",
    messageId: crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text: "Stream your progress." }],
  },
});

for await (const event of stream) {
  if (event.kind === "task") {
    console.log("task", event.id, event.status.state);
  } else if (event.kind === "status-update") {
    console.log("status", event.status.state);
  } else if (event.kind === "artifact-update") {
    console.log("artifact", event.artifact.artifactId);
  }
}
```

### Low-level A2A Fetch

Use this if you want to expose an A2A-compatible HTTP surface yourself or wire it
into a custom client setup.

```ts
import { createCodexA2AFetch } from "xcodex-sdk";

const fetch = createCodexA2AFetch({
  connection,
  baseUrl: "https://xcodex.local",
  defaultModel: "gpt-5",
});

const response = await fetch("https://xcodex.local/.well-known/agent-card.json");
console.log(await response.json());
```

## Supported Surface

### OpenAI adapter

Currently implemented:

- `responses.create()`
- streaming `responses.stream(...)`
- in-memory `responses.retrieve()`
- in-memory `responses.inputItems.list()`
- `responses.cancel(...)`

Current limitations:

- Responses tools are not supported yet
- array-based `instructions` are not supported yet
- stored responses are session-local and in-memory

### A2A adapter

Current `A2A v1` scope:

- `message/send`
- `message/stream`
- `tasks/get`
- `tasks/cancel`
- text input / text output
- `Task = Thread` mapping

Current limitations:

- approvals and elicitation are projected lossily
- dynamic client-side tool calls are not represented losslessly
- push notifications are not supported
- task history is session-local and in-memory
- advanced A2A configuration fields are best-effort only
- stale task IDs do not survive runtime restarts unless your app recreates task state above this layer

## Error Model and State

This package intentionally keeps adapter state lightweight.

That means:

- Responses history is not a durable backend
- A2A tasks are not a durable backend
- if your runtime restarts, in-memory adapter state is gone

If your app needs durable conversations across reloads or process restarts, keep
your own app-level state and recreate the adapter-facing context as needed.

## Browser Notes

This package is designed for frontend and embedded-runtime usage.

The OpenAI client helper is created with `dangerouslyAllowBrowser: true` because
it is meant to run against a local adapter fetch, not against a public secret-bearing
network endpoint.

That does not make secret handling magically safe. If your frontend stores API keys
or auth state locally, you still own that risk.

## Current Status

Implemented today:

- OpenAI Responses compatibility
- Google A2A compatibility v1

Planned next:

- LangChain Agent Protocol adapter
- broader OpenAI Responses surface
- richer A2A task/history fidelity
