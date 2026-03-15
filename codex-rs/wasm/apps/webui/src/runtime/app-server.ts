import { collaborationStore } from "../stores/collaboration";
import type { ClientRequest } from "../../../../../app-server-protocol/schema/typescript/ClientRequest";
import type { DynamicToolCallOutputContentItem } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallOutputContentItem";
import type { DynamicToolCallParams } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolSpec";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../../app-server-protocol/schema/typescript/ServerRequest";
import { AppServerClient } from "./app-server-client";
import { createBrowserAwareToolExecutor } from "./browser-tools";
import { emitActivitiesFromNotifications } from "./notifications";
import { discoverProviderModels, discoverRouterModels } from "./transports";
import {
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredSession,
  saveStoredAuthState,
  saveStoredSession,
} from "./storage";
import { formatError, getActiveProvider, normalizeHostValue } from "./utils";
import type {
  Account,
  AuthState,
  BrowserRuntime,
  JsonValue,
  ModelPreset,
  RuntimeDispatch,
  RuntimeEvent,
  RuntimeModule,
  SessionSnapshot,
} from "./types";

const browserToolExecutor = createBrowserAwareToolExecutor();

type PendingTurn = {
  threadId: string;
  turnId: string | null;
  events: RuntimeEvent[];
  resolve: (dispatch: RuntimeDispatch) => void;
  reject: (error: unknown) => void;
};

export class AppServerBrowserRuntime implements BrowserRuntime {
  private readonly client: AppServerClient;
  private nextRequestId = 1;
  private readonly pendingTurns = new Map<string, PendingTurn>();
  private readonly pendingThreadTurns = new Map<string, PendingTurn>();
  private readonly threadAliases = new Map<string, string>();

  constructor(client: AppServerClient) {
    this.client = client;
    void this.startPump();
  }

  async loadAuthState(): Promise<AuthState | null> {
    return loadStoredAuthState();
  }

  async saveAuthState(authState: AuthState): Promise<void> {
    await saveStoredAuthState(authState);
  }

  async clearAuthState(): Promise<void> {
    await saveStoredAuthState({
      authMode: "apiKey",
      openaiApiKey: null,
      accessToken: null,
      refreshToken: null,
      chatgptAccountId: null,
      chatgptPlanType: null,
      lastRefreshAt: null,
    });
  }

  async readAccount(_request: { refreshToken: boolean }): Promise<{
    account: Account | null;
    requiresOpenaiAuth: boolean;
  }> {
    const [authState, codexConfig] = await Promise.all([loadStoredAuthState(), loadStoredCodexConfig()]);
    const provider = getActiveProvider(codexConfig);
    if (authState === null || authState.openaiApiKey === null || authState.openaiApiKey.trim().length === 0) {
      return {
        account: null,
        requiresOpenaiAuth: provider.providerKind === "openai",
      };
    }
    return {
      account: {
        email: null,
        planType: authState.chatgptPlanType,
        chatgptAccountId: authState.chatgptAccountId,
        authMode: authState.authMode,
      },
      requiresOpenaiAuth: false,
    };
  }

  async listModels(_request: {
    cursor: string | null;
    limit: number | null;
  }): Promise<{
    data: ModelPreset[];
    nextCursor: string | null;
  }> {
    const codexConfig = await loadStoredCodexConfig();
    const provider = getActiveProvider(codexConfig);
    if (provider.providerKind === "xrouter_browser") {
      return discoverRouterModels(codexConfig);
    }
    return discoverProviderModels(codexConfig);
  }

  async refreshAuth(_context: {
    reason: "unauthorized";
    previousAccountId: string | null;
  }): Promise<{
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType: string | null;
  }> {
    throw new Error("Browser terminal uses API keys only.");
  }

