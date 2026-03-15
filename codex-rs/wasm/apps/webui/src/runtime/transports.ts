import OpenAI from "openai";
import { emitRuntimeActivity, registerActiveModelRequest, unregisterActiveModelRequest } from "./activity";
import { loadXrouterRuntime } from "./assets";
import { assistantTextFromResponseItem, isCompletedEvent, isOutputItemDoneEvent } from "./transcript";
import { activeProviderApiKey, createHostError, getActiveProvider, isAbortError, modelIdToDisplayName, normalizeDiscoveredModels, normalizeHostValue } from "./utils";
import type { CodexCompatibleConfig, JsonValue, ModelPreset, XrouterBrowserClient } from "./types";

const deltaLogState = new Map<string, { count: number; announcedStreaming: boolean; textParts: string[] }>();

export async function discoverProviderModels(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  const response = await sendJsonRequestWithFallback({
    urls: candidateApiUrls(provider.baseUrl, "models"),
    method: "GET",
    apiKey: activeProviderApiKey(codexConfig),
    fallbackMessage: "failed to list models",
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    data: normalizeDiscoveredModels(payload, provider.providerKind === "openai"),
    nextCursor: null,
  };
}

export async function discoverRouterModels(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  console.info("[webui] xrouter.discover-models:start", {
    provider: provider.metadata?.xrouterProvider ?? "deepseek",
    baseUrl: provider.baseUrl,
    hasApiKey: activeProviderApiKey(codexConfig).length > 0,
  });
  const client = await createXrouterClient(codexConfig);
  const modelIds = normalizeHostValue(await client.fetchModelIds());
  console.info("[webui] xrouter.discover-models:done", modelIds);
  if (!Array.isArray(modelIds)) {
    throw new Error("xrouter-browser returned an invalid model id list");
  }
  return {
    data: modelIds
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((id, index) => ({
        id,
        displayName: modelIdToDisplayName(id),
        description: provider.name,
        isDefault: index === 0,
        showInPicker: true,
        supportsApi: true,
      })),
    nextCursor: null,
  };
}

export async function runResponsesApiTurn(params: {
  requestId: string;
  baseUrl: string;
  apiKey: string;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
}): Promise<JsonValue> {
  const abortController = new AbortController();
  let cancelled = false;
  registerActiveModelRequest({
    kind: "responses",
    requestId: params.requestId,
    cancel: () => {
      cancelled = true;
      abortController.abort();
    },
    isCancelled: () => cancelled,
  });
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];

  try {
    // The official OpenAI SDK is the source of truth for the Responses API wire contract.
    // The browser host should forward the request body as-is instead of remapping it locally.
    const client = new OpenAI({
      apiKey: params.apiKey,
      baseURL: firstResponsesApiUrl(params.baseUrl),
      defaultHeaders: params.extraHeaders ?? undefined,
      dangerouslyAllowBrowser: true,
    });

    const stream = await client.responses.create(params.requestBody as never, {
      signal: abortController.signal,
    });

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const outputTextDelta = extractOutputTextDelta(event);
      if (outputTextDelta !== null) {
        logStreamDelta(params.requestId, outputTextDelta);
        emitRuntimeActivity({ type: "delta", requestId: params.requestId, text: outputTextDelta });
        modelEvents.push({
          type: "delta",
          requestId: params.requestId,
          payload: { outputTextDelta },
        });
      }
      const outputItem = extractOutputItemDone(event);
      if (outputItem !== null) {
        modelEvents.push({ type: "outputItemDone", requestId: params.requestId, item: outputItem });
      }
      if (event.type === "error") {
        logStreamFailure(params.requestId, extractOpenAiEventMessage(event));
        emitRuntimeActivity({
          type: "error",
          requestId: params.requestId,
          message: extractOpenAiEventMessage(event),
        });
        throw createHostError("openaiError", extractOpenAiEventMessage(event));
      }
      if (event.type === "response.completed") {
        break;
      }
      if (cancelled) {
        throw createHostError("cancelled", "model turn cancelled");
      }
    }
  } catch (error) {
    if (cancelled || isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  } finally {
    unregisterActiveModelRequest(params.requestId);
  }

  logStreamCompleted(params.requestId, collectAssistantTextFromModelEvents(modelEvents), {
    provider: "responses",
  });
  modelEvents.push({ type: "completed", requestId: params.requestId });
  emitRuntimeActivity({ type: "completed", requestId: params.requestId, finishReason: null });
  return modelEvents;
}

