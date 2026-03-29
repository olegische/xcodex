import type { ClientNotification } from "../../../../app-server-protocol/schema/typescript/ClientNotification";
import type { ClientRequest } from "../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { RequestId } from "../../../../app-server-protocol/schema/typescript/RequestId";
import type { ServerNotification } from "../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
import type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";

export type ConnectionEvent =
  | { type: "notification"; notification: ServerNotification }
  | { type: "serverRequest"; request: ServerRequest }
  | { type: "lagged"; skipped: number };

export type CodexAppServerConnectionEvent = ConnectionEvent;

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

export type CodexServerRequestHandler = (request: ServerRequest) => Promise<JsonValue>;

export const JSON_HEADERS = {
  "content-type": "application/json",
} as const;

export const SSE_HEADERS = {
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

export async function defaultServerRequestHandler(request: ServerRequest): Promise<JsonValue> {
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

export function toRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Request {
  return input instanceof Request ? input : new Request(String(input), init);
}

export function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

export function jsonErrorResponse(status: number, message: string): Response {
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

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function unixTimestampSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
