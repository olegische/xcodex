import {
  AGENT_CARD_PATH,
  type AgentCard,
  type AgentSkill,
  type Artifact,
  type Message as A2AMessage,
  type MessageSendParams,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskIdParams,
  type TaskQueryParams,
  type TaskStatus,
  type TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  type Client as A2AClient,
} from "@a2a-js/sdk/client";
import type { ClientRequest } from "../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { ThreadStartResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { TurnStartResponse } from "../../../../app-server-protocol/schema/typescript/v2/TurnStartResponse";
import {
  asRecord,
  type CodexAppServerConnection,
  type CodexAppServerConnectionEvent,
  type CodexServerRequestHandler,
  defaultServerRequestHandler,
  formatErrorMessage,
  jsonResponse,
  SSE_HEADERS,
  toRequest,
} from "./shared.ts";

export type CodexA2AAgentCardOptions = {
  name?: string;
  description?: string;
  version?: string;
  documentationUrl?: string;
  iconUrl?: string;
  provider?: AgentCard["provider"];
  skills?: AgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
};

export type CreateCodexA2AFetchOptions = {
  connection: CodexAppServerConnection;
  baseUrl?: string;
  defaultModel?: string;
  defaultCwd?: string;
  agentCard?: CodexA2AAgentCardOptions;
  threadStart?: {
    cwd?: string;
    approvalPolicy?: string | null;
    sandbox?: string | null;
    baseInstructions?: string | null;
    developerInstructions?: string | null;
    serviceName?: string | null;
    ephemeral?: boolean | null;
    modelProvider?: string | null;
  };
  turnStart?: {
    cwd?: string;
    approvalPolicy?: string | null;
  };
  handleServerRequest?: CodexServerRequestHandler;
};

export type CreateCodexA2AClientOptions = CreateCodexA2AFetchOptions & {
  clientFactory?: Partial<ClientFactoryOptions>;
};

type CodexA2AStreamEvent = Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

type ActiveA2ATaskState = {
  taskId: string;
  threadId: string;
  turnId: string | null;
  task: Task;
  assistantText: string;
  artifactId: string;
  unsubscribe: (() => void) | null;
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
  writeChain: Promise<void>;
  donePromise: Promise<Task>;
  resolveDone: (task: Task) => void;
  handleServerRequest: CodexServerRequestHandler;
  jsonRpcRequestId: string | number | null;
  cancelled: boolean;
};

export function createCodexA2AAgentCard(options: {
  baseUrl?: string;
  agentCard?: CodexA2AAgentCardOptions;
} = {}): AgentCard {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://xcodex.local");
  return {
    name: options.agentCard?.name ?? "xcodex",
    description:
      options.agentCard?.description ??
      "xcodex exposed as an A2A-compatible agent over the Codex app-server protocol.",
    protocolVersion: "0.3.0",
    version: options.agentCard?.version ?? "0.1.0",
    url: `${baseUrl}/a2a/jsonrpc`,
    preferredTransport: "JSONRPC",
    documentationUrl: options.agentCard?.documentationUrl,
    iconUrl: options.agentCard?.iconUrl,
    provider: options.agentCard?.provider,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: options.agentCard?.defaultInputModes ?? ["text"],
    defaultOutputModes: options.agentCard?.defaultOutputModes ?? ["text"],
    skills: options.agentCard?.skills ?? [
      {
        id: "codex-chat",
        name: "Codex Chat",
        description: "Interactive coding and agentic execution through Codex.",
        tags: ["coding", "assistant", "codex"],
      },
    ],
  };
}

export async function createCodexA2AClient(
  options: CreateCodexA2AClientOptions,
): Promise<A2AClient> {
  const fetchImpl = createCodexA2AFetch(options);
  const factoryOptions = ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({
      fetchImpl,
    }),
    preferredTransports: ["JSONRPC"],
    transports: [
      new JsonRpcTransportFactory({
        fetchImpl,
      }),
    ],
    ...options.clientFactory,
  });
  const factory = new ClientFactory(factoryOptions);
  return factory.createFromUrl(normalizeBaseUrl(options.baseUrl ?? "https://xcodex.local"));
}