export async function runXrouterTurn(params: {
  requestId: string;
  codexConfig: CodexCompatibleConfig;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  responseInputItems: JsonValue[] | null;
}): Promise<JsonValue> {
  const client = await createXrouterClient(params.codexConfig);
  let cancelled = false;
  registerActiveModelRequest({
    kind: "xrouter",
    requestId: params.requestId,
    cancel: () => {
      cancelled = true;
      client.cancel(params.requestId);
    },
    isCancelled: () => cancelled,
  });

  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  let streamError: JsonValue | null = null;
  const normalizedRequestBody = buildXrouterRequestBody(
    params.requestBody,
    params.responseInputItems,
  );
  const transportTools = Array.isArray(normalizedRequestBody.tools)
    ? (normalizedRequestBody.tools as JsonValue[])
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
  console.info(
    "[webui] xrouter.request-body:json",
    JSON.stringify(
      {
        requestId: params.requestId,
        body: normalizedRequestBody,
      },
      null,
      2,
    ),
  );
  if (nonFunctionTools.length > 0) {
    console.warn("[webui] xrouter.request-body:non-function-tools", {
      requestId: params.requestId,
      tools: nonFunctionTools,
    });
  }
  try {
    await client.runResponsesStream(params.requestId, normalizedRequestBody, (event: unknown) => {
      if (cancelled) {
        return;
      }
      const normalizedEvent = normalizeHostValue(event);
      const payload =
        normalizedEvent !== null && typeof normalizedEvent === "object"
          ? (normalizedEvent as Record<string, unknown>)
          : null;
      if (payload === null || typeof payload.type !== "string") {
        return;
      }

      if (payload.type === "output_text_delta" && typeof payload.delta === "string") {
        logStreamDelta(params.requestId, payload.delta);
        emitRuntimeActivity({ type: "delta", requestId: params.requestId, text: payload.delta });
        modelEvents.push({
          type: "delta",
          requestId: params.requestId,
          payload: { outputTextDelta: payload.delta },
        });
        return;
      }

      if (payload.type === "response_completed") {
        const outputItems = Array.isArray(payload.output) ? (payload.output as JsonValue[]) : [];
        const normalizedOutputItems = outputItems
          .map((item) => mapXrouterOutputItemToCodexResponseItem(item))
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
        emitRuntimeActivity({
          type: "completed",
          requestId: params.requestId,
          finishReason: typeof payload.finish_reason === "string" ? payload.finish_reason : null,
        });
        logStreamCompleted(
          params.requestId,
          collectAssistantTextFromItems(normalizedOutputItems),
          {
            provider: "xrouter",
            finishReason: typeof payload.finish_reason === "string" ? payload.finish_reason : null,
          },
        );
        modelEvents.push({ type: "completed", requestId: params.requestId });
        return;
      }

      if (payload.type === "response_error") {
        emitRuntimeActivity({
          type: "error",
          requestId: params.requestId,
          message: typeof payload.message === "string" ? payload.message : "xrouter request failed",
        });
        streamError = createHostError(
          "unavailable",
          typeof payload.message === "string" ? payload.message : "xrouter request failed",
        );
        logStreamFailure(
          params.requestId,
          typeof payload.message === "string" ? payload.message : "xrouter request failed",
        );
      }
    });
  } catch (error) {
    unregisterActiveModelRequest(params.requestId);
    if (cancelled || isAbortError(error)) {
      logStreamFailure(params.requestId, "model turn cancelled");
      throw createHostError("cancelled", "model turn cancelled");
    }
    logStreamFailure(params.requestId, formatUnknownError(error));
    throw error;
  } finally {
    unregisterActiveModelRequest(params.requestId);
  }

  if (streamError !== null) {
    throw streamError;
  }
  if (cancelled) {
    logStreamFailure(params.requestId, "model turn cancelled");
    throw createHostError("cancelled", "model turn cancelled");
  }
  if (!modelEvents.some((event) => isCompletedEvent(event, params.requestId))) {
    logStreamCompleted(params.requestId, collectAssistantTextFromModelEvents(modelEvents), {
      provider: "xrouter",
      completedEvent: false,
    });
    modelEvents.push({ type: "completed", requestId: params.requestId });
  }
  return modelEvents;
}

