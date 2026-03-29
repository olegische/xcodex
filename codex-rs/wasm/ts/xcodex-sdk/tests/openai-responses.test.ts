import assert from "node:assert/strict";
import test from "node:test";
import {
  createCodexOpenAIClient,
  createCodexResponsesFetch,
  createRpcCodexConnection,
} from "../src/index.ts";

function createFakeConnection() {
  const listeners = new Set<(event: unknown) => void>();
  let nextThreadId = 1;
  let nextTurnId = 1;

  return createRpcCodexConnection({
    async request(request) {
      switch (request.method) {
        case "thread/start":
          return {
            thread: {
              id: `thread-${nextThreadId++}`,
            },
          };
        case "turn/start": {
          const turnId = `turn-${nextTurnId++}`;
          setTimeout(() => {
            for (const listener of listeners) {
              listener({
                type: "notification",
                notification: {
                  method: "item/agentMessage/delta",
                  params: {
                    threadId: request.params.threadId,
                    turnId,
                    itemId: `${turnId}:assistant`,
                    delta: "hello from codex",
                  },
                },
              });
            }
            for (const listener of listeners) {
              listener({
                type: "notification",
                notification: {
                  method: "rawResponseItem/completed",
                  params: {
                    threadId: request.params.threadId,
                    turnId,
                    item: {
                      type: "message",
                      role: "assistant",
                      content: [
                        {
                          type: "output_text",
                          text: "hello from codex",
                        },
                      ],
                    },
                  },
                },
              });
            }
            for (const listener of listeners) {
              listener({
                type: "notification",
                notification: {
                  method: "turn/completed",
                  params: {
                    threadId: request.params.threadId,
                    turnId,
                  },
                },
              });
            }
          }, 0);
          return {
            turn: {
              id: turnId,
              items: [],
              status: "inProgress",
              error: null,
            },
          };
        }
        case "turn/interrupt":
          return {};
        default:
          throw new Error(`unexpected request: ${request.method}`);
      }
    },
    async resolveServerRequest() {},
    async rejectServerRequest() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

test("non-stream responses.create returns a completed OpenAI response", async () => {
  const client = createCodexOpenAIClient({
    connection: createFakeConnection(),
    defaultModel: "gpt-test",
  });

  const response = await client.responses.create({
    model: "gpt-test",
    input: "hi",
  });

  assert.equal(response.object, "response");
  assert.equal(response.status, "completed");
  assert.equal(response.output_text, "hello from codex");
  assert.equal(response.output[0]?.type, "message");

  const stored = await client.responses.retrieve(response.id);
  assert.equal(stored.output_text, "hello from codex");

  const inputItems = await client.responses.inputItems.list(response.id);
  assert.equal(inputItems.data.length, 1);
});

test("streaming fetch returns Responses-compatible SSE events", async () => {
  const fetch = createCodexResponsesFetch({
    connection: createFakeConnection(),
    defaultModel: "gpt-test",
  });

  const response = await fetch("https://xcodex.local/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-test",
      input: "hi",
      stream: true,
    }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /"type":"response\.created"/);
  assert.match(body, /"type":"response\.output_item\.added"/);
  assert.match(body, /"type":"response\.output_text\.delta"/);
  assert.match(body, /"type":"response\.output_item\.done"/);
  assert.match(body, /"type":"response\.completed"/);
  assert.match(body, /\[DONE\]/);
});