  async startThread(request: {
    threadId: string;
    metadata: JsonValue;
  }): Promise<RuntimeDispatch> {
    const config = await loadStoredCodexConfig();
    const dynamicTools = await listBrowserDynamicTools();
    const response = await this.request("thread/start", {
      threadId: request.threadId,
      model: config.model.trim() || null,
      modelProvider: config.modelProvider,
      cwd: "/workspace",
      approvalPolicy: "on-request",
      ephemeral: false,
      dynamicTools,
    });
    const thread = normalizeHostValue((response as { thread?: unknown }).thread) as Record<string, unknown>;
    const actualThreadId =
      typeof thread.id === "string" && thread.id.length > 0 ? thread.id : request.threadId;
    this.threadAliases.set(request.threadId, actualThreadId);
    const snapshot = await this.readThreadSnapshot(actualThreadId);
    return {
      value: { ...snapshot, threadId: request.threadId },
      events: [
        {
          method: "thread/started",
          params: {
            thread,
          },
        },
      ],
    };
  }

  async resumeThread(request: { threadId: string }): Promise<RuntimeDispatch> {
    const stored = await loadStoredSession(request.threadId);
    if (stored !== null) {
      const actualThreadId = this.actualThreadIdFromSnapshot(stored);
      if (actualThreadId !== null) {
        this.threadAliases.set(request.threadId, actualThreadId);
      }
      return { value: stored, events: [] };
    }
    const actualThreadId = this.resolveThreadId(request.threadId);
    const snapshot = await this.readThreadSnapshot(actualThreadId);
    return { value: { ...snapshot, threadId: request.threadId }, events: [] };
  }

  async runTurn(request: {
    threadId: string;
    turnId: string;
    input: JsonValue;
    modelPayload: JsonValue;
  }): Promise<RuntimeDispatch> {
    const modelPayload =
      request.modelPayload !== null &&
      typeof request.modelPayload === "object" &&
      !Array.isArray(request.modelPayload)
        ? (request.modelPayload as Record<string, unknown>)
        : {};
    const input = Array.isArray(request.input) ? request.input : [];
    const textInputs = input.flatMap((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const record = item as Record<string, unknown>;
      if (record.type !== "message" || record.role !== "user" || !Array.isArray(record.content)) {
        return [];
      }
      return record.content.flatMap((part) => {
        if (part === null || typeof part !== "object" || Array.isArray(part)) {
          return [];
        }
        const content = part as Record<string, unknown>;
        if (content.type !== "input_text" || typeof content.text !== "string") {
          return [];
        }
        return [
          {
            type: "text",
            text: content.text,
            textElements: [],
          },
        ];
      });
    });

    const dispatchPromise = new Promise<RuntimeDispatch>((resolve, reject) => {
      const actualThreadId = this.resolveThreadId(request.threadId);
      this.pendingThreadTurns.set(request.threadId, {
        threadId: actualThreadId,
        turnId: null,
        events: [],
        resolve,
        reject,
      });
    });

    const turnStartParams = {
      threadId: this.resolveThreadId(request.threadId),
      input: textInputs,
      model: typeof modelPayload.model === "string" ? modelPayload.model : null,
      effort: typeof modelPayload.reasoningEffort === "string" ? modelPayload.reasoningEffort : null,
      personality: typeof modelPayload.personality === "string" ? modelPayload.personality : null,
      approvalPolicy: "on-request",
    };

    console.info("[webui] codex.turn-input", {
      requestedThreadId: request.threadId,
      resolvedThreadId: turnStartParams.threadId,
      requestedTurnId: request.turnId,
      model: turnStartParams.model,
      effort: turnStartParams.effort,
      personality: turnStartParams.personality,
      input,
      codexInput: textInputs,
    });
    console.info(
      "[webui] codex.turn-input:json",
      JSON.stringify(
        {
          requestedThreadId: request.threadId,
          requestedTurnId: request.turnId,
          params: turnStartParams,
          modelPayload,
          originalInput: input,
        },
        null,
        2,
      ),
    );

    const response = (await this.request("turn/start", turnStartParams)) as { turn?: { id?: string } };

    const turnId = typeof response.turn?.id === "string" ? response.turn.id : request.turnId;
    console.info("[webui] codex.turn-started", {
      requestedThreadId: request.threadId,
      resolvedThreadId: turnStartParams.threadId,
      requestedTurnId: request.turnId,
      actualTurnId: turnId,
    });
    const pending = this.pendingThreadTurns.get(request.threadId);
    if (pending !== undefined) {
      this.pendingThreadTurns.delete(request.threadId);
      pending.turnId = turnId;
      this.pendingTurns.set(turnId, pending);
    }
    return dispatchPromise;
  }

