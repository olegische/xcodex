import OpenAI from "openai";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import {
  createXrouterBrowserClient,
  mapXrouterOutputItemToCodexResponseItem,
  prepareXrouterResponsesRequest,
  type ResponsesStreamEvent,
  type XrouterStreamEventPayload,
  runResponsesStreamingExecutor,
  runXrouterStreamingExecutor,
} from "@browser-codex/wasm-model-transport";
import { registerActiveModelRequest, unregisterActiveModelRequest } from "./activity";
import { loadXrouterRuntime } from "./assets";
import { assistantTextFromResponseItem, isCompletedEvent, isOutputItemDoneEvent } from "./transcript";
import { activeProviderApiKey, createHostError, getActiveProvider, isAbortError, normalizeHostValue } from "./utils";
import type { CodexCompatibleConfig, JsonValue, XrouterBrowserClient } from "./types";

const deltaLogState = new Map<string, { count: number; announcedStreaming: boolean; textParts: string[] }>();

export async function runResponsesApiTurn(params: {
  requestId: string;
  baseUrl: string;
  apiKey: string;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  transportOptions?: Record<string, unknown>;
  emitNotification?: (notification: JsonValue) => Promise<void>;
}): Promise<JsonValue> {
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  const streamState = createStreamingState(params.transportOptions);
  let notificationChain = Promise.resolve();

  try {
    await runResponsesStreamingExecutor({
      requestId: params.requestId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      requestBody: params.requestBody as OpenAI.Responses.ResponseCreateParams,
      extraHeaders: params.extraHeaders,
      onRegisterCancel(cancel, isCancelled) {
        registerActiveModelRequest({
          requestId: params.requestId,
          cancel,
        });
      },
      onUnregisterCancel() {
        unregisterActiveModelRequest(params.requestId);
      },
      onEvent(event) {
        const nextModelEvent = mapResponsesStreamEventToBrowserModelEvent(event, params.requestId);
        if (nextModelEvent !== null) {
          modelEvents.push(nextModelEvent);
        }
        notificationChain = enqueueNotifications(
          notificationChain,
          params.emitNotification,
          notificationsFromResponsesEvent(event, streamState),
        );
      },
      onDelta(outputTextDelta) {
        logStreamDelta(params.requestId, outputTextDelta);
      },
      onErrorEvent(message) {
        logStreamFailure(params.requestId, message);
      },
      onCompleted() {},
      createError(code, message) {
        return createHostError(code, message);
      },
      isAbortError,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  }
  await notificationChain;

  logStreamCompleted(params.requestId, collectAssistantTextFromModelEvents(modelEvents), {
    provider: "responses",
  });
  modelEvents.push({ type: "completed", requestId: params.requestId });
  return modelEvents;
}

export async function runXrouterTurn(params: {
  requestId: string;
  codexConfig: CodexCompatibleConfig;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  transportOptions?: Record<string, unknown>;
  emitNotification?: (notification: JsonValue) => Promise<void>;
}): Promise<JsonValue> {
  const client = await createXrouterClient(params.codexConfig);
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  let streamError: JsonValue | null = null;
  const streamState = createStreamingState(params.transportOptions);
  let notificationChain = Promise.resolve();
  const normalizedRequestBody = prepareXrouterResponsesRequest(
    params.requestBody as OpenAI.Responses.ResponseCreateParams,
  );
  const transportTools = Array.isArray(normalizedRequestBody.tools)
    ? (normalizedRequestBody.tools as unknown as JsonValue[])
    : [];
  const nonFunctionTools = transportTools
    .map((tool) => summarizeTool(tool))
    .filter((tool): tool is Record<string, unknown> => tool !== null && tool.type !== "function");
  console.info("[webui] xrouter.request-body", {
    requestId: params.requestId,
    tools: summarizeToolCollection(normalizedRequestBody.tools),
    toolNames: extractToolNames(normalizedRequestBody.tools),
    toolChoice: normalizedRequestBody.tool_choice ?? null,
    input: summarizeResponsesInput(normalizedRequestBody.input as JsonValue | undefined),
  });
  if (nonFunctionTools.length > 0) {
    console.warn("[webui] xrouter.request-body:non-function-tools", {
      requestId: params.requestId,
      count: nonFunctionTools.length,
      types: nonFunctionTools.map((tool) => tool.type ?? "unknown"),
    });
  }
  try {
    await runXrouterStreamingExecutor({
      requestId: params.requestId,
      requestBody: normalizedRequestBody,
      client,
      onRegisterCancel(cancel) {
        registerActiveModelRequest({
          requestId: params.requestId,
          cancel,
        });
      },
      onUnregisterCancel() {
        unregisterActiveModelRequest(params.requestId);
      },
      onEvent(payload) {
        const nextModelEvents = mapXrouterEventToBrowserModelEvents(payload, params.requestId, streamState);
        modelEvents.push(...nextModelEvents);
        notificationChain = enqueueNotifications(
          notificationChain,
          params.emitNotification,
          notificationsFromXrouterEvent(payload, streamState),
        );
      },
      onDelta(delta) {
        logStreamDelta(params.requestId, delta);
      },
      onCompleted(payload) {
        const outputItems = Array.isArray(payload.output) ? (payload.output as JsonValue[]) : [];
        const normalizedOutputItems = outputItems
          .map((item) => mapXrouterOutputItemToCodexResponseItem(item, streamState.assistantItemId))
          .filter((item): item is JsonValue => item !== null);

        for (const item of normalizedOutputItems) {
          modelEvents.push({ type: "outputItemDone", requestId: params.requestId, item });
        }
        if (!modelEvents.some((event) => isOutputItemDoneEvent(event, params.requestId))) {
          modelEvents.push({
            type: "outputItemDone",
            requestId: params.requestId,
            item: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "" }],
              end_turn: true,
            },
          });
        }
        notificationChain = enqueueNotifications(
          notificationChain,
          params.emitNotification,
          notificationsFromCompletedItems(normalizedOutputItems, streamState),
        );
        logStreamCompleted(params.requestId, collectAssistantTextFromItems(normalizedOutputItems), {
          provider: "xrouter",
          finishReason: typeof payload.finish_reason === "string" ? payload.finish_reason : null,
        });
        modelEvents.push({ type: "completed", requestId: params.requestId });
      },
      onErrorEvent(message) {
        streamError = createHostError("unavailable", message);
        logStreamFailure(params.requestId, message);
      },
      createError(code, message) {
        return createHostError(code, message);
      },
      normalizeHostValue,
      isAbortError,
    });
  } catch (error) {
    if (isAbortError(error)) {
      logStreamFailure(params.requestId, "model turn cancelled");
      throw createHostError("cancelled", "model turn cancelled");
    }
    logStreamFailure(params.requestId, formatUnknownError(error));
    throw error;
  }

  if (streamError !== null) {
    throw streamError;
  }
  await notificationChain;
  if (!modelEvents.some((event) => isCompletedEvent(event, params.requestId))) {
    logStreamCompleted(params.requestId, collectAssistantTextFromModelEvents(modelEvents), {
      provider: "xrouter",
      completedEvent: false,
    });
    modelEvents.push({ type: "completed", requestId: params.requestId });
  }
  return modelEvents;
}

