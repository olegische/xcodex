import type { ClientRequest } from "../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { DynamicToolCallOutputContentItem } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallOutputContentItem";
import type { ServerNotification } from "../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
import type { AppServerClientEvent } from "./app-server-client";
import type { BrowserRuntimeHost, RuntimeModule } from "./types";
import type { WasmProtocolRuntime } from "./types";
import { AppServerClient } from "./app-server-client";
import type { JsonValue } from "./types";

export async function startBrowserAppServerClient(
  runtimeModule: RuntimeModule,
  host: unknown,
  args: { experimentalApi?: boolean } = {},
): Promise<AppServerClient> {
  const hostWithSink = attachRuntimeNotificationSink(host);
  const runtime = new runtimeModule.WasmBrowserRuntime(hostWithSink);
  installRuntimeNotificationSink(hostWithSink, runtime);
  return await AppServerClient.start(runtime, { experimentalApi: args.experimentalApi ?? true });
}

export function asDynamicToolContentItems(output: JsonValue): DynamicToolCallOutputContentItem[] {
  if (typeof output === "string") {
    return [{ type: "inputText", text: output }];
  }

  return [
    {
      type: "inputText",
      text: JSON.stringify(output, null, 2),
    },
  ];
}

export function threadToSessionSnapshot(thread: Record<string, unknown>): {
  threadId: string;
  metadata: JsonValue;
  items: JsonValue[];
} {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items = turns.flatMap((turn) => {
    if (turn === null || typeof turn !== "object" || Array.isArray(turn)) {
      return [];
    }
    const record = turn as Record<string, unknown>;
    return Array.isArray(record.items) ? record.items : [];
  });

  return {
    threadId: typeof thread.id === "string" ? thread.id : "thread",
    metadata: thread as JsonValue,
    items: items as JsonValue[],
  };
}

export function turnIdFromNotification(event: {
  params: JsonValue;
}): string | null {
  const params =
    event.params !== null && typeof event.params === "object" && !Array.isArray(event.params)
      ? (event.params as Record<string, unknown>)
      : null;
  if (params === null) {
    return null;
  }
  return extractTurnId(params);
}

export function summarizeServerNotification(notification: {
  method: string;
  params?: unknown;
}): Record<string, unknown> {
  const params =
    notification.params !== null &&
    notification.params !== undefined &&
    typeof notification.params === "object" &&
    !Array.isArray(notification.params)
      ? (notification.params as Record<string, unknown>)
      : {};
  return {
    method: notification.method,
    keys: Object.keys(params),
    turnId: extractTurnId(params),
  };
}

export function summarizeServerRequest(request: {
  id: string | number;
  method: string;
  params?: unknown;
}): Record<string, unknown> {
  const params =
    request.params !== null &&
    request.params !== undefined &&
    typeof request.params === "object" &&
    !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : {};
  return {
    id: request.id,
    method: request.method,
    keys: Object.keys(params),
    turnId: extractTurnId(params),
  };
}

export function summarizeClientResponse(
  method: string,
  requestId: string,
  result: unknown,
): Record<string, unknown> {
  return {
    requestId,
    method,
    hasResult: result !== undefined,
    hasError: false,
    errorMessage: null,
  };
}

export abstract class BrowserAppServerRuntimeCore {
  protected readonly client: AppServerClient;
  private nextRequestId = 1;
  private readonly threadAliases = new Map<string, string>();
  private readonly notificationListeners = new Set<(notification: ServerNotification) => void>();

  constructor(client: AppServerClient) {
    this.client = client;
    void this.startPump();
  }

  protected abstract handleServerRequest(request: ServerRequest): Promise<void>;
  protected handleServerNotification(_notification: ServerNotification): void {}

  protected onLagged(event: Extract<AppServerClientEvent, { type: "lagged" }>): void {
    console.warn("[browser-app-server] lagged", event);
  }

  protected async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `browser-${this.nextRequestId++}`;
    console.info("[browser-app-server] client-request", summarizeClientRequest(method, id, params));
    const response = await this.client.request({
      id,
      method,
      params,
    } as ClientRequest);
    console.info("[browser-app-server] client-response", summarizeClientResponse(method, id, response));
    return response ?? null;
  }

  protected async requestTyped<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return (await this.request(method, params)) as T;
  }

  public subscribeToNotifications(
    listener: (notification: ServerNotification) => void,
  ): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  protected rememberThreadAlias(requestedThreadId: string, actualThreadId: string): void {
    this.threadAliases.set(requestedThreadId, actualThreadId);
  }

  protected resolveThreadId(threadId: string): string {
    return this.threadAliases.get(threadId) ?? threadId;
  }

  private async startPump() {
    while (true) {
      const event = await this.client.nextEvent();
      if (event === null) {
        return;
      }
      if (event.type === "lagged") {
        this.onLagged(event);
        continue;
      }
      if (event.type === "serverRequest") {
        console.info("[browser-app-server] request", summarizeServerRequest(event.request));
        await this.handleServerRequest(event.request);
        continue;
      }
      console.info("[browser-app-server] notification", summarizeServerNotification(event.notification));
      this.handleNotification(event.notification);
    }
  }

  private handleNotification(notification: ServerNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
    this.handleServerNotification(notification);
  }
}

function extractTurnId(params: Record<string, unknown>): string | null {
  if (typeof params.turnId === "string") {
    return params.turnId;
  }
  if (
    params.turn !== null &&
    typeof params.turn === "object" &&
    !Array.isArray(params.turn) &&
    typeof (params.turn as Record<string, unknown>).id === "string"
  ) {
    return (params.turn as Record<string, unknown>).id as string;
  }
  return null;
}

function summarizeClientRequest(
  method: string,
  requestId: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return {
    requestId,
    method,
    keys: Object.keys(params),
    threadId: typeof params.threadId === "string" ? params.threadId : null,
    turnId: extractTurnId(params),
    hasInput: Array.isArray(params.input),
    inputCount: Array.isArray(params.input) ? params.input.length : 0,
    hasDynamicTools: Array.isArray(params.dynamicTools),
    dynamicToolCount: Array.isArray(params.dynamicTools) ? params.dynamicTools.length : 0,
  };
}

function attachRuntimeNotificationSink(host: unknown): BrowserRuntimeHost {
  if (host !== null && typeof host === "object" && !Array.isArray(host)) {
    return host as BrowserRuntimeHost;
  }
  return {} as BrowserRuntimeHost;
}

function installRuntimeNotificationSink(
  host: BrowserRuntimeHost,
  runtime: WasmProtocolRuntime,
): void {
  if (typeof runtime.enqueueNotification !== "function") {
    return;
  }
  host.emitNotification = async (notification: unknown) => {
    await runtime.enqueueNotification?.(notification);
  };
}