function firstResponsesApiUrl(baseUrl: string): string {
  return candidateApiUrls(baseUrl, "responses")[0] ?? `${baseUrl.replace(/\/+$/, "")}/responses`;
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
      text,
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
    finalText,
  });
  deltaLogState.delete(requestId);
}

function logStreamFailure(requestId: string, message: string) {
  const state = deltaLogState.get(requestId);
  console.warn("[webui] runtime-response:error", {
    requestId,
    message,
    chunksSeen: state?.count ?? 0,
    partialText: state?.textParts.join("") ?? "",
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
  return new runtime.WasmBrowserClient(
    provider.metadata?.xrouterProvider ?? "deepseek",
    provider.baseUrl.length === 0 ? null : provider.baseUrl,
    activeProviderApiKey(codexConfig).length === 0 ? null : activeProviderApiKey(codexConfig),
  );
}

function buildXrouterRequestBody(
  requestBody: Record<string, unknown>,
  responseInputItems: JsonValue[] | null,
): Record<string, unknown> {
  const normalizedInput = normalizeResponsesInputForXrouter(
    responseInputItems,
    requestBody.input as JsonValue | undefined,
  );
  const normalizedTools = Array.isArray(requestBody.tools)
    ? requestBody.tools
        .map((tool) => normalizeTransportToolForXrouter(tool as JsonValue))
        .filter((tool): tool is JsonValue => tool !== null)
    : requestBody.tools;
  return {
    ...requestBody,
    ...(normalizedInput === undefined ? {} : { input: normalizedInput }),
    ...(normalizedTools === undefined ? {} : { tools: normalizedTools }),
  };
}

function normalizeResponsesInputForXrouter(
  responseInputItems: JsonValue[] | null,
  fallbackInput: JsonValue | undefined,
): JsonValue | undefined {
  if (responseInputItems === null) {
    console.info("[webui] xrouter.normalize-input:fallback", {
      input: summarizeResponsesInput(fallbackInput),
    });
    return fallbackInput;
  }

  const normalizedItems = responseInputItems
    .map(normalizeResponseInputItemForXrouter)
    .filter((item): item is JsonValue => item !== null);
  console.info("[webui] xrouter.normalize-input", {
    before: summarizeResponsesInput(responseInputItems),
    after: summarizeResponsesInput(normalizedItems),
  });
  console.info(
    "[webui] xrouter.normalize-input:json",
    JSON.stringify(
      {
        before: responseInputItems,
        after: normalizedItems,
      },
      null,
      2,
    ),
  );
  return normalizedItems;
}

function normalizeResponseInputItemForXrouter(item: JsonValue): JsonValue | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    console.warn("[webui] xrouter.normalize-input-item:invalid", { item });
    return null;
  }

  const record = item as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  if (type === null) {
    console.warn("[webui] xrouter.normalize-input-item:missing-type", { item: record });
    return null;
  }

  if (type === "message") {
    return {
      type,
      role: typeof record.role === "string" ? record.role : "user",
      content: Array.isArray(record.content) ? record.content : [],
    };
  }

  if (type === "function_call") {
    const callId =
      typeof record.call_id === "string"
        ? record.call_id
        : typeof record.id === "string"
          ? record.id
          : null;
    if (callId === null || typeof record.name !== "string") {
      console.warn("[webui] xrouter.normalize-input-item:function-call-invalid", {
        item: record,
      });
      return null;
    }
    const normalizedItem = {
      type,
      name: record.name,
      ...(typeof record.namespace === "string" && record.namespace.length > 0
        ? { namespace: record.namespace }
        : {}),
      call_id: callId,
      arguments:
        typeof record.arguments === "string"
          ? record.arguments
          : record.arguments !== undefined
            ? JSON.stringify(record.arguments)
            : "{}",
    };
    console.info("[webui] xrouter.normalize-input-item:function-call", {
      before: summarizeInputItem(item),
      after: summarizeInputItem(normalizedItem),
    });
    return normalizedItem;
  }

  if (type === "function_call_output") {
    const callId = typeof record.call_id === "string" ? record.call_id : null;
    if (callId === null || !("output" in record)) {
      console.warn("[webui] xrouter.normalize-input-item:function-call-output-invalid", {
        item: record,
      });
      return null;
    }
    const normalizedItem = {
      type,
      call_id: callId,
      output:
        typeof record.output === "string"
          ? record.output
          : record.output !== undefined
            ? JSON.stringify(record.output)
            : "",
    };
    console.info("[webui] xrouter.normalize-input-item:function-call-output", {
      before: summarizeInputItem(item),
      after: summarizeInputItem(normalizedItem),
      outputPreview:
        typeof normalizedItem.output === "string"
          ? normalizedItem.output.slice(0, 400)
          : normalizedItem.output,
    });
    return normalizedItem;
  }

  if (type === "tool_search_call") {
    const callId = typeof record.call_id === "string" ? record.call_id : null;
    if (callId === null) {
      console.warn("[webui] xrouter.normalize-input-item:tool-search-call-invalid", {
        item: record,
      });
      return null;
    }
    const normalizedItem = {
      type: "function_call",
      name: "tool_search",
      call_id: callId,
      arguments:
        record.arguments !== undefined
          ? JSON.stringify(record.arguments)
          : "{}",
    };
    console.info("[webui] xrouter.normalize-input-item:tool-search-call", {
      before: summarizeInputItem(item),
      after: summarizeInputItem(normalizedItem),
    });
    return normalizedItem;
  }

  if (type === "tool_search_output") {
    const callId = typeof record.call_id === "string" ? record.call_id : null;
    if (callId === null) {
      console.warn("[webui] xrouter.normalize-input-item:tool-search-output-invalid", {
        item: record,
      });
      return null;
    }
    const normalizedTools = normalizeToolSearchOutputToolsForXrouter(record.tools);
    const normalizedItem = {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        status: typeof record.status === "string" ? record.status : "completed",
        execution: typeof record.execution === "string" ? record.execution : "client",
        calling_convention:
          "Call discovered tools using the exact `name` field shown for each tool. Do not reconstruct tool names from parent groups.",
        tools: normalizedTools,
      }),
    };
    console.info("[webui] xrouter.normalize-input-item:tool-search-output", {
      before: summarizeInputItem(item),
      after: summarizeInputItem(normalizedItem),
      tools: normalizedTools,
    });
    return normalizedItem;
  }

  console.info("[webui] xrouter.normalize-input-item:passthrough", {
    item: summarizeInputItem(item),
  });
  return item;
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