export function createCodexA2AFetch(
  options: CreateCodexA2AFetchOptions,
): typeof fetch {
  const taskStore = new Map<string, Task>();
  const activeTasks = new Map<string, ActiveA2ATaskState>();
  const agentCard = createCodexA2AAgentCard({
    baseUrl: options.baseUrl,
    agentCard: options.agentCard,
  });
  const handleServerRequest = options.handleServerRequest ?? defaultServerRequestHandler;

  return async (input, init) => {
    const request = toRequest(input, init);
    const url = new URL(request.url);
    const pathname = normalizeA2APathname(url);

    try {
      if (request.method === "GET" && pathname === `/${AGENT_CARD_PATH}`) {
        return jsonResponse(agentCard);
      }

      if (request.method === "POST" && pathname === "/a2a/jsonrpc") {
        const rpcRequest = await request.json();
        if (Array.isArray(rpcRequest)) {
          return a2aJsonRpcErrorResponse(null, -32600, "Batch requests are not supported.");
        }
        const envelope = asRecord(rpcRequest);
        const method = typeof envelope?.method === "string" ? envelope.method : null;
        const requestId =
          typeof envelope?.id === "string" || typeof envelope?.id === "number"
            ? envelope.id
            : null;
        const params = envelope?.params;

        switch (method) {
          case "message/send": {
            const task = await runA2ATask({
              connection: options.connection,
              taskStore,
              activeTasks,
              requestId,
              params,
              defaultModel: options.defaultModel,
              defaultCwd: options.defaultCwd,
              threadStartDefaults: options.threadStart,
              turnStartDefaults: options.turnStart,
              handleServerRequest,
            });
            const historyLength = getA2AHistoryLength(params);
            return a2aJsonRpcSuccessResponse(requestId, sliceTaskHistory(task, historyLength));
          }
          case "message/stream":
            return await createA2AStreamingResponse({
              connection: options.connection,
              taskStore,
              activeTasks,
              requestId,
              params,
              defaultModel: options.defaultModel,
              defaultCwd: options.defaultCwd,
              threadStartDefaults: options.threadStart,
              turnStartDefaults: options.turnStart,
              handleServerRequest,
            });
          case "tasks/get": {
            const taskParams = assertA2ATaskQueryParams(params);
            const task = taskStore.get(taskParams.id) ?? activeTasks.get(taskParams.id)?.task;
            if (task === undefined) {
              return a2aJsonRpcErrorResponse(requestId, -32001, `Unknown task: ${taskParams.id}`);
            }
            return a2aJsonRpcSuccessResponse(
              requestId,
              sliceTaskHistory(task, taskParams.historyLength),
            );
          }
          case "tasks/cancel": {
            const taskParams = assertA2ATaskIdParams(params);
            const activeTask = activeTasks.get(taskParams.id);
            if (activeTask === undefined) {
              const task = taskStore.get(taskParams.id);
              if (task === undefined) {
                return a2aJsonRpcErrorResponse(
                  requestId,
                  -32001,
                  `Unknown task: ${taskParams.id}`,
                );
              }
              return a2aJsonRpcSuccessResponse(requestId, structuredClone(task));
            }
            if (activeTask.turnId !== null) {
              await options.connection.request({
                id: `a2a:cancel:${activeTask.taskId}`,
                method: "turn/interrupt",
                params: {
                  threadId: activeTask.threadId,
                  turnId: activeTask.turnId,
                },
              } as ClientRequest);
            }
            activeTask.cancelled = true;
            activeTask.task = {
              ...activeTask.task,
              status: {
                state: "canceled",
                timestamp: isoTimestamp(),
                message: createA2AAgentMessage(
                  activeTask.taskId,
                  activeTask.threadId,
                  "Task cancellation requested.",
                ),
              },
            };
            return a2aJsonRpcSuccessResponse(requestId, structuredClone(activeTask.task));
          }
          default:
            return a2aJsonRpcErrorResponse(
              requestId,
              -32601,
              `Unsupported A2A method: ${method ?? "<unknown>"}`,
            );
        }
      }
    } catch (error) {
      return a2aJsonRpcErrorResponse(null, -32603, formatErrorMessage(error));
    }

    return new Response("Not found", { status: 404 });
  };
}