type StreamingState = {
  threadId: string | null;
  turnId: string | null;
  assistantItemId: string;
  reasoningItemId: string;
  assistantStarted: boolean;
  reasoningStarted: boolean;
  assistantModelStarted: boolean;
};

type CanonicalStreamThreadItem =
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: null;
    }
  | {
      type: "reasoning";
      id: string;
      summary: string[];
      content: string[];
    };

function createStreamingState(transportOptions: Record<string, unknown> | undefined): StreamingState {
  const options =
    transportOptions !== undefined && transportOptions !== null ? transportOptions : {};
  const threadId =
    typeof options.conversationId === "string"
      ? options.conversationId
      : typeof options.threadId === "string"
        ? options.threadId
        : null;
  const turnId = typeof options.turnId === "string" ? options.turnId : null;
  const assistantItemId =
    typeof options.assistantItemId === "string" ? options.assistantItemId : `${turnId ?? "turn"}:assistant`;
  const reasoningItemId =
    typeof options.reasoningItemId === "string" ? options.reasoningItemId : `${turnId ?? "turn"}:reasoning`;
  return {
    threadId,
    turnId,
    assistantItemId,
    reasoningItemId,
    assistantStarted: false,
    reasoningStarted: false,
    assistantModelStarted: false,
  };
}

