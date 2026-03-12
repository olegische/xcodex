# Browser Runtime Host Contract

This document defines the A3 browser host contract between `codex-wasm-core` and the JavaScript host object passed to `WasmBrowserRuntime`.

It is narrower than the A2 bridge protocol in [bridge-protocol.md](./bridge-protocol.md).
The bridge protocol remains the broader capability-oriented direction.
This contract is the concrete browser runtime surface that the A3 demo and future browser hosts must implement.

## Direction

- This contract is internal to the browser-hosted runtime.
- It is not the public UI protocol.
- Field names are camelCase on the wire.
- Browser hosts should not depend on snake_case aliases or alternate payload shapes.

## JS Host Surface

The JS object passed to `new WasmBrowserRuntime(host)` must implement:

```ts
interface BrowserRuntimeHost {
  loadSession(threadId: string): Promise<SessionSnapshotPayload | null>;
  loadInstructions(threadId: string): Promise<JsonValue | null>;
  saveSession(snapshot: SessionSnapshotPayload): Promise<void>;
  startModelTurn(request: {
    requestId: string;
    payload: JsonValue;
  }): Promise<Array<
    | { type: "started"; requestId: string }
    | { type: "delta"; requestId: string; payload: JsonValue }
    | { type: "completed"; requestId: string }
    | { type: "failed"; requestId: string; error: HostError }
  >>;
  cancelModelTurn(requestId: string): Promise<void>;
}
```

## Session Methods

`loadSession(threadId)`:

- returns `null` when the thread is absent;
- otherwise returns the persisted session snapshot payload.

`saveSession(snapshot)`:

- persists the full session snapshot after thread creation and turn completion.

`loadInstructions(threadId)`:

- returns `null` when no browser-persisted instruction snapshot exists for the thread;
- otherwise returns a codex-style instruction snapshot with optional `userInstructions` and `skills`;
- browser hosts may source this from `localStorage`, IndexedDB, or another browser-safe local store.

## Model Turn Request

`startModelTurn(request)` receives:

```json
{
  "requestId": "browser-demo-turn-1",
  "payload": {
    "codexInstructions": {
      "userInstructions": {
        "directory": "/repo",
        "text": "Follow the repo rules."
      },
      "skills": [],
      "contextualUserMessages": [
        "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nFollow the repo rules.\n</INSTRUCTIONS>"
      ]
    },
    "goal": "Update the greeting string for the browser demo and return an apply_patch block.",
    "workspace": {
      "files": [
        {
          "path": "src/lib.rs",
          "content": "pub fn greet() -> &'static str {\n    \"hello\"\n}\n"
        }
      ],
      "matches": [
        {
          "path": "src/lib.rs",
          "lineNumber": 1,
          "line": "pub fn greet() -> &'static str {"
        }
      ]
    }
  }
}
```

The runtime now appends browser-resolved instruction state under `payload.codexInstructions`.
That block contains codex-style serialized contextual user fragments so the host transport can preserve AGENTS/skill semantics even when the source of truth lives in browser storage.

When the host implements router-backed inference:

- Codex passes model/runtime config to the host adapter.
- That config may remain codex-compatible (`model`, `model_provider`, `model_providers`, `env_key`) even when the browser host uses embedded transports.
- Browser hosts are expected to resolve secret values from browser-managed storage rather than process environment variables.
- The host adapter may delegate network transport to `xrouter-browser`.
- `xrouter-browser` then talks to the configured provider or router HTTP endpoint.
- Codex itself should not directly implement provider-specific transport logic in this mode.

The intended semantic boundary is still `responses`-style streaming:

- Codex emits/consumes normalized turn and delta events.
- The router layer is responsible for adapting provider-specific protocols to that behavior.

## Model Turn Events

The host returns an ordered list of model events:

```json
[
  {
    "type": "started",
    "requestId": "browser-demo-turn-1"
  },
  {
    "type": "delta",
    "requestId": "browser-demo-turn-1",
    "payload": {
      "outputTextDelta": "I found the Rust entrypoint..."
    }
  },
  {
    "type": "completed",
    "requestId": "browser-demo-turn-1"
  }
]
```

For streaming text output, the host should emit `delta.payload.outputTextDelta` chunks.

## WASM Runtime Dispatch Shape

`runtime.runTurn(...)` returns a dispatch payload with `value` and `events`.

For model text, browser clients should expect `modelDelta` events in this shape:

```json
{
  "event": "modelDelta",
  "payload": {
    "threadId": "browser-demo-thread",
    "turnId": "browser-demo-turn-1",
    "requestId": "browser-demo-turn-1",
    "payload": {
      "outputTextDelta": "I found the Rust entrypoint..."
    }
  }
}
```

That nested `payload.payload.outputTextDelta` shape is the current A3 runtime contract and is covered by Rust unit tests.
