import OpenAI from "openai";
import {
  createXrouterBrowserClient,
  mapXrouterOutputItemToCodexResponseItem,
  prepareXrouterResponsesRequest,
  runResponsesStreamingExecutor,
  runXrouterStreamingExecutor,
} from "@browser-codex/wasm-model-transport";
import { emitRuntimeActivity, registerActiveModelRequest, unregisterActiveModelRequest } from "./activity";
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
}): Promise<JsonValue> {
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];

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
      onDelta(outputTextDelta) {
        logStreamDelta(params.requestId, outputTextDelta);
        emitRuntimeActivity({ type: "delta", requestId: params.requestId, text: outputTextDelta });
        modelEvents.push({
          type: "delta",
          requestId: params.requestId,
          payload: { outputTextDelta },
        });
      },
      onOutputItemDone(outputItem) {
        modelEvents.push({
          type: "outputItemDone",
          requestId: params.requestId,
          item: outputItem as JsonValue,
        });
      },
      onErrorEvent(message) {
        logStreamFailure(params.requestId, message);
        emitRuntimeActivity({
          type: "error",
          requestId: params.requestId,
          message,
        });
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
}): Promise<JsonValue> {
  const client = await createXrouterClient(params.codexConfig);
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  let streamError: JsonValue | null = null;
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
      onDelta(delta) {
        logStreamDelta(params.requestId, delta);
        emitRuntimeActivity({ type: "delta", requestId: params.requestId, text: delta });
        modelEvents.push({
          type: "delta",
          requestId: params.requestId,
          payload: { outputTextDelta: delta },
        });
      },
      onCompleted(payload) {
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
        logStreamCompleted(params.requestId, collectAssistantTextFromItems(normalizedOutputItems), {
          provider: "xrouter",
          finishReason: typeof payload.finish_reason === "string" ? payload.finish_reason : null,
        });
        modelEvents.push({ type: "completed", requestId: params.requestId });
      },
      onErrorEvent(message) {
        emitRuntimeActivity({
          type: "error",
          requestId: params.requestId,
          message,
        });
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
  if (!modelEvents.some((event) => isCompletedEvent(event, params.requestId))) {
    logStreamCompleted(params.requestId, collectAssistantTextFromModelEvents(modelEvents), {
      provider: "xrouter",
      completedEvent: false,
    });
    modelEvents.push({ type: "completed", requestId: params.requestId });
  }
  return modelEvents;
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