function mapResponsesStreamEventToBrowserModelEvent(
  event: ResponsesStreamEvent,
  requestId: string,
): JsonValue | null {
  if (event.type === "response.output_item.added" && isJsonRecord(event.item)) {
    return {
      type: "outputItemAdded",
      requestId,
      item: event.item as JsonValue,
    };
  }
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return {
      type: "delta",
      requestId,
      payload: { outputTextDelta: event.delta },
    };
  }
  if (event.type === "response.output_item.done" && isJsonRecord(event.item)) {
    return {
      type: "outputItemDone",
      requestId,
      item: event.item as JsonValue,
    };
  }
  if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
    return {
      type: "reasoningSummaryDelta",
      requestId,
      payload: {
        delta: event.delta,
        index: typeof event.summary_index === "number" ? event.summary_index : 0,
      },
    };
  }
  if (event.type === "response.reasoning_text.delta" && typeof event.delta === "string") {
    return {
      type: "reasoningContentDelta",
      requestId,
      payload: {
        delta: event.delta,
        index: typeof event.content_index === "number" ? event.content_index : 0,
      },
    };
  }
  if (event.type === "response.reasoning_summary_part.added") {
    return {
      type: "reasoningSummaryPartAdded",
      requestId,
      payload: {
        index: typeof event.summary_index === "number" ? event.summary_index : 0,
      },
    };
  }
  return null;
}

function notificationsFromResponsesEvent(
  event: ResponsesStreamEvent,
  state: StreamingState,
): ServerNotification[] {
  const base = notificationScope(state);
  if (base === null) {
    return [];
  }
  if (event.type === "response.output_item.added" && isJsonRecord(event.item)) {
    return notificationsFromOutputItemAdded(event.item as Record<string, unknown>, state, base);
  }
  if (event.type === "response.output_item.done" && isJsonRecord(event.item)) {
    return notificationsFromOutputItemDone(event.item as Record<string, unknown>, state, base);
  }
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return [
      ...ensureAssistantStarted(state, base),
      {
        method: "item/agentMessage/delta",
        params: {
          ...base,
          itemId: state.assistantItemId,
          delta: event.delta,
        },
      },
    ];
  }
  if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
    return [
      ...ensureReasoningStarted(state, base),
      {
        method: "item/reasoning/summaryTextDelta",
        params: {
          ...base,
          itemId: state.reasoningItemId,
          delta: event.delta,
          summaryIndex: typeof event.summary_index === "number" ? event.summary_index : 0,
        },
      },
    ];
  }
  if (event.type === "response.reasoning_text.delta" && typeof event.delta === "string") {
    return [
      ...ensureReasoningStarted(state, base),
      {
        method: "item/reasoning/textDelta",
        params: {
          ...base,
          itemId: state.reasoningItemId,
          delta: event.delta,
          contentIndex: typeof event.content_index === "number" ? event.content_index : 0,
        },
      },
    ];
  }
  if (event.type === "response.reasoning_summary_part.added") {
    return [
      ...ensureReasoningStarted(state, base),
      {
        method: "item/reasoning/summaryPartAdded",
        params: {
          ...base,
          itemId: state.reasoningItemId,
          summaryIndex: typeof event.summary_index === "number" ? event.summary_index : 0,
        },
      },
    ];
  }
  return [];
}

function mapXrouterEventToBrowserModelEvents(
  payload: XrouterStreamEventPayload,
  requestId: string,
  state: StreamingState,
): JsonValue[] {
  if (payload.type === "output_text_delta" && typeof payload.delta === "string") {
    return [
      ...assistantStartedModelEvents(requestId, state),
      {
        type: "delta",
        requestId,
        payload: { outputTextDelta: payload.delta },
      },
    ];
  }
  return [];
}