async function createA2AStreamingResponse(args: {
  connection: CodexAppServerConnection;
  taskStore: Map<string, Task>;
  activeTasks: Map<string, ActiveA2ATaskState>;
  requestId: string | number | null;
  params: unknown;
  defaultModel?: string;
  defaultCwd?: string;
  threadStartDefaults?: CreateCodexA2AFetchOptions["threadStart"];
  turnStartDefaults?: CreateCodexA2AFetchOptions["turnStart"];
  handleServerRequest: CodexServerRequestHandler;
}): Promise<Response> {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const response = new Response(stream.readable, {
    status: 200,
    headers: SSE_HEADERS,
  });
  void (async () => {
    try {
      await startA2ATask({
        ...args,
        streamWriter: writer,
      });
    } catch (error) {
      const encoder = new TextEncoder();
      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: args.requestId,
            error: {
              code: -32603,
              message: formatErrorMessage(error),
            },
          })}\n\n`,
        ),
      );
      await writer.close();
    }
  })();
  return response;
}

async function runA2ATask(args: {
  connection: CodexAppServerConnection;
  taskStore: Map<string, Task>;
  activeTasks: Map<string, ActiveA2ATaskState>;
  requestId: string | number | null;
  params: unknown;
  defaultModel?: string;
  defaultCwd?: string;
  threadStartDefaults?: CreateCodexA2AFetchOptions["threadStart"];
  turnStartDefaults?: CreateCodexA2AFetchOptions["turnStart"];
  handleServerRequest: CodexServerRequestHandler;
}): Promise<Task> {
  const state = await startA2ATask(args);
  return state.donePromise;
}

async function startA2ATask(args: {
  connection: CodexAppServerConnection;
  taskStore: Map<string, Task>;
  activeTasks: Map<string, ActiveA2ATaskState>;
  requestId: string | number | null;
  params: unknown;
  defaultModel?: string;
  defaultCwd?: string;
  threadStartDefaults?: CreateCodexA2AFetchOptions["threadStart"];
  turnStartDefaults?: CreateCodexA2AFetchOptions["turnStart"];
  handleServerRequest: CodexServerRequestHandler;
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
}): Promise<ActiveA2ATaskState> {
  const sendParams = assertA2AMessageSendParams(args.params);
  const userMessage = normalizeA2AUserMessage(sendParams.message);
  const requestedTaskId = sendParams.message.taskId ?? sendParams.message.contextId ?? null;
  const existingTask =
    requestedTaskId === null ? null : args.taskStore.get(requestedTaskId) ?? null;

  if (requestedTaskId !== null && existingTask === null) {
    throw new Error(`Unknown task: ${requestedTaskId}`);
  }

  const threadId =
    existingTask?.id ??
    (
      (
        await args.connection.request({
          id: `a2a:thread:start:${crypto.randomUUID()}`,
          method: "thread/start",
          params: {
            model: args.defaultModel ?? "gpt-5",
            cwd: args.threadStartDefaults?.cwd ?? args.defaultCwd ?? null,
            approvalPolicy: args.threadStartDefaults?.approvalPolicy ?? null,
            sandbox: args.threadStartDefaults?.sandbox ?? null,
            modelProvider: args.threadStartDefaults?.modelProvider ?? null,
            baseInstructions: args.threadStartDefaults?.baseInstructions ?? null,
            developerInstructions: args.threadStartDefaults?.developerInstructions ?? null,
            serviceName: args.threadStartDefaults?.serviceName ?? "xcodex-a2a",
            ephemeral: args.threadStartDefaults?.ephemeral ?? null,
            experimentalRawEvents: true,
            persistExtendedHistory: true,
          },
        } as ClientRequest)
      ) as ThreadStartResponse
    ).thread.id;

  if (args.activeTasks.has(threadId)) {
    throw new Error(`Task ${threadId} already has an active turn.`);
  }

  let resolveDone!: (task: Task) => void;
  const donePromise = new Promise<Task>((resolve) => {
    resolveDone = resolve;
  });

  const task: Task = {
    kind: "task",
    id: threadId,
    contextId: threadId,
    history: [...(existingTask?.history ?? []), userMessage],
    artifacts: [...(existingTask?.artifacts ?? [])],
    status: {
      state: "submitted",
      timestamp: isoTimestamp(),
    },
  };

  const state: ActiveA2ATaskState = {
    taskId: threadId,
    threadId,
    turnId: null,
    task,
    assistantText: "",
    artifactId: `assistant:${crypto.randomUUID()}`,
    unsubscribe: null,
    streamWriter: args.streamWriter,
    writeChain: Promise.resolve(),
    donePromise,
    resolveDone,
    handleServerRequest: args.handleServerRequest,
    jsonRpcRequestId: args.requestId,
    cancelled: false,
  };

  args.taskStore.set(threadId, structuredClone(task));
  args.activeTasks.set(threadId, state);
  state.unsubscribe = args.connection.subscribe((event) => {
    void handleA2AConnectionEvent(event, state, args.connection, args.taskStore, args.activeTasks);
  });

  await emitA2AStreamEvent(state, structuredClone(task));

  try {
    const turnResponse = (await args.connection.request({
      id: `a2a:turn:start:${threadId}`,
      method: "turn/start",
      params: {
        threadId,
        input: [
          {
            type: "text",
            text: flattenA2AMessageText(userMessage),
            text_elements: [],
          },
        ],
        cwd: args.turnStartDefaults?.cwd ?? args.defaultCwd ?? null,
        approvalPolicy: args.turnStartDefaults?.approvalPolicy ?? null,
        model: args.defaultModel ?? "gpt-5",
      },
    } as ClientRequest)) as TurnStartResponse;
    state.turnId = turnResponse.turn.id;
    await updateA2ATaskStatus(state, "working", {
      final: false,
    });
  } catch (error) {
    await finalizeA2ATask(state, args.taskStore, args.activeTasks, {
      status: "failed",
      statusMessage: formatErrorMessage(error),
    });
    throw error;
  }

  return state;
}

async function handleA2AConnectionEvent(
  event: CodexAppServerConnectionEvent,
  state: ActiveA2ATaskState,
  connection: CodexAppServerConnection,
  taskStore: Map<string, Task>,
  activeTasks: Map<string, ActiveA2ATaskState>,
): Promise<void> {
  if (event.type === "lagged") {
    return;
  }

  if (event.type === "serverRequest") {
    const requestThreadId =
      asRecord(event.request.params)?.threadId ??
      asRecord(asRecord(event.request.params)?.turn)?.threadId;
    if (requestThreadId !== state.threadId) {
      return;
    }
    try {
      const result = await state.handleServerRequest(event.request);
      await connection.resolveServerRequest(event.request.id, result);
    } catch (error) {
      await updateA2ATaskStatus(state, "input-required", {
        final: false,
        messageText: `A2A compatibility mode cannot losslessly satisfy ${event.request.method}.`,
      });
      await connection.rejectServerRequest(event.request.id, {
        code: -32000,
        message: formatErrorMessage(error),
      });
    }
    return;
  }

  const notification = event.notification;
  const params = asRecord(notification.params);
  if (params?.threadId !== state.threadId) {
    return;
  }
  if (state.turnId !== null && typeof params?.turnId === "string" && params.turnId !== state.turnId) {
    return;
  }
  if (state.turnId !== null) {
    const turn = asRecord(params?.turn);
    if (typeof turn?.id === "string" && turn.id !== state.turnId) {
      return;
    }
  }

  switch (notification.method) {
    case "turn/started":
      await updateA2ATaskStatus(state, "working", {
        final: false,
      });
      return;
    case "item/agentMessage/delta": {
      const delta = typeof params?.delta === "string" ? params.delta : "";
      if (delta.length === 0) {
        return;
      }
      state.assistantText += delta;
      await updateA2ATaskStatus(state, "working", {
        final: false,
      });
      await emitA2AStreamEvent(state, {
        kind: "artifact-update",
        taskId: state.taskId,
        contextId: state.threadId,
        append: true,
        artifact: {
          artifactId: state.artifactId,
          parts: [
            {
              kind: "text",
              text: delta,
            },
          ],
        },
      } satisfies TaskArtifactUpdateEvent);
      return;
    }
    case "turn/completed": {
      const turn = asRecord(params?.turn);
      const status = mapTurnStatusToA2AState(turn?.status, state.cancelled);
      const errorMessage =
        typeof asRecord(turn?.error)?.message === "string"
          ? String(asRecord(turn?.error)?.message)
          : null;
      await finalizeA2ATask(state, taskStore, activeTasks, {
        status,
        statusMessage: errorMessage,
      });
      return;
    }
    default:
      return;
  }
}

async function finalizeA2ATask(
  state: ActiveA2ATaskState,
  taskStore: Map<string, Task>,
  activeTasks: Map<string, ActiveA2ATaskState>,
  outcome: {
    status: TaskStatus["state"];
    statusMessage?: string | null;
  },
): Promise<void> {
  const task = structuredClone(state.task);
  const history = Array.isArray(task.history) ? [...task.history] : [];

  if (state.assistantText.length > 0) {
    const assistantMessage = createA2AAgentMessage(
      state.taskId,
      state.threadId,
      state.assistantText,
    );
    history.push(assistantMessage);
    task.artifacts = [
      ...(task.artifacts ?? []),
      {
        artifactId: state.artifactId,
        parts: [
          {
            kind: "text",
            text: state.assistantText,
          },
        ],
      } satisfies Artifact,
    ];
  }

  task.history = history;
  task.status = {
    state: outcome.status,
    timestamp: isoTimestamp(),
    message:
      typeof outcome.statusMessage === "string"
        ? createA2AAgentMessage(state.taskId, state.threadId, outcome.statusMessage)
        : undefined,
  };

  state.task = task;
  taskStore.set(state.taskId, structuredClone(task));
  activeTasks.delete(state.taskId);

  await emitA2AStreamEvent(state, {
    kind: "status-update",
    taskId: state.taskId,
    contextId: state.threadId,
    status: structuredClone(task.status),
    final: true,
  } satisfies TaskStatusUpdateEvent);
  await closeA2AStream(state);
  state.unsubscribe?.();
  state.resolveDone(structuredClone(task));
}

async function updateA2ATaskStatus(
  state: ActiveA2ATaskState,
  status: TaskStatus["state"],
  options: {
    final: boolean;
    messageText?: string;
  },
): Promise<void> {
  const nextStatus: TaskStatus = {
    state: status,
    timestamp: isoTimestamp(),
    message:
      typeof options.messageText === "string"
        ? createA2AAgentMessage(state.taskId, state.threadId, options.messageText)
        : undefined,
  };
  state.task = {
    ...state.task,
    status: nextStatus,
  };
  await emitA2AStreamEvent(state, {
    kind: "status-update",
    taskId: state.taskId,
    contextId: state.threadId,
    status: structuredClone(nextStatus),
    final: options.final,
  } satisfies TaskStatusUpdateEvent);
}

async function emitA2AStreamEvent(
  state: ActiveA2ATaskState,
  event: CodexA2AStreamEvent,
): Promise<void> {
  if (state.streamWriter === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  state.writeChain = state.writeChain.then(async () => {
    if (state.streamWriter === undefined) {
      return;
    }
    await state.streamWriter.write(
      encoder.encode(
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          id: state.jsonRpcRequestId,
          result: event,
        })}\n\n`,
      ),
    );
  });
  await state.writeChain;
}