  async cancelModelTurn(requestId: string): Promise<void> {
    const pending = this.pendingTurns.get(requestId);
    if (pending === undefined) {
      return;
    }
    await this.request("turn/interrupt", {
      threadId: pending.threadId,
      turnId: requestId,
    });
  }

  private async startPump() {
    while (true) {
      const event = await this.client.nextEvent();
      if (event === null) {
        return;
      }
      if (event.type === "lagged") {
        console.warn("[webui] app-server:lagged", event);
        continue;
      }
      if (event.type === "serverRequest") {
        console.info("[webui] app-server:request", summarizeServerRequest(event.request));
        console.info("[webui] app-server:request:json", JSON.stringify(event.request, null, 2));
        await this.handleServerRequest(event.request);
        continue;
      }
      console.info("[webui] app-server:notification", summarizeServerNotification(event.notification));
      console.info("[webui] app-server:notification:json", JSON.stringify(event.notification, null, 2));
      this.handleServerNotification(event.notification);
    }
  }

  private handleServerNotification(notification: ServerNotification) {
    const event = {
      method: notification.method,
      params: ("params" in notification ? notification.params : null) as JsonValue,
    } satisfies RuntimeEvent;

    emitActivitiesFromNotifications([event]);

    const turnId = turnIdFromNotification(event);
    if (turnId !== null) {
      const pending = this.pendingTurns.get(turnId);
      if (pending !== undefined) {
        pending.events.push(event);
        if (event.method === "turn/completed") {
          void this.resolveTurn(turnId, pending);
        }
      }
    }
  }

  private async resolveTurn(turnId: string, pending: PendingTurn) {
    this.pendingTurns.delete(turnId);
    try {
      const snapshot = await this.readThreadSnapshot(pending.threadId);
      console.info("[webui] app-server:turn-resolved", {
        turnId,
        threadId: pending.threadId,
        eventCount: pending.events.length,
        eventMethods: pending.events.map((event) => event.method),
      });
      pending.resolve({
        value: snapshot,
        events: pending.events,
      });
    } catch (error) {
      pending.reject(error);
    }
  }

  private async handleServerRequest(request: ServerRequest) {
    const result = await this.resolveServerRequest(request);
    console.info("[webui] app-server:request:result", {
      id: request.id,
      method: request.method,
      result,
    });
    console.info(
      "[webui] app-server:request:result:json",
      JSON.stringify(
        {
          id: request.id,
          method: request.method,
          result,
        },
        null,
        2,
      ),
    );
    await this.client.resolveServerRequest(request.id, result as JsonValue);
  }

