import OpenAI from "openai";
import { firstResponsesApiUrl } from "./http";

export type ResponsesStreamEvent = Record<string, unknown>;

export type ResponsesStreamingExecutorParams<TError> = {
  requestId: string;
  baseUrl: string;
  apiKey: string;
  requestBody: OpenAI.Responses.ResponseCreateParams;
  extraHeaders: Record<string, string> | null;
  onRegisterCancel: (cancel: () => void, isCancelled: () => boolean) => void;
  onUnregisterCancel: () => void;
  onEvent?: (event: ResponsesStreamEvent) => void;
  onDelta?: (delta: string) => void;
  onOutputItemDone?: (item: unknown) => void;
  onCompleted?: () => void;
  onErrorEvent?: (message: string) => void;
  createError: (code: string, message: string) => TError;
  isAbortError: (error: unknown) => boolean;
};

export async function runResponsesStreamingExecutor<TError>(
  params: ResponsesStreamingExecutorParams<TError>,
): Promise<void> {
  const abortController = new AbortController();
  let cancelled = false;
  params.onRegisterCancel(
    () => {
      cancelled = true;
      abortController.abort();
    },
    () => cancelled,
  );

  try {
    const client = new OpenAI({
      apiKey: params.apiKey,
      baseURL: firstResponsesApiUrl(params.baseUrl),
      defaultHeaders: params.extraHeaders ?? undefined,
      dangerouslyAllowBrowser: true,
    });
    const stream = await client.responses.create(params.requestBody, {
      signal: abortController.signal,
    });

    for await (const event of stream as AsyncIterable<ResponsesStreamEvent>) {
      params.onEvent?.(event);
      const outputTextDelta = extractOutputTextDelta(event);
      if (outputTextDelta !== null) {
        params.onDelta?.(outputTextDelta);
      }

      const outputItem = extractOutputItemDone(event);
      if (outputItem !== null) {
        params.onOutputItemDone?.(outputItem);
      }

      if (event.type === "error") {
        const message = extractOpenAiEventMessage(event);
        params.onErrorEvent?.(message);
        throw params.createError("openaiError", message);
      }

      if (event.type === "response.completed") {
        params.onCompleted?.();
        break;
      }

      if (cancelled) {
        throw params.createError("cancelled", "model turn cancelled");
      }
    }
  } catch (error) {
    if (cancelled || params.isAbortError(error)) {
      throw params.createError("cancelled", "model turn cancelled");
    }
    throw error;
  } finally {
    params.onUnregisterCancel();
  }
}

function extractOutputTextDelta(eventPayload: ResponsesStreamEvent): string | null {
  return eventPayload.type === "response.output_text.delta" && typeof eventPayload.delta === "string"
    ? eventPayload.delta
    : null;
}

function extractOutputItemDone(eventPayload: ResponsesStreamEvent): unknown | null {
  if (eventPayload.type !== "response.output_item.done") {
    return null;
  }
  return "item" in eventPayload && eventPayload.item !== null && typeof eventPayload.item === "object"
    ? eventPayload.item
    : null;
}

function extractOpenAiEventMessage(eventPayload: ResponsesStreamEvent): string {
  const error =
    "error" in eventPayload && eventPayload.error !== null && typeof eventPayload.error === "object"
      ? (eventPayload.error as Record<string, unknown>)
      : null;
  return error !== null && typeof error.message === "string"
    ? error.message
    : "OpenAI stream returned an error event";
}