function notificationsFromXrouterEvent(
  payload: XrouterStreamEventPayload,
  state: StreamingState,
): ServerNotification[] {
  const base = notificationScope(state);
  if (base === null) {
    return [];
  }
  if (payload.type === "output_text_delta" && typeof payload.delta === "string") {
    return [
      ...ensureAssistantStarted(state, base),
      {
        method: "item/agentMessage/delta",
        params: {
          ...base,
          itemId: state.assistantItemId,
          delta: payload.delta,
        },
      },
    ];
  }
  return [];
}

function notificationsFromCompletedItems(
  items: JsonValue[],
  state: StreamingState,
): ServerNotification[] {
  const base = notificationScope(state);
  if (base === null) {
    return [];
  }
  return items.flatMap((item) => {
    if (!isJsonRecord(item)) {
      return [];
    }
    return notificationsFromOutputItemDone(item, state, base);
  });
}

function notificationsFromOutputItemAdded(
  item: Record<string, unknown>,
  state: StreamingState,
  base: { threadId: string; turnId: string },
): ServerNotification[] {
  const threadItem = threadItemFromResponseItem(item, state);
  if (threadItem === null) {
    return [];
  }
  if (threadItem.type === "agentMessage") {
    state.assistantStarted = true;
  } else if (threadItem.type === "reasoning") {
    state.reasoningStarted = true;
  }
  return [
    {
      method: "item/started",
      params: {
        ...base,
        item: threadItem,
      },
    },
  ];
}

function notificationsFromOutputItemDone(
  item: Record<string, unknown>,
  state: StreamingState,
  base: { threadId: string; turnId: string },
): ServerNotification[] {
  const threadItem = threadItemFromResponseItem(item, state);
  if (threadItem === null) {
    return [];
  }
  if (threadItem.type === "agentMessage") {
    state.assistantStarted = true;
  } else if (threadItem.type === "reasoning") {
    state.reasoningStarted = true;
  }
  return [
    {
      method: "item/completed",
      params: {
        ...base,
        item: threadItem,
      },
    },
  ];
}

function threadItemFromResponseItem(
  item: Record<string, unknown>,
  state: StreamingState,
): CanonicalStreamThreadItem | null {
  if (item.type === "message") {
    return {
      type: "agentMessage",
      id: typeof item.id === "string" ? item.id : state.assistantItemId,
      text: assistantTextFromResponseItem(item) ?? "",
      phase: null,
    };
  }
  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.flatMap((entry) =>
          isJsonRecord(entry) && typeof entry.text === "string" ? [entry.text] : [],
        )
      : [];
    const content = Array.isArray(item.content)
      ? item.content.flatMap((entry) =>
          isJsonRecord(entry) && typeof entry.text === "string" ? [entry.text] : [],
        )
      : [];
    return {
      type: "reasoning",
      id: typeof item.id === "string" ? item.id : state.reasoningItemId,
      summary,
      content,
    };
  }
  return null;
}

function notificationScope(
  state: StreamingState,
): { threadId: string; turnId: string } | null {
  if (state.threadId === null || state.turnId === null) {
    return null;
  }
  return {
    threadId: state.threadId,
    turnId: state.turnId,
  };
}

function ensureAssistantStarted(
  state: StreamingState,
  base: { threadId: string; turnId: string },
): ServerNotification[] {
  if (state.assistantStarted) {
    return [];
  }
  state.assistantStarted = true;
  return [
    {
      method: "item/started",
      params: {
        ...base,
        item: {
          type: "agentMessage",
          id: state.assistantItemId,
          text: "",
          phase: null,
        },
      },
    },
  ];
}

function ensureReasoningStarted(
  state: StreamingState,
  base: { threadId: string; turnId: string },
): ServerNotification[] {
  if (state.reasoningStarted) {
    return [];
  }
  state.reasoningStarted = true;
  return [
    {
      method: "item/started",
      params: {
        ...base,
        item: {
          type: "reasoning",
          id: state.reasoningItemId,
          summary: [],
          content: [],
        },
      },
    },
  ];
}