  private async resolveServerRequest(request: ServerRequest): Promise<Record<string, unknown>> {
    switch (request.method) {
      case "item/tool/requestUserInput": {
        const params = request.params as {
          questions?: Array<{
            id: string;
            header: string;
            question: string;
            options?: Array<{ label: string; description: string }> | null;
          }>;
        };
        const response = await collaborationStore.requestUserInput({
          questions: (params.questions ?? []).map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            options: question.options ?? [],
          })),
        });
        return {
          answers: Object.fromEntries(
            response.answers.map((answer) => [answer.id, { answers: [String(answer.value ?? "")] }]),
          ),
        };
      }
      case "item/commandExecution/requestApproval":
        return { decision: "cancel" };
      case "item/fileChange/requestApproval":
        return { decision: "cancel" };
      case "item/permissions/requestApproval":
        return { permissions: {}, scope: "turn" };
      case "item/tool/call":
        return this.handleDynamicToolCall(request);
      case "mcpServer/elicitation/request":
        return { action: "cancel", content: null, meta: null };
      default:
        return {};
    }
  }

  private async handleDynamicToolCall(request: ServerRequest): Promise<DynamicToolCallResponse> {
    const params = request.params as DynamicToolCallParams;
    const tool = typeof params.tool === "string" ? params.tool : "";
    const callId = typeof params.callId === "string" ? params.callId : request.id;

    if (!tool.startsWith("browser__")) {
      return {
        contentItems: [
          {
            type: "inputText",
            text: `Unsupported dynamic tool: ${tool}`,
          },
        ],
        success: false,
      };
    }

    try {
      const result = await browserToolExecutor.invoke({
        callId,
        toolName: tool,
        toolNamespace: "browser",
        input: (params.arguments ?? null) as JsonValue,
      });
      return {
        contentItems: asDynamicToolContentItems(result.output),
        success: true,
      };
    } catch (error) {
      return {
        contentItems: [
          {
            type: "inputText",
            text: `Browser tool ${tool} failed: ${formatError(error)}`,
          },
        ],
        success: false,
      };
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `browser-${this.nextRequestId++}`;
    console.info("[webui] app-server:client-request", {
      id,
      method,
      params,
    });
    console.info(
      "[webui] app-server:client-request:json",
      JSON.stringify(
        {
          id,
          method,
          params,
        },
        null,
        2,
      ),
    );
    const response = await this.client.request<unknown>({
      id,
      method,
      params,
    } as ClientRequest);
    console.info("[webui] app-server:client-response", summarizeClientResponse(method, id, response));
    console.info(
      "[webui] app-server:client-response:json",
      JSON.stringify(
        {
          requestId: id,
          method,
          response: {
            result: response,
          },
        },
        null,
        2,
      ),
    );
    return response ?? null;
  }

  private async readThreadSnapshot(threadId: string): Promise<SessionSnapshot> {
    const response = (await this.request("thread/read", {
      threadId,
      includeTurns: true,
    })) as { thread?: Record<string, unknown> };
    const thread =
      response.thread !== undefined && response.thread !== null && typeof response.thread === "object"
        ? response.thread
        : {};
    const snapshot = threadToSessionSnapshot(thread);
    await saveStoredSession(snapshot);
    return snapshot;
  }

  private resolveThreadId(threadId: string): string {
    return this.threadAliases.get(threadId) ?? threadId;
  }

  private actualThreadIdFromSnapshot(snapshot: SessionSnapshot): string | null {
    if (
      snapshot.metadata !== null &&
      typeof snapshot.metadata === "object" &&
      !Array.isArray(snapshot.metadata) &&
      typeof (snapshot.metadata as Record<string, unknown>).id === "string"
    ) {
      return (snapshot.metadata as Record<string, unknown>).id as string;
    }
    return null;
  }
}

export async function createAppServerBrowserRuntime(
  runtimeModule: RuntimeModule,
  host: unknown,
): Promise<BrowserRuntime> {
  const runtime = new runtimeModule.WasmBrowserRuntime(host);
  const client = await AppServerClient.start(runtime, { experimentalApi: true });
  return new AppServerBrowserRuntime(client);
}

async function listBrowserDynamicTools(): Promise<DynamicToolSpec[]> {
  const listed = await browserToolExecutor.list();
  return listed.tools.map((tool) => ({
    name:
      tool.toolNamespace === "browser" && !tool.toolName.startsWith("browser__")
        ? `browser__${tool.toolName}`
        : tool.toolName,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function asDynamicToolContentItems(output: JsonValue): DynamicToolCallOutputContentItem[] {
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

function threadToSessionSnapshot(thread: Record<string, unknown>): SessionSnapshot {
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

function turnIdFromNotification(event: RuntimeEvent): string | null {
  const params =
    event.params !== null && typeof event.params === "object" && !Array.isArray(event.params)
      ? (event.params as Record<string, unknown>)
      : null;
  if (params === null) {
    return null;
  }
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

function summarizeServerNotification(notification: ServerNotification): Record<string, unknown> {
  return {
    method: notification.method,
    keys: Object.keys(("params" in notification ? notification.params : {}) ?? {}),
    turnId: extractTurnId(("params" in notification ? notification.params : undefined) as Record<string, unknown> | undefined),
  };
}

function summarizeServerRequest(request: ServerRequest): Record<string, unknown> {
  return {
    id: request.id,
    method: request.method,
    keys: Object.keys(request.params ?? {}),
    turnId: extractTurnId(request.params),
  };
}

function summarizeClientResponse(
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

function extractTurnId(params: Record<string, unknown> | undefined): string | null {
  if (params === undefined) {
    return null;
  }
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
