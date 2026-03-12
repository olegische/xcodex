import test from "node:test";
import assert from "node:assert/strict";

import type { BridgeEnvelope, HostError } from "../src/index.ts";
import { loadFixture } from "./fixture-loader.ts";

test("bridge request fixture matches TypeScript protocol shape", async () => {
  const fixture = await loadFixture<BridgeEnvelope>("fs-read-file.request.json");

  assert.deepEqual(fixture, {
    id: "msg-1",
    payload: {
      kind: "request",
      method: "fsReadFile",
      params: {
        path: "/repo/src/lib.rs",
      },
    },
  });
});

test("bridge event fixture matches TypeScript protocol shape", async () => {
  const fixture = await loadFixture<BridgeEnvelope>("model-delta.event.json");

  assert.deepEqual(fixture, {
    id: "evt-1",
    payload: {
      kind: "event",
      event: "modelDelta",
      payload: {
        requestId: "req-1",
        payload: {
          delta: "hello",
        },
      },
    },
  });
});

test("host error fixture matches TypeScript protocol shape", async () => {
  const fixture = await loadFixture<HostError>("host-error.json");

  assert.deepEqual(fixture, {
    code: "unavailable",
    message: "host adapter missing",
    retryable: false,
    data: {
      adapter: "git",
    },
  });
});