async function closeA2AStream(state: ActiveA2ATaskState): Promise<void> {
  if (state.streamWriter === undefined) {
    return;
  }
  state.writeChain = state.writeChain.then(async () => {
    if (state.streamWriter === undefined) {
      return;
    }
    await state.streamWriter.close();
  });
  await state.writeChain;
  state.streamWriter = undefined;
}

function assertA2AMessageSendParams(value: unknown): MessageSendParams {
  const params = asRecord(value);
  const message = asRecord(params?.message);
  if (message?.kind !== "message" || message.role !== "user" || !Array.isArray(message.parts)) {
    throw new Error("A2A adapter expects a user message with parts.");
  }
  return value as MessageSendParams;
}

function assertA2ATaskQueryParams(value: unknown): TaskQueryParams {
  const params = asRecord(value);
  if (typeof params?.id !== "string") {
    throw new Error("A2A task query requires an id.");
  }
  return value as TaskQueryParams;
}

function assertA2ATaskIdParams(value: unknown): TaskIdParams {
  const params = asRecord(value);
  if (typeof params?.id !== "string") {
    throw new Error("A2A task operation requires an id.");
  }
  return value as TaskIdParams;
}

function normalizeA2AUserMessage(message: MessageSendParams["message"]): A2AMessage {
  const parts = message.parts.flatMap((part) => {
    const record = asRecord(part);
    if (record?.kind === "text" && typeof record.text === "string") {
      return [
        {
          kind: "text",
          text: record.text,
        },
      ];
    }
    return [];
  });
  if (parts.length === 0) {
    throw new Error("A2A v1 adapter currently supports text parts only.");
  }
  return {
    kind: "message",
    messageId:
      typeof message.messageId === "string" && message.messageId.length > 0
        ? message.messageId
        : crypto.randomUUID(),
    role: "user",
    taskId: message.taskId,
    contextId: message.contextId,
    parts,
  };
}

