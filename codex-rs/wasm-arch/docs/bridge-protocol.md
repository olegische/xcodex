# Codex WASM Bridge Protocol

## Purpose

This document defines the internal A2 bridge contract between Rust WASM runtime code and the JavaScript host runtime.

It does not define the preferred UI-facing runtime contract. The UI-facing contract should stay on a reuse path from `codex-rs/app-server-protocol`.

The internal host bridge is intentionally JSON-first:

- browser hosts can implement it without Rust-specific bindings;
- Rust can serialize and deserialize it with `serde`;
- the same protocol can be carried over `postMessage`, direct function calls, or worker boundaries.

## Envelope

Every bridge message uses a shared envelope:

```json
{
  "id": "msg-1",
  "payload": {
    "kind": "request",
    "method": "fsReadFile",
    "params": {
      "path": "/repo/src/lib.rs"
    }
  }
}
```

Fields:

- `id`: caller-generated correlation id.
- `payload.kind`: `request`, `response`, or `event`.

## Request Surface

### Filesystem

- `fsReadFile`
- `fsListDir`
- `fsSearch`
- `fsWriteFile`
- `fsApplyPatch`

### Model transport

- `modelStart`
- `modelCancel`

### Tool execution

- `toolList`
- `toolInvoke`
- `toolCancel`

### Session persistence

- `sessionLoad`
- `sessionSave`

### Optional capabilities

- `gitMetadata`
- `mcpInvoke`

## Response Surface

Responses use the same correlation `id` and carry:

- the method-specific `result`, or
- `method: "error"` with a structured `HostError`.

`HostError` fields:

- `code`
- `message`
- `retryable`
- `data`

## Event Surface

Events are host-to-runtime pushes for streaming or progress updates.

Current event types:

- `modelStarted`
- `modelDelta`
- `modelCompleted`
- `modelFailed`
- `toolCallProgress`

## Design Rules

1. The bridge carries side effects, not deterministic runtime logic.
2. The bridge stays camelCase to match browser/TS conventions.
3. Payloads that are still evolving remain JSON-shaped via generic `payload` or `result` values.
4. Optional host capabilities (`git`, `mcp`) must fail explicitly with `unavailable`, not silently disappear.
5. This bridge is not a replacement for `app-server-protocol`; it is the capability layer under the WASM runtime.

## Current Code Owners

The first bridge implementation is mirrored in:

- Rust: `codex-rs/wasm-arch/core/src/bridge.rs`
- TypeScript: `codex-rs/wasm/ts/host-runtime/src/protocol.ts`
