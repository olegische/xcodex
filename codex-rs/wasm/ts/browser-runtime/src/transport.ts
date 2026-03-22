import OpenAI from "openai";
import {
  createResolvedBrowserModelTransportAdapter,
  createXrouterBrowserClient,
  mapXrouterOutputItemToCodexResponseItem,
  runResponsesStreamingExecutor,
  runXrouterStreamingExecutor,
  type BrowserTransportProvider,
  type ModelTransportAdapter,
  type ResponsesStreamEvent,
  type XrouterRuntimeModule,
  type XrouterStreamEventPayload,
} from "@browser-codex/wasm-model-transport";
import { normalizeHostValue } from "@browser-codex/wasm-runtime-core/host-values";
import {
  activeProviderApiKey,
  createHostError,
  getActiveProvider,
  isAbortError,
  modelIdToDisplayName,
  normalizeDiscoveredModels,
} from "./config.ts";
import type { CodexCompatibleConfig, JsonValue, ModelPreset } from "./types.ts";

const activeModelCancels = new Map<string, () => void>();

export function createBrowserRuntimeModelTransportAdapter(deps: {
  loadXrouterRuntime(): Promise<XrouterRuntimeModule>;
}): ModelTransportAdapter<CodexCompatibleConfig, ModelPreset, JsonValue> {
  return createResolvedBrowserModelTransportAdapter({
    getProvider(config) {
      return validateBrowserTransportProvider(getActiveProvider(config));
    },
    getApiKey: activeProviderApiKey,
    normalizeDiscoveredModels,
    modelIdToDisplayName,
    createError: (code, message, data) =>
      createHostError(code, message, data as JsonValue | undefined),
    loadXrouterRuntime: deps.loadXrouterRuntime,
    async runResponsesTurn(params) {
      return await runResponsesApiTurn({
        requestId: params.requestId,
        baseUrl: params.provider.baseUrl,
        apiKey: params.apiKey,
        requestBody: params.requestBody,
        extraHeaders: params.extraHeaders,
        emitModelEvent: params.emitModelEvent,
      });
    },
    async runXrouterTurn(params) {
      return await runXrouterTurn({
        requestId: params.requestId,
        codexConfig: params.config,
        requestBody: params.requestBody,
        extraHeaders: params.extraHeaders,
        transportOptions: params.transportOptions,
        emitModelEvent: params.emitModelEvent,
        loadXrouterRuntime: deps.loadXrouterRuntime,
      });
    },
  });
}

export function validateBrowserTransportProvider(
  provider: BrowserTransportProvider,
): BrowserTransportProvider {
  const normalizedBaseUrl = normalizeProviderBaseUrl(provider.baseUrl);
  switch (provider.providerKind) {
    case "openai":
      assertAllowedProviderBaseUrl(
        normalizedBaseUrl,
        new Set(["https://api.openai.com/v1"]),
        provider,
      );
      break;
    case "xrouter_browser":
      assertAllowedProviderBaseUrl(
        normalizedBaseUrl,
        new Set([
          "https://api.deepseek.com",
          "https://api.openai.com/v1",
          "https://openrouter.ai/api/v1",
          "https://api.z.ai/api/paas/v4",
        ]),
        provider,
      );
      break;
    case "openai_compatible":
      break;
  }

  return {
    ...provider,
    baseUrl: normalizedBaseUrl,
  };
}

function assertAllowedProviderBaseUrl(
  baseUrl: string,
  allowedBaseUrls: ReadonlySet<string>,
  provider: Pick<BrowserTransportProvider, "name" | "providerKind">,
): void {
  if (allowedBaseUrls.has(baseUrl)) {
    return;
  }

  throw createHostError(
    "invalid_provider_base_url",
    `Provider \`${provider.name}\` (${provider.providerKind}) uses a blocked baseUrl: ${baseUrl}`,
    {
      providerKind: provider.providerKind,
      baseUrl,
      allowedBaseUrls: [...allowedBaseUrls],
    },
  );
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw createHostError(
      "invalid_provider_base_url",
      "Provider baseUrl must be a non-empty string.",
    );
  }
  return trimmed;
}

export function cancelActiveModelRequests(requestId: string): void {
  for (const [activeRequestId, cancel] of activeModelCancels.entries()) {
    if (activeRequestId === requestId || activeRequestId.startsWith(`${requestId}:`)) {
      cancel();
    }
  }
}

