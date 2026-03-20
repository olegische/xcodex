import type OpenAI from "openai";
import { prepareXrouterResponsesRequest } from "./xrouter-request.ts";
import type { BrowserTransportProvider, XrouterBrowserClient } from "./browser-adapter.ts";

export type XrouterStreamEventPayload = Record<string, unknown>;

export type XrouterStreamingExecutorParams<TError> = {
  requestId: string;
  requestBody: OpenAI.Responses.ResponseCreateParams;
  client: XrouterBrowserClient;
  onRegisterCancel: (cancel: () => void, isCancelled: () => boolean) => void;
  onUnregisterCancel: () => void;
  onEvent?: (event: XrouterStreamEventPayload) => void;
  onDelta?: (delta: string) => void;
  onCompleted?: (payload: XrouterStreamEventPayload) => void;
  onErrorEvent?: (message: string, payload: XrouterStreamEventPayload) => void;
  createError: (code: string, message: string) => TError;
  normalizeHostValue: (value: unknown) => unknown;
  isAbortError: (error: unknown) => boolean;
};

export async function runXrouterStreamingExecutor<TError>(
  params: XrouterStreamingExecutorParams<TError>,
): Promise<OpenAI.Responses.ResponseCreateParams> {
  const normalizedRequestBody = prepareXrouterResponsesRequest(params.requestBody);
  let cancelled = false;
  params.onRegisterCancel(
    () => {
      cancelled = true;
      params.client.cancel(params.requestId);
    },
    () => cancelled,
  );

  try {
    await params.client.runResponsesStream(
      params.requestId,
      normalizedRequestBody,
      (event: unknown) => {
        if (cancelled) {
          return;
        }
        const payload = normalizeXrouterEventPayload(params.normalizeHostValue(event));
        if (payload === null) {
          return;
        }
        params.onEvent?.(payload);
        if (payload.type === "output_text_delta" && typeof payload.delta === "string") {
          params.onDelta?.(payload.delta);
          return;
        }
        if (payload.type === "response_completed") {
          params.onCompleted?.(payload);
          return;
        }
        if (payload.type === "response_error") {
          const message =
            typeof payload.message === "string" ? payload.message : "xrouter request failed";
          params.onErrorEvent?.(message, payload);
        }
      },
    );
  } catch (error) {
    if (cancelled || params.isAbortError(error)) {
      throw params.createError("cancelled", "model turn cancelled");
    }
    throw error;
  } finally {
    params.onUnregisterCancel();
  }

  if (cancelled) {
    throw params.createError("cancelled", "model turn cancelled");
  }
  return normalizedRequestBody;
}

export function createXrouterBrowserClient(params: {
  runtime: { WasmBrowserClient: BrowserTransportProviderClientCtor };
  provider: BrowserTransportProvider;
  apiKey: string;
}): XrouterBrowserClient {
  return new params.runtime.WasmBrowserClient(
    params.provider.metadata?.xrouterProvider ?? "deepseek",
    params.provider.baseUrl.length === 0 ? null : params.provider.baseUrl,
    params.apiKey.length === 0 ? null : params.apiKey,
  );
}

type BrowserTransportProviderClientCtor = new (
  provider: string,
  baseUrl?: string | null,
  apiKey?: string | null,
) => XrouterBrowserClient;

function normalizeXrouterEventPayload(value: unknown): XrouterStreamEventPayload | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XrouterStreamEventPayload)
    : null;
}