function createA2AAgentMessage(taskId: string, contextId: string, text: string): A2AMessage {
  return {
    kind: "message",
    messageId: crypto.randomUUID(),
    role: "agent",
    taskId,
    contextId,
    parts: [
      {
        kind: "text",
        text,
      },
    ],
  };
}

function flattenA2AMessageText(message: A2AMessage): string {
  return message.parts
    .flatMap((part) => {
      const record = asRecord(part);
      return record?.kind === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
}

function sliceTaskHistory(task: Task, historyLength?: number): Task {
  if (typeof historyLength !== "number" || historyLength < 0 || task.history === undefined) {
    return structuredClone(task);
  }
  if (historyLength === 0) {
    return {
      ...structuredClone(task),
      history: [],
    };
  }
  return {
    ...structuredClone(task),
    history: task.history.slice(-historyLength),
  };
}

function getA2AHistoryLength(params: unknown): number | undefined {
  const configuration = asRecord(asRecord(params)?.configuration);
  return typeof configuration?.historyLength === "number" ? configuration.historyLength : undefined;
}

function mapTurnStatusToA2AState(
  value: unknown,
  cancelled: boolean,
): TaskStatus["state"] {
  if (cancelled || value === "interrupted") {
    return "canceled";
  }
  if (value === "failed") {
    return "failed";
  }
  return "completed";
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeA2APathname(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/";
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

function a2aJsonRpcSuccessResponse(id: string | number | null, result: unknown): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function a2aJsonRpcErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}
