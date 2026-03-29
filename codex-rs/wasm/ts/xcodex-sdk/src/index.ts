import OpenAI from "openai";
import type { ClientNotification } from "../../../../app-server-protocol/schema/typescript/ClientNotification";
import type { ClientRequest } from "../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { RequestId } from "../../../../app-server-protocol/schema/typescript/RequestId";
import type { ServerNotification } from "../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
import type { ThreadStartResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { TurnStartResponse } from "../../../../app-server-protocol/schema/typescript/v2/TurnStartResponse";
import {
  AppServerClient,
  type AppServerClientEvent,
  startBrowserAppServerClient,
} from "@browser-codex/wasm-runtime-core";
import type {
  JsonValue,
  RuntimeModule,
  WasmProtocolRuntime,
} from "@browser-codex/wasm-runtime-core/types";

type OpenAiClientOptions = ConstructorParameters<typeof OpenAI>[0];
type OpenAiFetch = NonNullable<OpenAiClientOptions["fetch"]>;
type OpenAiResponseCreateParams = OpenAI.Responses.ResponseCreateParams;
type OpenAiResponse = OpenAI.Responses.Response;
type OpenAiResponseInputItem = OpenAI.Responses.ResponseInputItem;
type OpenAiResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent;

type ConnectionEvent =
  | { type: "notification"; notification: ServerNotification }
  | { type: "serverRequest"; request: ServerRequest }
  | { type: "lagged"; skipped: number };

export type CodexAppServerConnection = {
  request(request: ClientRequest): Promise<unknown>;
  notify?(notification: ClientNotification): Promise<void>;
  resolveServerRequest(requestId: RequestId, result: JsonValue): Promise<void>;
  rejectServerRequest(
    requestId: RequestId,
    error: {
      code: number;
      message: string;
      data?: JsonValue;
    },
  ): Promise<void>;
  subscribe(listener: (event: ConnectionEvent) => void): () => void;
  shutdown?(): Promise<void>;
};

export type CodexRpcConnectionOptions = {
  request(request: ClientRequest): Promise<unknown>;
  notify?(notification: ClientNotification): Promise<void>;
  resolveServerRequest(requestId: RequestId, result: JsonValue): Promise<void>;
  rejectServerRequest(
    requestId: RequestId,
    error: {
      code: number;
      message: string;
      data?: JsonValue;
    },
  ): Promise<void>;
  subscribe(listener: (event: ConnectionEvent) => void): () => void;
  shutdown?(): Promise<void>;
};

export type CodexAbiConnectionOptions =
  | {
      runtime: WasmProtocolRuntime;
      clientName?: string;
      clientVersion?: string;
      experimentalApi?: boolean;
      optOutNotificationMethods?: string[];
      channelCapacity?: number;
    }
  | {
      runtimeModule: RuntimeModule;
      host: unknown;
      experimentalApi?: boolean;
    };

export type CodexServerRequestHandler = (request: ServerRequest) => Promise<JsonValue>;

export type CreateCodexResponsesFetchOptions = {
  connection: CodexAppServerConnection;
  defaultModel?: string;
  defaultCwd?: string;
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

export type CreateCodexOpenAIClientOptions = CreateCodexResponsesFetchOptions & {
  openai?: Omit<OpenAiClientOptions, "fetch" | "baseURL">;
  baseURL?: string;
  apiKey?: string;
};

type StoredResponseRecord = {
  response: OpenAiResponse;
  inputItems: OpenAiResponseInputItem[];
  threadId: string;
  turnId: string;
  completed: boolean;
  cancelled: boolean;
};

type ActiveTurnState = {
  responseId: string;
  threadId: string;
  turnId: string | null;
  requestBody: OpenAiResponseCreateParams;
  inputItems: OpenAiResponseInputItem[];
  response: OpenAiResponse;
  sequenceNumber: number;
  assistantOutputIndex: number | null;
  assistantItemId: string | null;
  assistantText: string;
  unsubscribe: (() => void) | null;
  completed: boolean;
  cancelled: boolean;
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
  writeChain: Promise<void>;
  resolveDone?: () => void;
  rejectDone?: (error: unknown) => void;
  donePromise: Promise<void>;
};

const JSON_HEADERS = {
  "content-type": "application/json",
} as const;
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

export function createRpcCodexConnection(
  options: CodexRpcConnectionOptions,
): CodexAppServerConnection {
  return {
    request: options.request,
    notify: options.notify,
    resolveServerRequest: options.resolveServerRequest,
    rejectServerRequest: options.rejectServerRequest,
    subscribe: options.subscribe,
    shutdown: options.shutdown,
  };
}

export async function createAbiCodexConnection(
  options: CodexAbiConnectionOptions,
): Promise<CodexAppServerConnection> {
  const client =
    "runtime" in options
      ? await AppServerClient.start(options.runtime, {
          clientName: options.clientName,
          clientVersion: options.clientVersion,
          experimentalApi: options.experimentalApi ?? true,
          optOutNotificationMethods: options.optOutNotificationMethods,
          channelCapacity: options.channelCapacity,
        })
      : await startBrowserAppServerClient(options.runtimeModule, options.host, {
          experimentalApi: options.experimentalApi ?? true,
        });
  return createConnectionFromAppServerClient(client);
}

export function createCodexOpenAIClient(
  options: CreateCodexOpenAIClientOptions,
): OpenAI {
  return new OpenAI({
    ...options.openai,
    apiKey: options.apiKey ?? "xcodex-local-adapter",
    baseURL: options.baseURL ?? "https://xcodex.local/v1",
    dangerouslyAllowBrowser: true,
    fetch: createCodexResponsesFetch(options),
  });
}

export function createCodexResponsesFetch(
  options: CreateCodexResponsesFetchOptions,
): OpenAiFetch {
  const responseStore = new Map<string, StoredResponseRecord>();
  const activeTurns = new Map<string, ActiveTurnState>();
  const handleServerRequest = options.handleServerRequest ?? defaultServerRequestHandler;

  return async (input, init) => {
    const request = toRequest(input, init);
    const url = new URL(request.url);
    const route = normalizeRoute(url);

    try {
      if (request.method === "POST" && route.pathname === "/responses") {
        const body = (await request.json()) as OpenAiResponseCreateParams;
        return body.stream === true
          ? await createStreamingResponse({
              connection: options.connection,
              responseStore,
              activeTurns,
              requestBody: body,
              defaultModel: options.defaultModel,
              defaultCwd: options.defaultCwd,
              threadStartDefaults: options.threadStart,
              turnStartDefaults: options.turnStart,
              handleServerRequest,
            })
          : await createJsonResponse({
              connection: options.connection,
              responseStore,
              activeTurns,
              requestBody: body,
              defaultModel: options.defaultModel,
              defaultCwd: options.defaultCwd,
              threadStartDefaults: options.threadStart,
              turnStartDefaults: options.turnStart,
              handleServerRequest,
            });
      }

      if (request.method === "GET" && route.responseId !== null && route.pathname === `/responses/${route.responseId}`) {
        const record = responseStore.get(route.responseId);
        if (record === undefined) {
          return jsonErrorResponse(404, `Unknown response: ${route.responseId}`);
        }
        if (url.searchParams.get("stream") === "true") {
          return createReplayStreamResponse(record.response);
        }
        return jsonResponse(record.response);
      }

      if (
        request.method === "POST" &&
        route.responseId !== null &&
        route.pathname === `/responses/${route.responseId}/cancel`
      ) {
        const state = activeTurns.get(route.responseId);
        if (state === undefined || state.turnId === null) {
          return jsonErrorResponse(409, `Response ${route.responseId} is not active`);
        }
        await options.connection.request({
          id: `cancel:${route.responseId}`,
          method: "turn/interrupt",
          params: {
            threadId: state.threadId,
            turnId: state.turnId,
          },
        } as ClientRequest);
        state.cancelled = true;
        return jsonResponse(finalizeSnapshot(state, "cancelled"));
      }

      if (
        request.method === "GET" &&
        route.responseId !== null &&
        route.pathname === `/responses/${route.responseId}/input_items`
      ) {
        const record = responseStore.get(route.responseId);
        if (record === undefined) {
          return jsonErrorResponse(404, `Unknown response: ${route.responseId}`);
        }
        return jsonResponse({
          object: "list",
          data: record.inputItems,
          first_id: record.inputItems[0]?.id ?? null,
          last_id: record.inputItems.at(-1)?.id ?? null,
          has_more: false,
        });
      }

      if (request.method === "DELETE" && route.responseId !== null && route.pathname === `/responses/${route.responseId}`) {
        responseStore.delete(route.responseId);
        return new Response(null, { status: 200 });
      }
    } catch (error) {
      return jsonErrorResponse(500, formatErrorMessage(error));
    }

    return jsonErrorResponse(404, `Unsupported adapter route: ${request.method} ${url.pathname}`);
  };
}

function createConnectionFromAppServerClient(client: AppServerClient): CodexAppServerConnection {
  const listeners = new Set<(event: ConnectionEvent) => void>();
  void pumpEvents(client, listeners);
  return {
    request(request) {
      return client.request(request);
    },
    notify(notification) {
      return client.notify(notification);
    },
    resolveServerRequest(requestId, result) {
      return client.resolveServerRequest(requestId, result);
    },
    rejectServerRequest(requestId, error) {
      return client.rejectServerRequest(requestId, error);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shutdown() {
      return client.shutdown();
    },
  };
}

async function pumpEvents(
  client: AppServerClient,
  listeners: Set<(event: ConnectionEvent) => void>,
): Promise<void> {
  while (true) {
    const event = await client.nextEvent();
    if (event === null) {
      return;
    }
    const mapped = mapAppServerEvent(event);
    if (mapped === null) {
      continue;
    }
    for (const listener of listeners) {
      listener(mapped);
    }
  }
}

function mapAppServerEvent(event: AppServerClientEvent): ConnectionEvent | null {
  switch (event.type) {
    case "notification":
      return { type: "notification", notification: event.notification };
    case "serverRequest":
      return { type: "serverRequest", request: event.request };
    case "lagged":
      return { type: "lagged", skipped: event.skipped };
    default:
      return null;
  }
}

async function createJsonResponse(args: {
  connection: CodexAppServerConnection;
  responseStore: Map<string, StoredResponseRecord>;
  activeTurns: Map<string, ActiveTurnState>;
  requestBody: OpenAiResponseCreateParams;
  defaultModel?: string;
  defaultCwd?: string;
  threadStartDefaults?: CreateCodexResponsesFetchOptions["threadStart"];
  turnStartDefaults?: CreateCodexResponsesFetchOptions["turnStart"];
  handleServerRequest: CodexServerRequestHandler;
}): Promise<Response> {
  const state = await startTurn(args);
  await state.donePromise;
  args.activeTurns.delete(state.responseId);
  args.responseStore.set(state.responseId, {
    response: finalizeSnapshot(state, state.cancelled ? "cancelled" : "completed"),
    inputItems: state.inputItems,
    threadId: state.threadId,
    turnId: state.turnId ?? state.responseId,
    completed: state.completed,
    cancelled: state.cancelled,
  });
  return jsonResponse(args.responseStore.get(state.responseId)?.response ?? state.response);
}

async function createStreamingResponse(args: {
  connection: CodexAppServerConnection;
  responseStore: Map<string, StoredResponseRecord>;
  activeTurns: Map<string, ActiveTurnState>;
  requestBody: OpenAiResponseCreateParams;
  defaultModel?: string;
  defaultCwd?: string;
  threadStartDefaults?: CreateCodexResponsesFetchOptions["threadStart"];
  turnStartDefaults?: CreateCodexResponsesFetchOptions["turnStart"];
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
      await startTurn({
        ...args,
        streamWriter: writer,
      });
    } catch (error) {
      const encoder = new TextEncoder();
      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "error",
            error: {
              message: formatErrorMessage(error),
            },
          })}\n\n`,
        ),
      );
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    }
  })();
  return response;
}

async function startTurn(args: {
  connection: CodexAppServerConnection;
  responseStore: Map<string, StoredResponseRecord>;
  activeTurns: Map<string, ActiveTurnState>;
  requestBody: OpenAiResponseCreateParams;
  defaultModel?: string;
  defaultCwd?: string;
  threadStartDefaults?: CreateCodexResponsesFetchOptions["threadStart"];
  turnStartDefaults?: CreateCodexResponsesFetchOptions["turnStart"];
  handleServerRequest: CodexServerRequestHandler;
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
}): Promise<ActiveTurnState> {
  assertSupportedRequest(args.requestBody);
  const inputItems = normalizeOpenAiInputItems(args.requestBody.input);
  const model = args.requestBody.model ?? args.defaultModel ?? "gpt-5";
  const previousResponseId = args.requestBody.previous_response_id ?? null;
  const previousRecord =
    previousResponseId === null ? null : args.responseStore.get(previousResponseId) ?? null;

  const threadId =
    previousRecord?.threadId ??
    (
      (
        await args.connection.request({
          id: `thread:start:${crypto.randomUUID()}`,
          method: "thread/start",
          params: {
            model,
            cwd: args.threadStartDefaults?.cwd ?? args.defaultCwd ?? null,
            approvalPolicy: args.threadStartDefaults?.approvalPolicy ?? null,
            sandbox: args.threadStartDefaults?.sandbox ?? null,
            modelProvider: args.threadStartDefaults?.modelProvider ?? null,
            baseInstructions:
              args.threadStartDefaults?.baseInstructions ??
              normalizeInstructions(args.requestBody.instructions),
            developerInstructions:
              args.threadStartDefaults?.developerInstructions ?? null,
            serviceName: args.threadStartDefaults?.serviceName ?? null,
            ephemeral: args.threadStartDefaults?.ephemeral ?? null,
            experimentalRawEvents: true,
            persistExtendedHistory: true,
          },
        } as ClientRequest)
      ) as ThreadStartResponse
    ).thread.id;

  const responseId = crypto.randomUUID();
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const state: ActiveTurnState = {
    responseId,
    threadId,
    turnId: null,
    requestBody: args.requestBody,
    inputItems,
    response: createInitialResponseSnapshot({
      responseId,
      model,
      requestBody: args.requestBody,
    }),
    sequenceNumber: 0,
    assistantOutputIndex: null,
    assistantItemId: null,
    assistantText: "",
    unsubscribe: null,
    completed: false,
    cancelled: false,
    streamWriter: args.streamWriter,
    writeChain: Promise.resolve(),
    resolveDone,
    rejectDone,
    donePromise,
  };

  state.unsubscribe = args.connection.subscribe((event) => {
    void handleConnectionEvent(event, state, args.connection, args.responseStore, args.handleServerRequest);
  });

  args.activeTurns.set(responseId, state);
  await emitCreatedEvent(state);

  try {
    const turnResponse = (await args.connection.request({
      id: `turn:start:${responseId}`,
      method: "turn/start",
      params: {
        threadId,
        input: normalizeUserInput(inputItems),
        cwd: args.turnStartDefaults?.cwd ?? args.defaultCwd ?? null,
        approvalPolicy: args.turnStartDefaults?.approvalPolicy ?? null,
        model,
        outputSchema: normalizeOutputSchema(args.requestBody),
      },
    } as ClientRequest)) as TurnStartResponse;
    state.turnId = turnResponse.turn.id;
  } catch (error) {
    await failTurn(state, error);
    throw error;
  }

  return state;
}

async function handleConnectionEvent(
  event: ConnectionEvent,
  state: ActiveTurnState,
  connection: CodexAppServerConnection,
  responseStore: Map<string, StoredResponseRecord>,
  handleServerRequest: CodexServerRequestHandler,
): Promise<void> {
  if (event.type === "lagged") {
    return;
  }

  if (event.type === "serverRequest") {
    const requestThreadId =
      asRecord(event.request.params)?.threadId ?? asRecord(asRecord(event.request.params)?.turn)?.threadId;
    if (requestThreadId !== state.threadId) {
      return;
    }
    try {
      const result = await handleServerRequest(event.request);
      await connection.resolveServerRequest(event.request.id, result);
    } catch (error) {
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

  switch (notification.method) {
    case "item/agentMessage/delta":
      await emitAssistantDelta(state, typeof params?.delta === "string" ? params.delta : "");
      return;
    case "rawResponseItem/completed":
      await ingestRawResponseItem(state, params?.item);
      return;
    case "turn/completed":
      state.completed = true;
      if (
        state.assistantOutputIndex !== null &&
        state.response.output[state.assistantOutputIndex] !== undefined
      ) {
        const item = state.response.output[state.assistantOutputIndex] as Record<string, unknown>;
        item.status = "completed";
      }
      await completeTurn(state, responseStore);
      return;
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
      return;
    default:
      return;
  }
}

async function emitCreatedEvent(state: ActiveTurnState): Promise<void> {
  await writeSseEvent(state, {
    type: "response.created",
    sequence_number: nextSequenceNumber(state),
    response: structuredClone(state.response),
  } satisfies OpenAiResponseStreamEvent);
}

async function emitAssistantDelta(state: ActiveTurnState, delta: string): Promise<void> {
  if (delta.length === 0) {
    return;
  }
  const { outputIndex, created } = ensureAssistantOutputItem(state);
  if (created) {
    await writeSseEvent(state, {
      type: "response.output_item.added",
      sequence_number: nextSequenceNumber(state),
      output_index: outputIndex,
      item: state.response.output[outputIndex] as Record<string, unknown>,
    } as OpenAiResponseStreamEvent);
  }
  state.assistantText += delta;
  state.response.output_text = state.assistantText;
  await writeSseEvent(state, {
    type: "response.output_text.delta",
    sequence_number: nextSequenceNumber(state),
    item_id: state.assistantItemId ?? `${state.responseId}:assistant`,
    output_index: outputIndex,
    content_index: 0,
    delta,
  } as OpenAiResponseStreamEvent);
}

async function ingestRawResponseItem(state: ActiveTurnState, itemValue: unknown): Promise<void> {
  const normalized = normalizeRawResponseItem(itemValue, state);
  if (normalized === null) {
    return;
  }

  if (normalized.kind === "assistant_message") {
    const { outputIndex } = ensureAssistantOutputItem(state);
    state.response.output[outputIndex] = normalized.item;
    state.assistantText = extractOutputText(normalized.item);
    state.response.output_text = state.assistantText;
    await writeSseEvent(state, {
      type: "response.output_item.done",
      sequence_number: nextSequenceNumber(state),
      output_index: outputIndex,
      item: normalized.item,
    } as OpenAiResponseStreamEvent);
    return;
  }

  const outputIndex = state.response.output.push(normalized.item) - 1;
  await writeSseEvent(state, {
    type: "response.output_item.added",
    sequence_number: nextSequenceNumber(state),
    output_index: outputIndex,
    item: normalized.item,
  } as OpenAiResponseStreamEvent);
  await writeSseEvent(state, {
    type: "response.output_item.done",
    sequence_number: nextSequenceNumber(state),
    output_index: outputIndex,
    item: normalized.item,
  } as OpenAiResponseStreamEvent);
}

async function completeTurn(
  state: ActiveTurnState,
  responseStore: Map<string, StoredResponseRecord>,
): Promise<void> {
  const finalResponse = finalizeSnapshot(state, state.cancelled ? "cancelled" : "completed");
  responseStore.set(state.responseId, {
    response: finalResponse,
    inputItems: state.inputItems,
    threadId: state.threadId,
    turnId: state.turnId ?? state.responseId,
    completed: true,
    cancelled: state.cancelled,
  });
  await writeSseEvent(state, {
    type: "response.completed",
    sequence_number: nextSequenceNumber(state),
    response: structuredClone(finalResponse),
  } satisfies OpenAiResponseStreamEvent);
  await closeStream(state);
  state.unsubscribe?.();
  state.resolveDone();
}

async function failTurn(state: ActiveTurnState, error: unknown): Promise<void> {
  state.response.error = {
    code: "adapter_error",
    message: formatErrorMessage(error),
  };
  await closeStream(state);
  state.unsubscribe?.();
  state.rejectDone(error);
}

function createInitialResponseSnapshot(args: {
  responseId: string;
  model: string;
  requestBody: OpenAiResponseCreateParams;
}): OpenAiResponse {
  const createdAt = unixTimestampSeconds();
  return {
    id: args.responseId,
    created_at: createdAt,
    output_text: "",
    error: null,
    incomplete_details: null,
    instructions:
      typeof args.requestBody.instructions === "string" ? args.requestBody.instructions : null,
    metadata: (args.requestBody.metadata ?? null) as Record<string, string> | null,
    model: args.model,
    object: "response",
    output: [],
    parallel_tool_calls: args.requestBody.parallel_tool_calls ?? false,
    temperature: args.requestBody.temperature ?? null,
    tool_choice: args.requestBody.tool_choice ?? "auto",
    tools: args.requestBody.tools ?? [],
    top_p: args.requestBody.top_p ?? null,
    background: args.requestBody.background ?? null,
    status: "in_progress",
    text: args.requestBody.text ?? { format: { type: "text" } },
    truncation: args.requestBody.truncation ?? "disabled",
    usage: null,
    user: args.requestBody.user ?? null,
    max_output_tokens:
      typeof args.requestBody.max_output_tokens === "number"
        ? args.requestBody.max_output_tokens
        : null,
    max_tool_calls:
      typeof args.requestBody.max_tool_calls === "number" ? args.requestBody.max_tool_calls : null,
    previous_response_id: args.requestBody.previous_response_id ?? null,
    reasoning: args.requestBody.reasoning ?? null,
    safety_identifier: args.requestBody.safety_identifier ?? null,
    service_tier: args.requestBody.service_tier ?? "auto",
  } as OpenAiResponse;
}

function finalizeSnapshot(
  state: ActiveTurnState,
  status: "completed" | "cancelled",
): OpenAiResponse {
  const snapshot = structuredClone(state.response);
  if (state.assistantOutputIndex !== null) {
    const assistantItem = asRecord(snapshot.output[state.assistantOutputIndex]);
    const content = Array.isArray(assistantItem?.content) ? assistantItem.content : [];
    const firstPart = asRecord(content[0]);
    if (
      firstPart !== null &&
      typeof firstPart.text === "string" &&
      firstPart.text.length === 0
    ) {
      firstPart.text = state.assistantText;
    }
  }
  snapshot.status = status;
  snapshot.completed_at = unixTimestampSeconds();
  snapshot.output_text = snapshot.output
    .flatMap((item) => {
      const record = asRecord(item);
      if (record?.type !== "message" || !Array.isArray(record.content)) {
        return [];
      }
      return record.content.flatMap((contentItem) => {
        const contentRecord = asRecord(contentItem);
        return contentRecord?.type === "output_text" && typeof contentRecord.text === "string"
          ? [contentRecord.text]
          : [];
      });
    })
    .join("");
  return snapshot;
}

function ensureAssistantOutputItem(state: ActiveTurnState): {
  outputIndex: number;
  created: boolean;
} {
  if (state.assistantOutputIndex !== null) {
    return {
      outputIndex: state.assistantOutputIndex,
      created: false,
    };
  }
  const itemId = `${state.responseId}:assistant`;
  state.assistantItemId = itemId;
  const item = {
    id: itemId,
    type: "message",
    role: "assistant",
    status: "in_progress",
    content: [
      {
        type: "output_text",
        text: "",
        annotations: [],
      },
    ],
  };
  const outputIndex = state.response.output.push(item as never) - 1;
  state.assistantOutputIndex = outputIndex;
  return {
    outputIndex,
    created: true,
  };
}

function normalizeRawResponseItem(
  value: unknown,
  state: ActiveTurnState,
): { kind: "assistant_message" | "other"; item: Record<string, unknown> } | null {
  const item = asRecord(value);
  if (item === null || typeof item.type !== "string") {
    return null;
  }

  switch (item.type) {
    case "message":
      return {
        kind: "assistant_message",
        item: {
          id: state.assistantItemId ?? `${state.responseId}:assistant`,
          type: "message",
          role: "assistant",
          status: "completed",
          phase: item.phase ?? null,
          content: normalizeOutputContent(item.content),
        },
      };
    case "reasoning":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:reasoning:${state.response.output.length}`,
          type: "reasoning",
          status: "completed",
          encrypted_content:
            typeof item.encrypted_content === "string" ? item.encrypted_content : null,
          summary: Array.isArray(item.summary)
            ? item.summary
                .filter((entry): entry is string => typeof entry === "string")
                .map((text) => ({ type: "summary_text", text }))
            : [],
          content: Array.isArray(item.content)
            ? item.content
                .filter((entry): entry is string => typeof entry === "string")
                .map((text) => ({ type: "reasoning_text", text }))
            : [],
        },
      };
    case "function_call":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:function:${String(item.call_id ?? state.response.output.length)}`,
          type: "function_call",
          status: "completed",
          name: item.name,
          namespace: item.namespace,
          arguments: item.arguments,
          call_id: item.call_id,
        },
      };
    case "function_call_output":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:function-output:${String(item.call_id ?? state.response.output.length)}`,
          type: "function_call_output",
          status: "completed",
          call_id: item.call_id,
          output: normalizeFunctionOutput(item.output),
        },
      };
    case "local_shell_call":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:local-shell:${String(item.call_id ?? state.response.output.length)}`,
          type: "local_shell_call",
          status: normalizeLocalShellStatus(item.status),
          call_id:
            typeof item.call_id === "string"
              ? item.call_id
              : `${state.responseId}:local-shell-call`,
          action: item.action,
        },
      };
    default:
      return null;
  }
}

function normalizeOutputContent(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (item === null) {
      return [];
    }
    if (item.type === "output_text" && typeof item.text === "string") {
      return [{ type: "output_text", text: item.text, annotations: [] }];
    }
    if (item.type === "input_text" && typeof item.text === "string") {
      return [{ type: "output_text", text: item.text, annotations: [] }];
    }
    return [];
  });
}

function normalizeFunctionOutput(value: unknown): string | Array<Record<string, unknown>> {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return JSON.stringify(value ?? null);
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (item === null) {
      return [];
    }
    if (item.type === "inputText" && typeof item.text === "string") {
      return [{ type: "input_text", text: item.text }];
    }
    return [];
  });
}

function normalizeLocalShellStatus(value: unknown): "in_progress" | "completed" | "incomplete" {
  return value === "completed" ? "completed" : value === "in_progress" ? "in_progress" : "incomplete";
}

function normalizeOpenAiInputItems(input: OpenAiResponseCreateParams["input"]): OpenAiResponseInputItem[] {
  if (typeof input === "string") {
    return [createTextInputItem(input)];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((entry) => normalizeOpenAiInputItem(entry));
}

function normalizeOpenAiInputItem(value: OpenAiResponseInputItem): OpenAiResponseInputItem[] {
  if (typeof value === "string") {
    return [createTextInputItem(value)];
  }
  const item = asRecord(value);
  if (item === null) {
    return [];
  }
  if (item.type === "message" && Array.isArray(item.content)) {
    return item.content.flatMap((entry) => {
      const content = asRecord(entry);
      if (content?.type === "input_text" && typeof content.text === "string") {
        return [createTextInputItem(content.text)];
      }
      if (content?.type === "input_image" && typeof content.image_url === "string") {
        return [
          {
            id: crypto.randomUUID(),
            type: "input_image",
            detail: content.detail ?? "auto",
            image_url: content.image_url,
          } as OpenAiResponseInputItem,
        ];
      }
      return [];
    });
  }
  if (item.type === "input_text" && typeof item.text === "string") {
    return [value];
  }
  return [];
}

function createTextInputItem(text: string): OpenAiResponseInputItem {
  return {
    id: crypto.randomUUID(),
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text,
      },
    ],
  } as OpenAiResponseInputItem;
}

function normalizeUserInput(inputItems: OpenAiResponseInputItem[]): Array<Record<string, unknown>> {
  const userInput: Array<Record<string, unknown>> = [];
  for (const item of inputItems) {
    const record = asRecord(item);
    if (record === null) {
      continue;
    }
    if (record.type === "message" && Array.isArray(record.content)) {
      for (const entry of record.content) {
        const content = asRecord(entry);
        if (content?.type === "input_text" && typeof content.text === "string") {
          userInput.push({
            type: "text",
            text: content.text,
            text_elements: [],
          });
        } else if (content?.type === "input_image" && typeof content.image_url === "string") {
          userInput.push({
            type: "image",
            url: content.image_url,
          });
        }
      }
    }
  }
  return userInput;
}

function normalizeInstructions(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function normalizeOutputSchema(requestBody: OpenAiResponseCreateParams): JsonValue | null {
  const text = asRecord(requestBody.text);
  const format = asRecord(text?.format);
  if (format?.type !== "json_schema") {
    return null;
  }
  return (format.schema ?? null) as JsonValue | null;
}

function assertSupportedRequest(requestBody: OpenAiResponseCreateParams): void {
  if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
    throw new Error("Responses tools are not supported by the Codex adapter yet.");
  }
  const instructions = requestBody.instructions;
  if (Array.isArray(instructions)) {
    throw new Error("Array-based responses instructions are not supported yet.");
  }
}

async function writeSseEvent(
  state: ActiveTurnState,
  event: OpenAiResponseStreamEvent,
): Promise<void> {
  if (state.streamWriter === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  state.writeChain = state.writeChain.then(async () => {
    if (state.streamWriter === undefined) {
      return;
    }
    await state.streamWriter.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  });
  await state.writeChain;
}

async function closeStream(state: ActiveTurnState): Promise<void> {
  if (state.streamWriter === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  state.writeChain = state.writeChain.then(async () => {
    if (state.streamWriter === undefined) {
      return;
    }
    await state.streamWriter.write(encoder.encode("data: [DONE]\n\n"));
    await state.streamWriter.close();
  });
  await state.writeChain;
  state.streamWriter = undefined;
}

function nextSequenceNumber(state: ActiveTurnState): number {
  const value = state.sequenceNumber;
  state.sequenceNumber += 1;
  return value;
}

function extractOutputText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((entry) => {
      const record = asRecord(entry);
      return record?.type === "output_text" && typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

async function createReplayStreamResponse(response: OpenAiResponse): Promise<Response> {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const replayResponse = new Response(stream.readable, {
    status: 200,
    headers: SSE_HEADERS,
  });
  void (async () => {
    const encoder = new TextEncoder();
    let sequenceNumber = 0;
    const write = async (event: OpenAiResponseStreamEvent) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    };

    await write({
      type: "response.created",
      sequence_number: sequenceNumber++,
      response: structuredClone(response),
    } satisfies OpenAiResponseStreamEvent);

    for (const [index, item] of response.output.entries()) {
      await write({
        type: "response.output_item.added",
        sequence_number: sequenceNumber++,
        output_index: index,
        item,
      } as OpenAiResponseStreamEvent);
      await write({
        type: "response.output_item.done",
        sequence_number: sequenceNumber++,
        output_index: index,
        item,
      } as OpenAiResponseStreamEvent);
    }

    await write({
      type: "response.completed",
      sequence_number: sequenceNumber++,
      response: structuredClone(response),
    } satisfies OpenAiResponseStreamEvent);
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
  })();

  return replayResponse;
}

async function defaultServerRequestHandler(request: ServerRequest): Promise<JsonValue> {
  switch (request.method) {
    case "item/tool/requestUserInput":
      return { answers: {} };
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: "cancel" };
    case "item/permissions/requestApproval":
      return { permissions: {}, scope: "turn" };
    case "item/tool/call":
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: "Unsupported dynamic tool call in xcodex-sdk.",
          },
        ],
      };
    case "mcpServer/elicitation/request":
      return { action: "cancel", content: null, meta: null };
    default:
      return {};
  }
}

function toRequest(input: Parameters<OpenAiFetch>[0], init: Parameters<OpenAiFetch>[1]): Request {
  return input instanceof Request ? input : new Request(String(input), init);
}

function normalizeRoute(url: URL): {
  pathname: string;
  responseId: string | null;
} {
  const rawPathname = url.pathname.replace(/\/+$/, "");
  const pathname = rawPathname.startsWith("/v1/") ? rawPathname.slice(3) : rawPathname;
  const match = pathname.match(/^\/responses\/([^/]+)(?:\/.*)?$/);
  return {
    pathname,
    responseId: match?.[1] ?? null,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

function jsonErrorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "invalid_request_error",
      },
    }),
    {
      status,
      headers: JSON_HEADERS,
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unixTimestampSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type {
  ConnectionEvent as CodexAppServerConnectionEvent,
  OpenAiFetch as CodexResponsesFetch,
};