function normalizeTransportToolForXrouter(tool: JsonValue): JsonValue | null {
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
    return null;
  }

  const record = tool as Record<string, unknown>;
  if (record.type !== "tool_search") {
    return tool;
  }

  return {
    type: "function",
    name: "tool_search",
    description: typeof record.description === "string" ? record.description : "",
    parameters:
      record.parameters !== undefined && record.parameters !== null
        ? record.parameters
        : {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
  };
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

function mapXrouterOutputItemToCodexResponseItem(item: JsonValue): JsonValue | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (record.type === "message") {
    return {
      type: "message",
      role: typeof record.role === "string" ? record.role : "assistant",
      content: Array.isArray(record.content) ? (record.content as JsonValue[]) : [],
      end_turn: true,
    };
  }
  if (record.type === "function_call" && typeof record.name === "string") {
    const callId =
      typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : null;
    if (callId === null) {
      return null;
    }
    if (record.name === "tool_search") {
      return {
        type: "tool_search_call",
        id: typeof record.id === "string" ? record.id : undefined,
        call_id: callId,
        execution: "client",
        arguments:
          typeof record.arguments === "string"
            ? JSON.parse(record.arguments)
            : record.arguments ?? {},
      };
    }
    return {
      type: "function_call",
      id: typeof record.id === "string" ? record.id : undefined,
      call_id: callId,
      ...(typeof record.namespace === "string" && record.namespace.length > 0
        ? { name: record.name, namespace: record.namespace }
        : splitQualifiedToolNameForCodex(record.name)),
      arguments:
        typeof record.arguments === "string"
          ? record.arguments
          : record.arguments !== undefined
            ? JSON.stringify(record.arguments)
            : "{}",
    };
  }
  return null;
}

