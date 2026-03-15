import type { ClientNotification } from "../../../../../app-server-protocol/schema/typescript/ClientNotification";
import type { ClientRequest } from "../../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { InitializeCapabilities } from "../../../../../app-server-protocol/schema/typescript/InitializeCapabilities";
import type { InitializeParams } from "../../../../../app-server-protocol/schema/typescript/InitializeParams";
import type { RequestId } from "../../../../../app-server-protocol/schema/typescript/RequestId";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../../app-server-protocol/schema/typescript/ServerRequest";
import { normalizeHostValue } from "./utils";
import type { JsonValue, WasmProtocolRuntime } from "./types";

const DEFAULT_CHANNEL_CAPACITY = 128;

type JsonRpcRequestEnvelope<TMethod extends string, TParams> = {
  jsonrpc: "2.0";
  id: RequestId;
  method: TMethod;
  params: TParams;
};

type JsonRpcNotificationEnvelope<TMethod extends string> =
  | {
      jsonrpc: "2.0";
      method: TMethod;
    }
  | {
      jsonrpc: "2.0";
      method: TMethod;
      params: unknown;
    };

type JsonRpcResultEnvelope = {
  jsonrpc: "2.0";
  id: RequestId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type RequestResult = unknown;

export type AppServerClientEvent =
  | { type: "notification"; notification: ServerNotification }
  | { type: "serverRequest"; request: ServerRequest }
  | { type: "lagged"; skipped: number };

export type AppServerClientStartArgs = {
  clientName?: string;
  clientVersion?: string;
  experimentalApi?: boolean;
  optOutNotificationMethods?: string[];
  initializeParams?: Partial<InitializeParams>;
  channelCapacity?: number;
};

export class TypedRequestError extends Error {
  readonly kind: "transport" | "server" | "deserialize";
  readonly method: string;
  readonly causeValue: unknown;

  constructor(
    kind: "transport" | "server" | "deserialize",
    method: string,
    message: string,
    causeValue: unknown,
  ) {
    super(message);
    this.name = "TypedRequestError";
    this.kind = kind;
    this.method = method;
    this.causeValue = causeValue;
  }
}

export class AppServerJsonRpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: { code: number; message: string; data?: unknown }) {
    super(error.message);
    this.name = "AppServerJsonRpcError";
    this.code = error.code;
    this.data = error.data ?? null;
  }
}

export class AppServerClient {
  private readonly runtime: WasmProtocolRuntime;
  private readonly channelCapacity: number;
  private readonly eventQueue: AppServerClientEvent[] = [];
  private readonly eventWaiters: Array<(event: AppServerClientEvent | null) => void> = [];
  private pumpPromise: Promise<void> | null = null;
  private skippedEvents = 0;
  private closed = false;

  private constructor(runtime: WasmProtocolRuntime, channelCapacity: number) {
    this.runtime = runtime;
    this.channelCapacity = Math.max(1, channelCapacity);
  }

  static async start(
    runtime: WasmProtocolRuntime,
    args: AppServerClientStartArgs = {},
  ): Promise<AppServerClient> {
    const client = new AppServerClient(runtime, args.channelCapacity ?? DEFAULT_CHANNEL_CAPACITY);
    await client.request({
      id: "initialize",
      method: "initialize",
      params: buildInitializeParams(args),
    });
    await client.notify({ method: "initialized" });
    client.startPump();
    return client;
  }

  async request(request: ClientRequest): Promise<RequestResult> {
    try {
      const response = normalizeHostValue(
        await this.runtime.send({
          jsonrpc: "2.0",
          ...request,
        } satisfies JsonRpcRequestEnvelope<ClientRequest["method"], ClientRequest["params"]>),
      ) as JsonRpcResultEnvelope;

      if (response.error !== undefined) {
        throw new AppServerJsonRpcError(response.error);
      }

      return response.result ?? null;
    } catch (error) {
      if (error instanceof AppServerJsonRpcError) {
        throw error;
      }
      throw new TypedRequestError(
        "transport",
        request.method,
        `${request.method} transport error: ${formatErrorMessage(error)}`,
        error,
      );
    }
  }

