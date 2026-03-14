import { emitRuntimeActivity, registerActiveModelRequest, unregisterActiveModelRequest } from "./activity";
import { loadXrouterRuntime } from "./assets";
import { assistantTextFromResponseItem, isCompletedEvent, isOutputItemDoneEvent } from "./transcript";
import { activeProviderApiKey, createHostError, getActiveProvider, isAbortError, modelIdToDisplayName, normalizeDiscoveredModels, normalizeHostValue } from "./utils";
import type { CodexCompatibleConfig, JsonValue, ModelPreset, XrouterBrowserClient } from "./types";

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

  const response = await sendJsonRequestWithFallback({
    urls: candidateApiUrls(params.baseUrl, "responses"),
    method: "POST",
    apiKey: params.apiKey,
    signal: abortController.signal,
    body: params.requestBody,
    fallbackMessage: "responses request failed",
  }).catch((error) => {
    unregisterActiveModelRequest(params.requestId);
    if (cancelled || isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  });

  if (response.body === null) {
    unregisterActiveModelRequest(params.requestId);
    throw createHostError("unavailable", "responses request did not return a stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read().catch((error) => {
        if (cancelled || isAbortError(error)) {
          throw createHostError("cancelled", "model turn cancelled");
        }
        throw error;
      });
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const data = readSseData(segment);
        if (data === null || data === "[DONE]") {
          continue;
        }
        let eventPayload: Record<string, unknown>;
        try {
          eventPayload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const outputTextDelta = extractOutputTextDelta(eventPayload);
        if (outputTextDelta !== null) {
          emitRuntimeActivity({ type: "delta", requestId: params.requestId, text: outputTextDelta });
          modelEvents.push({
            type: "delta",
            requestId: params.requestId,
            payload: { outputTextDelta },
          });
        }
        const outputItem = extractOutputItemDone(eventPayload);
        if (outputItem !== null) {
          modelEvents.push({ type: "outputItemDone", requestId: params.requestId, item: outputItem });
        }
        if (eventPayload.type === "error") {
          emitRuntimeActivity({
            type: "error",
            requestId: params.requestId,
            message: extractOpenAiEventMessage(eventPayload),
          });
          throw createHostError("openaiError", extractOpenAiEventMessage(eventPayload));
        }
      }
      if (done) {
        break;
      }
    }
  } finally {
    unregisterActiveModelRequest(params.requestId);
  }

  modelEvents.push({ type: "completed", requestId: params.requestId });
  emitRuntimeActivity({ type: "completed", requestId: params.requestId, finishReason: null });
  return modelEvents;
}

export async function runXrouterTurn(params: {
  requestId: string;
  codexConfig: CodexCompatibleConfig;
  requestBody: Record<string, unknown>;
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
  const normalizedRequestBody = buildXrouterTransportRequest(params.requestBody, params.responseInputItems);
  console.info("[webui] xrouter.request-body", {
    requestId: params.requestId,
    tools: summarizeToolCollection(normalizedRequestBody.tools),
    toolChoice: normalizedRequestBody.tool_choice ?? null,
    toolSearchOutputs: summarizeToolSearchOutputs(params.responseInputItems),
    input: summarizeResponsesInput(normalizedRequestBody.input as JsonValue | undefined),
  });
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
          const record = item as Record<string, unknown>;
          if (record.type === "function_call") {
            emitRuntimeActivity({
              type: "toolCall",
              requestId: params.requestId,
              callId: typeof record.call_id === "string" ? record.call_id : null,
              toolName: typeof record.name === "string" ? record.name : null,
              arguments:
                (typeof record.arguments === "string"
                  ? record.arguments
                  : (record.arguments as JsonValue | undefined)) ?? null,
            });
            continue;
          }
          if (record.type === "message") {
            emitRuntimeActivity({
              type: "assistantMessage",
              requestId: params.requestId,
              content: (record.content as JsonValue | undefined) ?? null,
            });
          }
        }

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
      }
    });
  } catch (error) {
    unregisterActiveModelRequest(params.requestId);
    if (cancelled || isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  } finally {
    unregisterActiveModelRequest(params.requestId);
  }

  if (streamError !== null) {
    throw streamError;
  }
  if (cancelled) {
    throw createHostError("cancelled", "model turn cancelled");
  }
  if (!modelEvents.some((event) => isCompletedEvent(event, params.requestId))) {
    modelEvents.push({ type: "completed", requestId: params.requestId });
  }
  return modelEvents;
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

function buildXrouterTransportRequest(
  requestBody: Record<string, unknown>,
  responseInputItems: JsonValue[] | null,
): Record<string, unknown> {
  const tools = Array.isArray(requestBody.tools) ? (requestBody.tools as JsonValue[]) : undefined;
  const toolChoice =
    requestBody.tool_choice !== undefined ? (requestBody.tool_choice as JsonValue) : undefined;
  const stream = requestBody.stream !== false;
  const instructionsText = typeof requestBody.instructions === "string" ? requestBody.instructions : "";

  return {
    model: requestBody.model,
    input: buildXrouterResponsesInput(instructionsText, responseInputItems),
    stream,
    ...(tools === undefined ? {} : { tools }),
    ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
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
  };
}

function summarizeToolSearchOutputs(
  responseInputItems: JsonValue[] | null,
): Array<Record<string, unknown>> {
  if (responseInputItems === null) {
    return [];
  }
  return responseInputItems.flatMap((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (record.type !== "tool_search_output") {
      return [];
    }
    return [
      {
        callId: typeof record.call_id === "string" ? record.call_id : null,
        execution: typeof record.execution === "string" ? record.execution : null,
        tools: summarizeToolCollection(record.tools),
      },
    ];
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

function buildXrouterResponsesInput(
  instructionsText: string,
  responseInputItems: JsonValue[] | null,
): JsonValue {
  const normalizedItems =
    responseInputItems === null
      ? []
      : responseInputItems.filter(
          (item): item is JsonValue =>
            item !== null && typeof item === "object" && !Array.isArray(item),
        );

  if (instructionsText.trim().length === 0) {
    return normalizedItems;
  }

  return [
    {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: instructionsText }],
    },
    ...normalizedItems,
  ];
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
    return {
      type: "function_call",
      id: typeof record.id === "string" ? record.id : undefined,
      call_id: callId,
      name: record.name,
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