function splitQualifiedToolNameForCodex(name: string): {
  name: string;
  namespace?: string;
} {
  if (name.startsWith("browser__")) {
    return {
      name: name.slice("browser__".length),
      namespace: "browser",
    };
  }
  if (name.startsWith("mcp__")) {
    const stripped = name.slice("mcp__".length);
    const separatorIndex = stripped.indexOf("__");
    if (separatorIndex !== -1) {
      const serverName = stripped.slice(0, separatorIndex);
      return {
        name: stripped.slice(separatorIndex + "__".length),
        namespace: `mcp__${serverName}__`,
      };
    }
  }
  return { name };
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

function extractOutputTextDelta(eventPayload: Record<string, unknown>): string | null {
  return eventPayload.type === "response.output_text.delta" && typeof eventPayload.delta === "string"
    ? eventPayload.delta
    : null;
}

function extractOutputItemDone(eventPayload: Record<string, unknown>): JsonValue | null {
  if (eventPayload.type !== "response.output_item.done") {
    return null;
  }
  return "item" in eventPayload && eventPayload.item !== null && typeof eventPayload.item === "object"
    ? (eventPayload.item as JsonValue)
    : null;
}

function extractOpenAiEventMessage(eventPayload: Record<string, unknown>): string {
  const error =
    "error" in eventPayload && eventPayload.error !== null && typeof eventPayload.error === "object"
      ? (eventPayload.error as Record<string, unknown>)
      : null;
  return error !== null && typeof error.message === "string" ? error.message : "OpenAI stream returned an error event";
}

async function sendJsonRequestWithFallback(params: {
  urls: string[];
  method: "GET" | "POST";
  apiKey: string;
  signal?: AbortSignal;
  body?: Record<string, unknown>;
  fallbackMessage: string;
}): Promise<Response> {
  const uniqueUrls = [...new Set(params.urls)];
  let lastError: JsonValue | null = null;

  for (const url of uniqueUrls) {
    const response = await fetch(url, {
      method: params.method,
      signal: params.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        ...(params.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
    });
    if (response.ok) {
      return response;
    }
    lastError = await createOpenAiHostError(response, params.fallbackMessage);
    if (response.status !== 404) {
      throw lastError;
    }
  }
  throw lastError ?? createHostError("openaiError", params.fallbackMessage);
}

async function createOpenAiHostError(response: Response, fallbackMessage: string): Promise<JsonValue> {
  let detail = fallbackMessage;
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; code?: string; type?: string };
    };
    if (typeof payload.error?.message === "string") {
      detail = payload.error.message;
    }
    return createHostError(payload.error?.code ?? "openaiError", detail, {
      status: response.status,
      type: payload.error?.type ?? null,
    });
  } catch {
    const body = await response.text().catch(() => "");
    return createHostError("openaiError", detail, { status: response.status, body });
  }
}

function candidateApiUrls(baseUrl: string, resource: "models" | "responses"): string[] {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const urls = [`${normalizedBaseUrl}/${resource}`];
  if (!normalizedBaseUrl.endsWith("/v1") && !normalizedBaseUrl.endsWith("/api/v1")) {
    urls.push(`${normalizedBaseUrl}/v1/${resource}`);
  }
  return urls;
}