function assistantStartedModelEvents(requestId: string, state: StreamingState): JsonValue[] {
  if (state.assistantModelStarted) {
    return [];
  }
  state.assistantModelStarted = true;
  return [
    {
      type: "outputItemAdded",
      requestId,
      item: {
        type: "message",
        id: state.assistantItemId,
        role: "assistant",
        content: [{ type: "output_text", text: "" }],
        end_turn: false,
      },
    },
  ];
}

function enqueueNotifications(
  chain: Promise<void>,
  emitNotification: ((notification: JsonValue) => Promise<void>) | undefined,
  notifications: ServerNotification[],
): Promise<void> {
  if (emitNotification === undefined || notifications.length === 0) {
    return chain;
  }
  return chain.then(async () => {
    for (const notification of notifications) {
      await emitNotification(notification as JsonValue);
    }
  });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function logStreamDelta(requestId: string, text: string) {
  const state = deltaLogState.get(requestId) ?? {
    count: 0,
    announcedStreaming: false,
    textParts: [],
  };
  state.count += 1;
  state.textParts.push(text);
  if (state.count <= 5) {
    console.info("[webui] runtime-delta", {
      requestId,
      chunk: state.count,
      textLength: text.length,
    });
  } else if (!state.announcedStreaming) {
    state.announcedStreaming = true;
    console.info("[webui] runtime-delta", {
      requestId,
      status: "waiting-for-complete-response",
      chunksSeen: state.count,
    });
  }
  deltaLogState.set(requestId, state);
}

function logStreamCompleted(
  requestId: string,
  finalText: string | null,
  extra: Record<string, unknown>,
) {
  const state = deltaLogState.get(requestId);
  console.info("[webui] runtime-delta", {
    requestId,
    status: "response-received",
    chunksSeen: state?.count ?? 0,
  });
  console.info("[webui] runtime-response", {
    requestId,
    ...extra,
    finalTextLength: finalText?.length ?? 0,
  });
  deltaLogState.delete(requestId);
}

function logStreamFailure(requestId: string, message: string) {
  const state = deltaLogState.get(requestId);
  const partialText = state?.textParts.join("") ?? "";
  console.warn("[webui] runtime-response:error", {
    requestId,
    message,
    chunksSeen: state?.count ?? 0,
    partialTextLength: partialText.length,
  });
  deltaLogState.delete(requestId);
}

function collectAssistantTextFromModelEvents(modelEvents: JsonValue[]): string | null {
  return collectAssistantTextFromItems(
    modelEvents.flatMap((event) => {
      if (
        event !== null &&
        typeof event === "object" &&
        !Array.isArray(event) &&
        event.type === "outputItemDone" &&
        "item" in event
      ) {
        return [event.item as JsonValue];
      }
      return [];
    }),
  );
}

function collectAssistantTextFromItems(items: JsonValue[]): string | null {
  const parts = items.flatMap((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const text = assistantTextFromResponseItem(item as Record<string, unknown>);
    return text === null ? [] : [text];
  });
  if (parts.length > 0) {
    return parts.join("\n\n");
  }
  return null;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function createXrouterClient(codexConfig: CodexCompatibleConfig): Promise<XrouterBrowserClient> {
  const runtime = await loadXrouterRuntime();
  const provider = getActiveProvider(codexConfig);
  return createXrouterBrowserClient({
    runtime,
    provider,
    apiKey: activeProviderApiKey(codexConfig),
  });
}

function normalizeToolSearchOutputToolsForXrouter(tools: unknown): JsonValue[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.flatMap((tool) => {
    if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }

    const record = tool as Record<string, unknown>;
    if (
      record.type === "namespace" &&
      typeof record.name === "string" &&
      Array.isArray(record.tools)
    ) {
      const namespace = record.name;
      return [
        {
          ...record,
          tools: record.tools.flatMap((child) => {
            if (child === null || typeof child !== "object" || Array.isArray(child)) {
              return [];
            }
            const childRecord = child as Record<string, unknown>;
            if (typeof childRecord.name !== "string") {
              return [];
            }
            const qualifiedName = qualifyDiscoveredToolName(namespace, childRecord.name);
            return [
              {
                ...childRecord,
                name: qualifiedName,
              },
            ];
          }),
        } satisfies Record<string, unknown>,
      ];
    }

    return [record as JsonValue];
  });
}

function qualifyDiscoveredToolName(namespace: string, toolName: string): string {
  if (namespace === "browser") {
    return toolName.startsWith("browser__") ? toolName : `browser__${toolName}`;
  }
  if (namespace.startsWith("mcp__")) {
    return toolName.startsWith(namespace) ? toolName : `${namespace}${toolName}`;
  }
  return `${namespace}${toolName}`;
}

function summarizeToolCollection(tools: unknown): Array<Record<string, unknown> | null> | null {
  if (!Array.isArray(tools)) {
    return null;
  }
  return tools.map((tool) => summarizeTool(tool as JsonValue));
}

function summarizeTool(tool: JsonValue): Record<string, unknown> | null {
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
    return null;
  }
  const record = tool as Record<string, unknown>;
  return {
    type: typeof record.type === "string" ? record.type : null,
    name:
      typeof record.name === "string"
        ? record.name
        : record.function !== null &&
            typeof record.function === "object" &&
            !Array.isArray(record.function) &&
            typeof (record.function as Record<string, unknown>).name === "string"
          ? ((record.function as Record<string, unknown>).name as string)
          : null,
    execution: typeof record.execution === "string" ? record.execution : null,
    raw: record,
  };
}