async function runResponsesApiTurn(params: {
  requestId: string;
  baseUrl: string;
  apiKey: string;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  emitModelEvent?: (event: JsonValue) => void | Promise<void>;
}): Promise<JsonValue> {
  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  let eventChain = enqueueModelEvent(
    Promise.resolve(),
    params.emitModelEvent,
    modelEvents[0],
  );

  try {
    await runResponsesStreamingExecutor({
      requestId: params.requestId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      requestBody: params.requestBody as OpenAI.Responses.ResponseCreateParams,
      extraHeaders: params.extraHeaders,
      onRegisterCancel(cancel) {
        activeModelCancels.set(params.requestId, cancel);
      },
      onUnregisterCancel() {
        activeModelCancels.delete(params.requestId);
      },
      onEvent(event) {
        const nextModelEvent = mapResponsesStreamEventToBrowserModelEvent(
          event,
          params.requestId,
        );
        if (nextModelEvent !== null) {
          modelEvents.push(nextModelEvent);
          eventChain = enqueueModelEvent(
            eventChain,
            params.emitModelEvent,
            nextModelEvent,
          );
        }
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

  const completedEvent = { type: "completed", requestId: params.requestId } satisfies JsonValue;
  modelEvents.push(completedEvent);
  eventChain = enqueueModelEvent(eventChain, params.emitModelEvent, completedEvent);
  await eventChain;
  return params.emitModelEvent === undefined ? modelEvents : [];
}

async function runXrouterTurn(params: {
  requestId: string;
  codexConfig: CodexCompatibleConfig;
  requestBody: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  transportOptions?: Record<string, unknown>;
  emitModelEvent?: (event: JsonValue) => void | Promise<void>;
  loadXrouterRuntime(): Promise<XrouterRuntimeModule>;
}): Promise<JsonValue> {
  const runtime = await params.loadXrouterRuntime();
  const provider = getActiveProvider(params.codexConfig);
  const client = createXrouterBrowserClient({
    runtime,
    provider,
    apiKey: activeProviderApiKey(params.codexConfig),
  });

  const modelEvents: JsonValue[] = [{ type: "started", requestId: params.requestId }];
  let streamError: JsonValue | null = null;
  const streamState = createStreamingState(params.transportOptions);
  let eventChain = enqueueModelEvent(
    Promise.resolve(),
    params.emitModelEvent,
    modelEvents[0],
  );

  try {
    await runXrouterStreamingExecutor({
      requestId: params.requestId,
      requestBody: params.requestBody as OpenAI.Responses.ResponseCreateParams,
      client,
      onRegisterCancel(cancel) {
        activeModelCancels.set(params.requestId, cancel);
      },
      onUnregisterCancel() {
        activeModelCancels.delete(params.requestId);
      },
      onEvent(payload) {
        const nextModelEvents = mapXrouterEventToBrowserModelEvents(
          payload,
          params.requestId,
          streamState,
        );
        modelEvents.push(...nextModelEvents);
        eventChain = enqueueModelEvents(
          eventChain,
          params.emitModelEvent,
          nextModelEvents,
        );
      },
      onCompleted(payload) {
        const outputItems = Array.isArray(payload.output)
          ? (payload.output as JsonValue[])
          : [];
        const normalizedOutputItems = outputItems
          .map((item) =>
            mapXrouterOutputItemToCodexResponseItem(item, streamState.assistantItemId),
          )
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
        eventChain = enqueueModelEvents(
          eventChain,
          params.emitModelEvent,
          modelEvents.filter(
            (event) =>
              event !== null &&
              typeof event === "object" &&
              !Array.isArray(event) &&
              event.requestId === params.requestId &&
              event.type === "outputItemDone",
          ),
        );
        const completedEvent = {
          type: "completed",
          requestId: params.requestId,
        } satisfies JsonValue;
        modelEvents.push(completedEvent);
        eventChain = enqueueModelEvent(eventChain, params.emitModelEvent, completedEvent);
      },
      onErrorEvent(message) {
        streamError = createHostError("unavailable", message);
      },
      createError(code, message) {
        return createHostError(code, message);
      },
      normalizeHostValue,
      isAbortError,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw createHostError("cancelled", "model turn cancelled");
    }
    throw error;
  }

  if (streamError !== null) {
    throw streamError;
  }
  await eventChain;
  if (!modelEvents.some((event) => isCompletedEvent(event, params.requestId))) {
    const completedEvent = {
      type: "completed",
      requestId: params.requestId,
    } satisfies JsonValue;
    modelEvents.push(completedEvent);
    await enqueueModelEvent(Promise.resolve(), params.emitModelEvent, completedEvent);
  }
  return params.emitModelEvent === undefined ? modelEvents : [];
}

type StreamingState = {
  assistantItemId: string;
  assistantModelStarted: boolean;
};

function createStreamingState(
  transportOptions: Record<string, unknown> | undefined,
): StreamingState {
  const options = transportOptions ?? {};
  const turnId = typeof options.turnId === "string" ? options.turnId : null;
  const assistantItemId =
    typeof options.assistantItemId === "string"
      ? options.assistantItemId
      : `${turnId ?? "turn"}:assistant`;
  return {
    assistantItemId,
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
  if (
    event.type === "response.reasoning_summary_text.delta" &&
    typeof event.delta === "string"
  ) {
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

function assistantStartedModelEvents(
  requestId: string,
  state: StreamingState,
): JsonValue[] {
  if (state.assistantModelStarted) {
    return [];
  }
  state.assistantModelStarted = true;
  return [
    {
      type: "outputItemAdded",
      requestId,
      item: {
        id: state.assistantItemId,
        type: "message",
        role: "assistant",
        content: [],
      },
    },
  ];
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOutputItemDoneEvent(event: JsonValue, requestId: string): boolean {
  return (
    isJsonRecord(event) &&
    event.requestId === requestId &&
    event.type === "outputItemDone"
  );
}

function isCompletedEvent(event: JsonValue, requestId: string): boolean {
  return isJsonRecord(event) && event.requestId === requestId && event.type === "completed";
}

function enqueueModelEvent(
  chain: Promise<void>,
  emitModelEvent: ((event: JsonValue) => void | Promise<void>) | undefined,
  event: JsonValue,
): Promise<void> {
  return chain.then(async () => {
    await emitModelEvent?.(event);
  });
}

function enqueueModelEvents(
  chain: Promise<void>,
  emitModelEvent: ((event: JsonValue) => void | Promise<void>) | undefined,
  events: JsonValue[],
): Promise<void> {
  return events.reduce(
    (nextChain, event) => enqueueModelEvent(nextChain, emitModelEvent, event),
    chain,
  );
}
