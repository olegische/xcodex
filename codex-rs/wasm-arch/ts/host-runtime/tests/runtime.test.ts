import test from "node:test";
import assert from "node:assert/strict";

import { BridgeProtocolError, HostRuntime } from "../src/index.ts";
import type { HostAdapters } from "../src/index.ts";

function createAdapters(): HostAdapters {
  return {
    fs: {
      async readFile(params) {
        return {
          path: params.path,
          content: "hello",
        };
      },
      async listDir() {
        return {
          entries: [],
        };
      },
      async search() {
        return {
          matches: [],
        };
      },
      async writeFile(params) {
        return {
          path: params.path,
          bytesWritten: params.content.length,
        };
      },
      async applyPatch() {
        return {
          filesChanged: ["src/app.ts"],
        };
      },
    },
    modelTransport: {
      async start(params) {
        return {
          requestId: params.requestId,
        };
      },
      async cancel() {},
    },
    toolExecutor: {
      async list() {
        return {
          tools: [
            {
              name: "readFile",
              description: "Read a file",
              inputSchema: { type: "object" },
            },
          ],
        };
      },
      async invoke(params) {
        return {
          callId: params.callId,
          output: { ok: true },
        };
      },
      async cancel() {},
    },
    sessionStore: {
      async load(params) {
        return {
          snapshot: {
            threadId: params.threadId,
            metadata: {},
            items: [],
          },
        };
      },
      async save() {},
    },
  };
}

test("HostRuntime handles filesystem request", async () => {
  const runtime = new HostRuntime(createAdapters());

  const response = await runtime.handleRequest({
    method: "fsReadFile",
    params: {
      path: "/repo/README.md",
    },
  });

  assert.deepEqual(response, {
    method: "fsReadFile",
    result: {
      path: "/repo/README.md",
      content: "hello",
    },
  });
});

test("HostRuntime reports missing optional git adapter", async () => {
  const runtime = new HostRuntime(createAdapters());

  await assert.rejects(
    () =>
      runtime.handleRequest({
        method: "gitMetadata",
        params: {
          path: "/repo",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof BridgeProtocolError);
      assert.equal(error.error.code, "unavailable");
      assert.equal(
        error.error.message,
        "optional host adapter `git` is not configured",
      );
      assert.deepEqual(error.error.data, {
        adapter: "git",
      });
      return true;
    },
  );
});

test("HostRuntime creates event envelope", () => {
  const runtime = new HostRuntime(createAdapters());

  const envelope = runtime.toEventEnvelope("evt-1", {
    event: "modelCompleted",
    payload: {
      requestId: "req-1",
    },
  });

  assert.deepEqual(envelope, {
    id: "evt-1",
    payload: {
      kind: "event",
      event: "modelCompleted",
      payload: {
        requestId: "req-1",
      },
    },
  });
});
