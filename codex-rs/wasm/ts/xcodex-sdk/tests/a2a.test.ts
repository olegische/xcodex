import assert from "node:assert/strict";
import test from "node:test";
import {
  createCodexA2AClient,
  createRpcCodexConnection,
} from "../src/index.ts";

function createFakeConnection(options: {
  completionDelayMs?: number;
} = {}) {
  const listeners = new Set<(event: unknown) => void>();
  const completionDelayMs = options.completionDelayMs ?? 0;
  let nextThreadId = 1;
  let nextTurnId = 1;
  const activeTurns = new Map<
    string,
    {
      threadId: string;
      timer: ReturnType<typeof setTimeout> | null;
      completed: boolean;
    }
  >();

  function emit(event: unknown) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function completeTurn(turnId: string, status: "completed" | "interrupted") {
    const active = activeTurns.get(turnId);
    if (active === undefined || active.completed) {
      return;
    }
    active.completed = true;
    if (active.timer !== null) {
      clearTimeout(active.timer);
    }
    emit({
      type: "notification",
      notification: {
        method: "turn/completed",
        params: {
          threadId: active.threadId,
          turn: {
            id: turnId,
            items: [],
            status,
            error: null,
          },
        },
      },
    });
  }

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
          emit({
            type: "notification",
            notification: {
              method: "turn/started",
              params: {
                threadId: request.params.threadId,
                turn: {
                  id: turnId,
                  items: [],
                  status: "inProgress",
                  error: null,
                },
              },
            },
          });
          const timer = setTimeout(() => {
            emit({
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
            completeTurn(turnId, "completed");
          }, completionDelayMs);
          activeTurns.set(turnId, {
            threadId: request.params.threadId,
            timer,
            completed: false,
          });
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
          completeTurn(request.params.turnId, "interrupted");
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

test("official A2A client can send messages through the xcodex adapter", async () => {
  const client = await createCodexA2AClient({
    connection: createFakeConnection(),
    baseUrl: "https://xcodex.local",
    defaultModel: "gpt-test",
  });

  const task = await client.sendMessage({
    message: {
      kind: "message",
      messageId: "msg-1",
      role: "user",
      parts: [{ kind: "text", text: "hi" }],
    },
  });

  assert.equal(task.kind, "task");
  assert.equal(task.status.state, "completed");
  assert.equal(task.history?.length, 2);
  assert.equal(task.history?.[0]?.role, "user");
  assert.equal(task.history?.[1]?.role, "agent");
  assert.equal(task.artifacts?.[0]?.parts?.[0]?.kind, "text");
  assert.equal(task.artifacts?.[0]?.parts?.[0]?.text, "hello from codex");

  const loaded = await client.getTask({
    id: task.id,
    historyLength: 1,
  });
  assert.equal(loaded.history?.length, 1);
  assert.equal(loaded.history?.[0]?.role, "agent");
});

test("official A2A client can stream and cancel an xcodex task", async () => {
  const client = await createCodexA2AClient({
    connection: createFakeConnection({
      completionDelayMs: 50,
    }),
    baseUrl: "https://xcodex.local",
    defaultModel: "gpt-test",
  });

  const events: Array<Record<string, unknown>> = [];
  let taskId: string | null = null;
  let streamError: unknown = null;
  const stream = client.sendMessageStream({
    message: {
      kind: "message",
      messageId: "msg-2",
      role: "user",
      parts: [{ kind: "text", text: "cancel me" }],
    },
  });

  const consumeStream = (async () => {
    try {
      for await (const event of stream) {
        events.push(event as Record<string, unknown>);
        if (event.kind === "task" && taskId === null) {
          taskId = event.id;
        }
      }
    } catch (error) {
      streamError = error;
    }
  })();

  await waitFor(() => taskId !== null || streamError !== null);
  if (streamError !== null) {
    throw streamError;
  }
  const cancelled = await client.cancelTask({ id: taskId ?? "missing-task-id" });
  assert.equal(cancelled.status.state, "canceled");
  await consumeStream;

  assert.notEqual(taskId, null);
  assert.equal(streamError, null);
  assert.equal(events[0]?.kind, "task");
  assert.ok(
    events.some(
      (event) => event.kind === "status-update" && event.status?.state === "canceled",
    ),
  );
});

async function waitFor(check: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
