import {
  createCodexA2AClient,
  createCodexOpenAIClient,
  createRpcCodexConnection,
  type CodexAppServerConnection,
} from "@xcodexai/sdk";
import { collaborationStore } from "../stores/collaboration";
import type { ClientRequest } from "../../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { RequestId } from "../../../../../app-server-protocol/schema/typescript/RequestId";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../../app-server-protocol/schema/typescript/ServerRequest";
import type { JsonValue } from "../../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";
import type { ModelListResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ModelListResponse";
import { emitRuntimeEvent } from "./events";
import {
  clearStoredA2ATaskBinding,
  saveStoredA2ATaskBinding,
  saveStoredThreadBinding,
} from "./storage";
import type {
  BrowserRuntime,
  DemoProtocolMode,
  ModelPreset,
  RuntimeEvent,
  TranscriptEntry,
} from "./types";

type LocalCodexRpcNotification = {
  method: string;
  params: JsonValue;
  atIso: string;
};

type PendingServerRequest = {
  id: RequestId;
  method: string;
  params: JsonValue;
};

type ServerRequestReplyBody = {
  id: RequestId;
  result?: JsonValue;
  error?: {
    code?: number;
    message: string;
    data?: JsonValue;
  };
};

type LocalNotificationBridge = {
  subscribeToNotifications(listener: (notification: ServerNotification) => void): () => void;
  setServerRequestHandler(handler: ((request: ServerRequest) => Promise<void>) | null): void;
};

export async function createLocalCodexRuntime(args: {
  protocolMode: DemoProtocolMode;
  baseUrl: string;
}): Promise<BrowserRuntime> {
  const connection = createLocalCodexConnection(args.baseUrl);
  const notificationBridge = createLocalNotificationBridge(connection);

  const unsubscribeRuntimeEvents = notificationBridge.subscribeToNotifications((notification) => {
    emitRuntimeEvent({
      method: notification.method,
      params: ("params" in notification ? notification.params : null) as JsonValue,
    } satisfies RuntimeEvent);
  });

  if (args.protocolMode === "responses-api") {
    return createLocalResponsesRuntime(args.baseUrl, connection, notificationBridge);
  }
  if (args.protocolMode === "a2a") {
    return createLocalA2ARuntime(args.baseUrl, connection, notificationBridge);
  }
  return createLocalAppServerRuntime(connection, notificationBridge);
}

function createLocalAppServerRuntime(
  connection: CodexAppServerConnection,
  notificationBridge: LocalNotificationBridge,
): BrowserRuntime {
  return createLocalBaseRuntime("app-server", connection, notificationBridge);
}

function createLocalBaseRuntime(
  protocolMode: DemoProtocolMode,
  connection: CodexAppServerConnection,
  notificationBridge: LocalNotificationBridge,
): BrowserRuntime {
  notificationBridge.setServerRequestHandler(
    protocolMode === "app-server"
      ? async (request) => {
          await resolveLocalServerRequest(connection, request);
        }
      : null,
  );

  return {
    protocolMode,
    async shutdown() {
      unsubscribeRuntimeEvents();
      await connection.shutdown();
    },
    async readAccount() {
      return {
        account: null,
        requiresOpenaiAuth: false,
      };
    },
    async threadStart(params) {
      const response = await connection.request({
        id: `local:thread:start:${crypto.randomUUID()}`,
        method: "thread/start",
        params,
      } as ClientRequest);
      return response as Awaited<ReturnType<BrowserRuntime["threadStart"]>>;
    },
    async threadResume(params) {
      const response = await connection.request({
        id: `local:thread:resume:${crypto.randomUUID()}`,
        method: "thread/resume",
        params,
      } as ClientRequest);
      return response as Awaited<ReturnType<BrowserRuntime["threadResume"]>>;
    },
    async listThreads(params) {
      const response = await connection.request({
        id: `local:thread:list:${crypto.randomUUID()}`,
        method: "thread/list",
        params,
      } as ClientRequest);
      return response as Awaited<NonNullable<BrowserRuntime["listThreads"]>>;
    },
    async threadRead(params) {
      const response = await connection.request({
        id: `local:thread:read:${crypto.randomUUID()}`,
        method: "thread/read",
        params,
      } as ClientRequest);
      return response as Awaited<ReturnType<BrowserRuntime["threadRead"]>>;
    },
    async turnStart(params) {
      const response = await connection.request({
        id: `local:turn:start:${crypto.randomUUID()}`,
        method: "turn/start",
        params,
      } as ClientRequest);
      return response as Awaited<ReturnType<BrowserRuntime["turnStart"]>>;
    },
    async turnInterrupt(params) {
      const response = await connection.request({
        id: `local:turn:interrupt:${crypto.randomUUID()}`,
        method: "turn/interrupt",
        params,
      } as ClientRequest);
      return response as Awaited<ReturnType<BrowserRuntime["turnInterrupt"]>>;
    },
    subscribeToNotifications(listener) {
      return notificationBridge.subscribeToNotifications(listener);
    },
    async loadAuthState() {
      return null;
    },
    async saveAuthState() {},
    async clearAuthState() {},
    async listModels() {
      return await listLocalCodexModels(connection);
    },
  };
}

function createLocalResponsesRuntime(
  baseUrl: string,
  connection: CodexAppServerConnection,
  notificationBridge: LocalNotificationBridge,
): BrowserRuntime {
  const openai = createCodexOpenAIClient({
    connection,
    apiKey: "xcodex-local-codex",
    baseURL: `${normalizeBaseUrl(baseUrl)}/v1`,
    defaultCwd: null,
    handleServerRequest: handleLocalServerRequest,
  });

  return {
    ...createLocalBaseRuntime("responses-api", connection, notificationBridge),
    protocolMode: "responses-api",
    async runResponsesTurn(request) {
      const stream = openai.responses.stream({
        model: request.model,
        input: request.message,
        previous_response_id: request.previousResponseId,
        reasoning:
          request.reasoningEffort === null
            ? undefined
            : {
                effort: request.reasoningEffort,
              },
      });

      for await (const _event of stream) {
        // Notifications are bridged separately into the UI.
      }

      const response = await stream.finalResponse();
      return {
        responseId: response.id,
        output: typeof response.output_text === "string" ? response.output_text : "",
      };
    },
  };
}

function createLocalA2ARuntime(
  baseUrl: string,
  connection: CodexAppServerConnection,
  notificationBridge: LocalNotificationBridge,
): BrowserRuntime {
  return {
    ...createLocalBaseRuntime("a2a", connection, notificationBridge),
    protocolMode: "a2a",
    async runA2ATurn(request) {
      const a2a = await createCodexA2AClient({
        connection,
        baseUrl: normalizeBaseUrl(baseUrl),
        defaultModel: request.model,
        handleServerRequest: handleLocalServerRequest,
      });

      let previousTaskId = request.previousTaskId;
      if (previousTaskId !== null) {
        const existingTask = await a2a.getTask({
          id: previousTaskId,
          historyLength: 1,
        }).catch(() => null);
        if (existingTask === null) {
          previousTaskId = null;
          await clearStoredA2ATaskBinding();
        }
      }

      const stream = a2a.sendMessageStream({
        message: {
          kind: "message",
          messageId: crypto.randomUUID(),
          role: "user",
          taskId: previousTaskId ?? undefined,
          contextId: previousTaskId ?? undefined,
          parts: [
            {
              kind: "text",
              text: request.message,
            },
          ],
        },
      });

      let taskId = previousTaskId;
      let output = "";
      for await (const event of stream) {
        if (event.kind === "task") {
          taskId = event.id;
          continue;
        }
        if (event.kind === "artifact-update") {
          const delta = event.artifact.parts
            .filter((part) => part.kind === "text")
            .map((part) => part.text)
            .join("");
          output += delta;
        }
      }

      if (taskId === null) {
        throw new Error("A2A stream did not return a task id");
      }

      const transcript: TranscriptEntry[] = [
        { role: "user", text: request.message },
        { role: "assistant", text: output },
      ];

      await Promise.all([
        saveStoredA2ATaskBinding(taskId),
        saveStoredThreadBinding(taskId),
      ]);
      return {
        taskId,
        output,
        transcript,
      };
    },
  };
}

async function listLocalCodexModels(
  connection: CodexAppServerConnection,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const response = (await connection.request({
    id: `local:model:list:${crypto.randomUUID()}`,
    method: "model/list",
    params: {
      cursor: null,
      limit: 200,
    },
  } as ClientRequest)) as ModelListResponse;

  return {
    data: response.data
      .filter((model) => model.hidden !== true)
      .map((model) => ({
        id: model.model,
        displayName: model.displayName,
        description: model.description,
        isDefault: model.isDefault,
        showInPicker: true,
        supportsApi: true,
      })),
    nextCursor: response.nextCursor,
  };
}

function createLocalNotificationBridge(
  connection: CodexAppServerConnection,
): LocalNotificationBridge {
  const notificationListeners = new Set<(notification: ServerNotification) => void>();
  let handleServerRequest: ((request: ServerRequest) => Promise<void>) | null = null;

  connection.subscribe((event) => {
    if (event.type === "notification") {
      for (const listener of notificationListeners) {
        listener(event.notification);
      }
      return;
    }
    if (event.type === "serverRequest" && handleServerRequest !== null) {
      void handleServerRequest(event.request);
    }
  });

  return {
    subscribeToNotifications(listener) {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },
    setServerRequestHandler(handler) {
      handleServerRequest = handler;
    },
  };
}

function createLocalCodexConnection(baseUrl: string): CodexAppServerConnection {
  return createRpcCodexConnection({
    async request(request) {
      return await localCodexRpcCall(baseUrl, request.method, request.params);
    },
    async notify() {},
    async resolveServerRequest(requestId, result) {
      await respondLocalServerRequest(baseUrl, {
        id: requestId,
        result,
      });
    },
    async rejectServerRequest(requestId, error) {
      await respondLocalServerRequest(baseUrl, {
        id: requestId,
        error,
      });
    },
    subscribe(listener) {
      const seenServerRequests = new Set<string>();
      const unsubscribeNotifications = subscribeLocalCodexNotifications(baseUrl, (notification) => {
        listener({
          type: "notification",
          notification: {
            method: notification.method,
            params: notification.params,
          } as ServerNotification,
        });
      });

      let closed = false;
      const poll = async () => {
        if (closed) {
          return;
        }
        const pendingRequests = await fetchPendingLocalServerRequests(baseUrl).catch(() => []);
        for (const pendingRequest of pendingRequests) {
          const requestKey = String(pendingRequest.id);
          if (seenServerRequests.has(requestKey)) {
            continue;
          }
          seenServerRequests.add(requestKey);
          listener({
            type: "serverRequest",
            request: pendingRequest as unknown as ServerRequest,
          });
        }
      };

      void poll();
      const intervalId = window.setInterval(() => {
        void poll();
      }, 750);

      return () => {
        closed = true;
        window.clearInterval(intervalId);
        unsubscribeNotifications();
      };
    },
    async shutdown() {},
  });
}

async function resolveLocalServerRequest(
  connection: CodexAppServerConnection,
  request: ServerRequest,
): Promise<void> {
  try {
    const result = await handleLocalServerRequest(request);
    await connection.resolveServerRequest(request.id, result);
  } catch (error) {
    await connection.rejectServerRequest(request.id, {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleLocalServerRequest(request: ServerRequest): Promise<JsonValue> {
  switch (request.method) {
    case "item/tool/requestUserInput":
      return await collaborationStore.requestUserInput({
        questions: request.params.questions.map((question) => ({
          id: question.id,
          header: question.header,
          question: question.question,
          options: question.options ?? [],
        })),
      });
    default:
      throw new Error(`Unsupported local Codex server request: ${request.method}`);
  }
}

async function localCodexRpcCall<T>(
  baseUrl: string,
  method: string,
  params?: unknown,
): Promise<T> {
  const response = await fetch(buildCodexApiUrl(baseUrl, "/codex-api/rpc"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method,
      params: params ?? null,
    }),
  });

  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(extractCodexError(payload, `RPC ${method} failed with HTTP ${response.status}`));
  }
  const envelope = asRecord(payload);
  if (envelope === null || !("result" in envelope)) {
    throw new Error(`RPC ${method} returned malformed envelope`);
  }
  return envelope.result as T;
}

function subscribeLocalCodexNotifications(
  baseUrl: string,
  onNotification: (notification: LocalCodexRpcNotification) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (typeof EventSource === "undefined") {
    return () => {};
  }

  const source = new EventSource(buildCodexApiUrl(normalizeBaseUrl(baseUrl), "/codex-api/events"));
  source.onmessage = (event) => {
    const notification = toLocalNotification(event.data);
    if (notification !== null) {
      onNotification(notification);
    }
  };

  return () => {
    source.close();
  };
}

async function fetchPendingLocalServerRequests(baseUrl: string): Promise<PendingServerRequest[]> {
  const response = await fetch(buildCodexApiUrl(baseUrl, "/codex-api/server-requests/pending"));
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(
      extractCodexError(payload, `Pending server requests failed with HTTP ${response.status}`),
    );
  }
  const record = asRecord(payload);
  return Array.isArray(record?.data) ? (record.data as PendingServerRequest[]) : [];
}

async function respondLocalServerRequest(
  baseUrl: string,
  body: ServerRequestReplyBody,
): Promise<void> {
  const response = await fetch(buildCodexApiUrl(baseUrl, "/codex-api/server-requests/respond"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(
      extractCodexError(payload, `Server request reply failed with HTTP ${response.status}`),
    );
  }
}

function toLocalNotification(raw: string): LocalCodexRpcNotification | null {
  try {
    const value = JSON.parse(raw) as unknown;
    const record = asRecord(value);
    if (record === null || typeof record.method !== "string") {
      return null;
    }
    return {
      method: record.method,
      params: (record.params ?? null) as JsonValue,
      atIso:
        typeof record.atIso === "string" && record.atIso.length > 0
          ? record.atIso
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function buildCodexApiUrl(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(normalizeBaseUrl(baseUrl))).toString();
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return window.location.origin;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractCodexError(payload: unknown, fallbackMessage: string): string {
  const record = asRecord(payload);
  if (typeof record?.error === "string" && record.error.length > 0) {
    return record.error;
  }
  const error = asRecord(record?.error);
  if (typeof error?.message === "string" && error.message.length > 0) {
    return error.message;
  }
  if (typeof record?.message === "string" && record.message.length > 0) {
    return record.message;
  }
  return fallbackMessage;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
