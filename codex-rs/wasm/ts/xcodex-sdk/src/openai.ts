import OpenAI from "openai";
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
  jsonErrorResponse,
  jsonResponse,
  SSE_HEADERS,
  toRequest,
} from "./shared.ts";
import {
  type ActiveTurnState,
  assertSupportedRequest,
  closeStream,
  createInitialResponseSnapshot,
  createReplayStreamResponse,
  ensureAssistantOutputItem,
  extractOutputText,
  finalizeSnapshot,
  type OpenAiClientOptions,
  type OpenAiFetch,
  type OpenAiResponse,
  type OpenAiResponseCreateParams,
  type OpenAiResponseInputItem,
  type OpenAiResponseStreamEvent,
  normalizeInstructions,
  normalizeOpenAiInputItems,
  normalizeOutputSchema,
  normalizeRawResponseItem,
  normalizeRoute,
  normalizeUserInput,
  nextSequenceNumber,
  writeSseEvent,
} from "./openai-support.ts";

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

      if (
        request.method === "GET" &&
        route.responseId !== null &&
        route.pathname === `/responses/${route.responseId}`
      ) {
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

      if (
        request.method === "DELETE" &&
        route.responseId !== null &&
        route.pathname === `/responses/${route.responseId}`
      ) {
        responseStore.delete(route.responseId);
        return new Response(null, { status: 200 });
      }
    } catch (error) {
      return jsonErrorResponse(500, formatErrorMessage(error));
    }

    return jsonErrorResponse(404, `Unsupported adapter route: ${request.method} ${url.pathname}`);
  };
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

  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const state: ActiveTurnState = {
    responseId: crypto.randomUUID(),
    threadId,
    turnId: null,
    requestBody: args.requestBody,
    inputItems,
    response: createInitialResponseSnapshot({
      responseId: crypto.randomUUID(),
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
  state.response.id = state.responseId;

  state.unsubscribe = args.connection.subscribe((event) => {
    void handleConnectionEvent(
      event,
      state,
      args.connection,
      args.responseStore,
      args.handleServerRequest,
    );
  });

  args.activeTurns.set(state.responseId, state);
  await emitCreatedEvent(state);

  try {
    const turnResponse = (await args.connection.request({
      id: `turn:start:${state.responseId}`,
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
  event: CodexAppServerConnectionEvent,
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
      asRecord(event.request.params)?.threadId ??
      asRecord(asRecord(event.request.params)?.turn)?.threadId;
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
  state.resolveDone?.();
}

async function failTurn(state: ActiveTurnState, error: unknown): Promise<void> {
  state.response.error = {
    code: "adapter_error",
    message: formatErrorMessage(error),
  };
  await closeStream(state);
  state.unsubscribe?.();
  state.rejectDone?.(error);
}

export type {
  OpenAiFetch as CodexResponsesFetch,
};
