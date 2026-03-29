import type { ClientNotification } from "../../../../app-server-protocol/schema/typescript/ClientNotification";
import type { ClientRequest } from "../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { RequestId } from "../../../../app-server-protocol/schema/typescript/RequestId";
import type { ServerNotification } from "../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
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