function extractToolNames(tools: unknown): string[] | null {
  if (!Array.isArray(tools)) {
    return null;
  }
  return tools.flatMap((tool) => {
    if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }
    const record = tool as Record<string, unknown>;
    if (typeof record.name === "string") {
      return [record.name];
    }
    if (record.type === "namespace" && typeof record.name === "string") {
      const childTools = Array.isArray(record.tools) ? record.tools : [];
      return childTools.flatMap((child) => {
        if (child === null || typeof child !== "object" || Array.isArray(child)) {
          return [];
        }
        const childRecord = child as Record<string, unknown>;
        return typeof childRecord.name === "string" ? [`${record.name}.${childRecord.name}`] : [];
      });
    }
    if (
      record.function !== null &&
      typeof record.function === "object" &&
      !Array.isArray(record.function) &&
      typeof (record.function as Record<string, unknown>).name === "string"
    ) {
      return [(record.function as Record<string, unknown>).name as string];
    }
    return [];
  });
}

function summarizeResponsesInput(
  input: JsonValue | undefined,
): Record<string, unknown> | string | null {
  if (typeof input === "string") {
    return input;
  }
  if (!Array.isArray(input)) {
    return null;
  }
  return {
    itemTypes: input.flatMap((item) =>
      item !== null && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).type === "string"
        ? [(item as Record<string, unknown>).type as string]
        : ["<invalid>"],
    ),
    items: input.map((item) => summarizeInputItem(item as JsonValue)),
  };
}

function summarizeInputItem(item: JsonValue): Record<string, unknown> | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  return {
    type: typeof record.type === "string" ? record.type : null,
    role: typeof record.role === "string" ? record.role : null,
    name: typeof record.name === "string" ? record.name : null,
    namespace: typeof record.namespace === "string" ? record.namespace : null,
    callId: typeof record.call_id === "string" ? record.call_id : null,
    execution: typeof record.execution === "string" ? record.execution : null,
    contentType: Array.isArray(record.content) ? "parts" : typeof record.content,
    outputType: Array.isArray(record.output) ? "parts" : typeof record.output,
    toolsCount: Array.isArray(record.tools) ? record.tools.length : null,
    argumentsType: typeof record.arguments,
    raw: record,
  };
}

function readSseData(segment: string): string | null {
  const dataLines = segment
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
}
