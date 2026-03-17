import type { ClientRequest } from "../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { DynamicToolCallOutputContentItem } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallOutputContentItem";
import type { ServerNotification } from "../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
import type { AppServerClientEvent } from "./app-server-client";
import type { RuntimeModule } from "./types";
import { AppServerClient } from "./app-server-client";
import type { JsonValue } from "./types";

export async function startBrowserAppServerClient(
  runtimeModule: RuntimeModule,
  host: unknown,
  args: { experimentalApi?: boolean } = {},
): Promise<AppServerClient> {
  const runtime = new runtimeModule.WasmBrowserRuntime(host);
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

type PendingTurn<TDispatch, TEvent> = {
  threadId: string;
  turnId: string | null;
  events: TEvent[];
  resolve: (dispatch: TDispatch) => void;
  reject: (error: unknown) => void;
};

export abstract class BrowserAppServerRuntimeCore<TDispatch, TEvent, TSnapshot> {
  protected readonly client: AppServerClient;
  private nextRequestId = 1;
  private readonly pendingTurns = new Map<string, PendingTurn<TDispatch, TEvent>>();
  private readonly pendingThreadTurns = new Map<string, PendingTurn<TDispatch, TEvent>>();
  private readonly threadAliases = new Map<string, string>();

  constructor(client: AppServerClient) {
    this.client = client;
    void this.startPump();
  }

  protected abstract eventFromNotification(notification: ServerNotification): TEvent;
  protected abstract handleRuntimeEvent(event: TEvent): void;
  protected abstract turnIdFromRuntimeEvent(event: TEvent): string | null;
  protected abstract isTurnCompletedEvent(event: TEvent): boolean;
  protected abstract handleServerRequest(request: ServerRequest): Promise<void>;
  protected abstract readThreadSnapshot(threadId: string): Promise<TSnapshot>;
  protected abstract buildResolvedDispatch(snapshot: TSnapshot, events: TEvent[]): TDispatch;

  protected actualThreadIdFromSnapshot(_snapshot: TSnapshot): string | null {
    return null;
  }

  protected onLagged(event: Extract<AppServerClientEvent, { type: "lagged" }>): void {
    console.warn("[browser-app-server] lagged", event);
  }

  protected async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `browser-${this.nextRequestId++}`;
    console.info("[browser-app-server] client-request", summarizeClientRequest(method, id, params));
    const response = await this.client.request<unknown>({
      id,
      method,
      params,
    } as ClientRequest);
    console.info("[browser-app-server] client-response", summarizeClientResponse(method, id, response));
    return response ?? null;
  }

  protected createPendingTurnDispatch(requestedThreadId: string): Promise<TDispatch> {
    const actualThreadId = this.resolveThreadId(requestedThreadId);
    return awaitPendingDispatch<TDispatch>((resolve, reject) => {
      this.pendingThreadTurns.set(requestedThreadId, {
        threadId: actualThreadId,
        turnId: null,
        events: [],
        resolve,
        reject,
      });
    });
  }

  protected activatePendingThreadTurn(requestedThreadId: string, turnId: string): void {
    const pending = this.pendingThreadTurns.get(requestedThreadId);
    if (pending === undefined) {
      return;
    }
    this.pendingThreadTurns.delete(requestedThreadId);
    pending.turnId = turnId;
    this.pendingTurns.set(turnId, pending);
  }

  protected async interruptPendingTurn(turnId: string): Promise<void> {
    const pending = this.pendingTurns.get(turnId);
    if (pending === undefined) {
      return;
    }
    await this.request("turn/interrupt", {
      threadId: pending.threadId,
      turnId,
    });
  }

  protected rememberThreadAlias(requestedThreadId: string, actualThreadId: string): void {
    this.threadAliases.set(requestedThreadId, actualThreadId);
  }

  protected adoptThreadAliasFromSnapshot(requestedThreadId: string, snapshot: TSnapshot): void {
    const actualThreadId = this.actualThreadIdFromSnapshot(snapshot);
    if (actualThreadId !== null) {
      this.threadAliases.set(requestedThreadId, actualThreadId);
    }
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
    const event = this.eventFromNotification(notification);
    this.handleRuntimeEvent(event);
    const turnId = this.turnIdFromRuntimeEvent(event);
    if (turnId === null) {
      return;
    }
    const pending = this.pendingTurns.get(turnId);
    if (pending === undefined) {
      return;
    }
    pending.events.push(event);
    if (this.isTurnCompletedEvent(event)) {
      void this.resolveTurn(turnId, pending);
    }
  }

  private async resolveTurn(turnId: string, pending: PendingTurn<TDispatch, TEvent>): Promise<void> {
    this.pendingTurns.delete(turnId);
    try {
      const snapshot = await this.readThreadSnapshot(pending.threadId);
      pending.resolve(this.buildResolvedDispatch(snapshot, pending.events));
    } catch (error) {
      pending.reject(error);
    }
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

function awaitPendingDispatch<TDispatch>(
  register: (
    resolve: (dispatch: TDispatch) => void,
    reject: (error: unknown) => void,
  ) => void,
): Promise<TDispatch> {
  return new Promise<TDispatch>((resolve, reject) => {
    register(resolve, reject);
  });
}