  async requestTyped<T>(request: ClientRequest): Promise<T> {
    try {
      return (await this.request(request)) as T;
    } catch (error) {
      if (error instanceof TypedRequestError || error instanceof AppServerJsonRpcError) {
        throw error;
      }
      throw new TypedRequestError(
        "deserialize",
        request.method,
        `${request.method} response decode error: ${formatErrorMessage(error)}`,
        error,
      );
    }
  }

  async notify(notification: ClientNotification): Promise<void> {
    const envelope: JsonRpcNotificationEnvelope<ClientNotification["method"]> =
      "params" in notification
        ? {
            jsonrpc: "2.0",
            method: notification.method,
            params: notification.params,
          }
        : {
            jsonrpc: "2.0",
            method: notification.method,
          };
    await this.runtime.send(envelope);
  }

  async resolveServerRequest(requestId: RequestId, result: JsonValue): Promise<void> {
    await this.runtime.send({
      jsonrpc: "2.0",
      id: requestId,
      result,
    });
  }

  async rejectServerRequest(
    requestId: RequestId,
    error: {
      code: number;
      message: string;
      data?: JsonValue;
    },
  ): Promise<void> {
    await this.runtime.send({
      jsonrpc: "2.0",
      id: requestId,
      error,
    });
  }

  async nextEvent(): Promise<AppServerClientEvent | null> {
    if (this.eventQueue.length > 0) {
      return this.eventQueue.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return await new Promise((resolve) => {
      this.eventWaiters.push(resolve);
    });
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    while (this.eventWaiters.length > 0) {
      const waiter = this.eventWaiters.shift();
      waiter?.(null);
    }
    await this.pumpPromise;
  }

  private startPump() {
    if (this.pumpPromise !== null) {
      return;
    }
    this.pumpPromise = this.pump();
  }

  private async pump() {
    while (!this.closed) {
      const raw = normalizeHostValue(await this.runtime.nextMessage()) as JsonValue;
      if (raw === null) {
        continue;
      }
      if (isServerRequest(raw)) {
        this.enqueueEvent({ type: "serverRequest", request: raw });
        continue;
      }
      if (isServerNotification(raw)) {
        this.enqueueEvent({ type: "notification", notification: raw });
      }
    }
  }

  private enqueueEvent(event: AppServerClientEvent) {
    if (this.skippedEvents > 0) {
      if (this.eventWaiters.length > 0) {
        const waiter = this.eventWaiters.shift();
        waiter?.({ type: "lagged", skipped: this.skippedEvents });
        this.skippedEvents = 0;
      } else if (this.eventQueue.length < this.channelCapacity) {
        this.eventQueue.push({ type: "lagged", skipped: this.skippedEvents });
        this.skippedEvents = 0;
      }
    }

    if (this.eventWaiters.length > 0) {
      const waiter = this.eventWaiters.shift();
      waiter?.(event);
      return;
    }

    if (this.eventQueue.length < this.channelCapacity) {
      this.eventQueue.push(event);
      return;
    }

    this.skippedEvents += 1;
    if (event.type === "serverRequest") {
      void this.rejectServerRequest(event.request.id, {
        code: -32001,
        message: "browser app-server event queue is full",
      });
    }
  }
}

function buildInitializeParams(args: AppServerClientStartArgs): InitializeParams {
  const capabilities: InitializeCapabilities = {
    experimentalApi: args.experimentalApi ?? false,
    optOutNotificationMethods:
      args.optOutNotificationMethods === undefined || args.optOutNotificationMethods.length === 0
        ? null
        : args.optOutNotificationMethods,
  };

  return {
    clientInfo: {
      name: args.clientName ?? "browser-codex",
      title: null,
      version: args.clientVersion ?? "0.0.0",
    },
    capabilities,
    ...args.initializeParams,
  };
}

function isServerNotification(value: JsonValue): value is ServerNotification {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.method === "string" &&
    !("id" in value)
  );
}

function isServerRequest(value: JsonValue): value is ServerRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.method === "string" &&
    "id" in value
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
