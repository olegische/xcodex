import { collaborationStore } from "../stores/collaboration";
import type { DynamicToolCallParams } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../../../app-server-protocol/schema/typescript/v2/DynamicToolSpec";
import type { ConfigReadResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ConfigReadResponse";
import type { ListMcpServerStatusResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ListMcpServerStatusResponse";
import type { McpServerOauthLoginCompletedNotification } from "../../../../../app-server-protocol/schema/typescript/v2/McpServerOauthLoginCompletedNotification";
import type { McpServerStatus } from "../../../../../app-server-protocol/schema/typescript/v2/McpServerStatus";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../../app-server-protocol/schema/typescript/ServerRequest";
import {
  AppServerClient,
  asDynamicToolContentItems,
  BrowserAppServerRuntimeCore,
  startBrowserAppServerClient,
  threadToSessionSnapshot,
  turnIdFromNotification,
} from "@browser-codex/wasm-runtime-core";
import {
  installRemoteMcpController,
  type BrowserRemoteMcpController,
  type BrowserRemoteMcpServer,
  type BrowserRemoteMcpTool,
} from "@browser-codex/wasm-browser-host";
import { createBrowserAwareToolExecutor } from "./browser-tools";
import { emitActivitiesFromNotifications } from "./notifications";
import {
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredSession,
  saveStoredAuthState,
  saveStoredSession,
} from "./storage";
import { webUiModelTransportAdapter } from "./transport-adapter";
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

export class AppServerBrowserRuntime
  extends BrowserAppServerRuntimeCore<RuntimeDispatch, RuntimeEvent, SessionSnapshot>
  implements BrowserRuntime
{
  constructor(client: AppServerClient) {
    super(client);
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
    return await webUiModelTransportAdapter.discoverModels(codexConfig);
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
    this.rememberThreadAlias(request.threadId, actualThreadId);
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
      this.adoptThreadAliasFromSnapshot(request.threadId, stored);
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

    const dispatchPromise = this.createPendingTurnDispatch(request.threadId);

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
      inputCount: input.length,
      codexInputCount: textInputs.length,
      hasAuthState:
        modelPayload.authState !== null &&
        typeof modelPayload.authState === "object" &&
        !Array.isArray(modelPayload.authState),
    });

    const response = (await this.request("turn/start", turnStartParams)) as { turn?: { id?: string } };

    const turnId = typeof response.turn?.id === "string" ? response.turn.id : request.turnId;
    console.info("[webui] codex.turn-started", {
      requestedThreadId: request.threadId,
      resolvedThreadId: turnStartParams.threadId,
      requestedTurnId: request.turnId,
      actualTurnId: turnId,
    });
    this.activatePendingThreadTurn(request.threadId, turnId);
    return dispatchPromise;
  }

  async cancelModelTurn(requestId: string): Promise<void> {
    await this.interruptPendingTurn(requestId);
  }

  protected eventFromNotification(notification: ServerNotification): RuntimeEvent {
    return {
      method: notification.method,
      params: ("params" in notification ? notification.params : null) as JsonValue,
    } satisfies RuntimeEvent;
  }

  protected handleRuntimeEvent(event: RuntimeEvent): void {
    emitActivitiesFromNotifications([event]);
    if (event.method === "mcpServer/oauthLogin/completed") {
      this.resolvePendingMcpLogin(event.params);
    }
  }

  protected turnIdFromRuntimeEvent(event: RuntimeEvent): string | null {
    return turnIdFromNotification(event);
  }

  protected isTurnCompletedEvent(event: RuntimeEvent): boolean {
    return event.method === "turn/completed";
  }

  protected onLagged(event: { type: "lagged"; skipped: number }): void {
    console.warn("[webui] app-server:lagged", event);
  }

  protected buildResolvedDispatch(snapshot: SessionSnapshot, events: RuntimeEvent[]): RuntimeDispatch {
    console.info("[webui] app-server:turn-resolved", {
      threadId: snapshot.threadId,
      eventCount: events.length,
      eventMethods: events.map((event) => event.method),
    });
    return {
      value: snapshot,
      events,
    };
  }

  protected async handleServerRequest(request: ServerRequest): Promise<void> {
    const result = await this.resolveServerRequest(request);
    console.info("[webui] app-server:request:result", {
      id: request.id,
      method: request.method,
      success:
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        ("success" in result ? (result as Record<string, unknown>).success : null),
      keys:
        result !== null && typeof result === "object" && !Array.isArray(result)
          ? Object.keys(result)
          : [],
    });
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

  protected async readThreadSnapshot(threadId: string): Promise<SessionSnapshot> {
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

  protected actualThreadIdFromSnapshot(snapshot: SessionSnapshot): string | null {
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

  async listRemoteMcpServers(): Promise<BrowserRemoteMcpServer[]> {
    const [statusResponse, configResponse] = await Promise.all([
      this.listRemoteMcpServerStatus(),
      this.readConfigSnapshot(),
    ]);
    const configuredServers = readConfiguredMcpServers(configResponse);
    return statusResponse.data.map((status) => mapRemoteMcpServer(status, configuredServers[status.name]));
  }

  async addRemoteMcpServer(input: {
    serverUrl: string;
    serverName?: string | null;
  }): Promise<BrowserRemoteMcpServer> {
    const configResponse = await this.readConfigSnapshot();
    const configuredServers = readConfiguredMcpServers(configResponse);
    const serverName = resolveRemoteMcpServerName(input, configuredServers);
    configuredServers[serverName] = {
      url: input.serverUrl,
    };
    await this.writeRemoteMcpServers(configuredServers);
    await this.reloadRemoteMcpServers();
    return await this.readRemoteMcpServer(serverName);
  }

  async removeRemoteMcpServer(serverName: string): Promise<void> {
    const configResponse = await this.readConfigSnapshot();
    const configuredServers = readConfiguredMcpServers(configResponse);
    if (!(serverName in configuredServers)) {
      return;
    }
    delete configuredServers[serverName];
    await this.writeRemoteMcpServers(configuredServers);
    await this.reloadRemoteMcpServers();
  }

  async refreshRemoteMcpServer(serverName: string): Promise<BrowserRemoteMcpServer> {
    await this.reloadRemoteMcpServers();
    return await this.readRemoteMcpServer(serverName);
  }

  async logoutRemoteMcpServer(serverName: string): Promise<void> {
    throw new Error(`MCP logout is not supported in wasm browser runtime for '${serverName}'`);
  }

  async beginRemoteMcpLogin(input: {
    serverName: string;
    scopes?: string[] | null;
    timeoutSecs?: number | null;
  }): Promise<BrowserRemoteMcpServer> {
    const pending = createDeferred<void>();
    this.pendingMcpLogins.delete(input.serverName);
    this.pendingMcpLogins.set(input.serverName, pending);
    try {
      await this.request("mcpServer/oauth/login", {
      name: input.serverName,
      scopes: input.scopes ?? null,
      timeoutSecs: input.timeoutSecs ?? null,
      });
      await pending.promise;
      await this.reloadRemoteMcpServers();
      return await this.readRemoteMcpServer(input.serverName);
    } finally {
      this.pendingMcpLogins.delete(input.serverName);
    }
  }

  private readonly pendingMcpLogins = new Map<
    string,
    {
      promise: Promise<void>;
      resolve: () => void;
      reject: (error: unknown) => void;
    }
  >();

  private async readRemoteMcpServer(serverName: string): Promise<BrowserRemoteMcpServer> {
    const servers = await this.listRemoteMcpServers();
    const server = servers.find((candidate) => candidate.serverName === serverName);
    if (server === undefined) {
      throw new Error(`MCP server '${serverName}' was not found`);
    }
    return server;
  }

  private async listRemoteMcpServerStatus(): Promise<ListMcpServerStatusResponse> {
    const pages: McpServerStatus[] = [];
    let cursor: string | null = null;
    while (true) {
      const response = (await this.request("mcpServerStatus/list", {
        cursor,
        limit: null,
      })) as ListMcpServerStatusResponse;
      pages.push(...response.data);
      if (response.nextCursor === null) {
        return {
          data: pages,
          nextCursor: null,
        };
      }
      cursor = response.nextCursor;
    }
  }

  private async readConfigSnapshot(): Promise<ConfigReadResponse> {
    return (await this.request("config/read", {
      includeLayers: false,
      cwd: null,
    })) as ConfigReadResponse;
  }

  private async writeRemoteMcpServers(mcpServers: Record<string, unknown>): Promise<void> {
    await this.request("config/value/write", {
      keyPath: "mcp_servers",
      value: mcpServers,
      mergeStrategy: "replace",
      filePath: null,
      expectedVersion: null,
    });
  }

  private async reloadRemoteMcpServers(): Promise<void> {
    await this.request("config/mcpServer/reload", {});
  }

  private resolvePendingMcpLogin(params: JsonValue): void {
    const notification =
      params !== null && typeof params === "object" && !Array.isArray(params)
        ? (params as McpServerOauthLoginCompletedNotification)
        : null;
    if (notification === null || typeof notification.name !== "string") {
      return;
    }
    const pending = this.pendingMcpLogins.get(notification.name);
    if (pending === undefined) {
      return;
    }
    if (notification.success) {
      pending.resolve();
      return;
    }
    pending.reject(new Error(notification.error ?? `MCP login failed for '${notification.name}'`));
  }
}

export async function createAppServerBrowserRuntime(
  runtimeModule: RuntimeModule,
  host: unknown,
): Promise<BrowserRuntime> {
  const client = await startBrowserAppServerClient(runtimeModule, host, { experimentalApi: true });
  const runtime = new AppServerBrowserRuntime(client);
  installRemoteMcpController(createRemoteMcpController(runtime));
  return runtime;
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

function createRemoteMcpController(runtime: AppServerBrowserRuntime): BrowserRemoteMcpController {
  return {
    listServers: () => runtime.listRemoteMcpServers(),
    addServer: (input) => runtime.addRemoteMcpServer(input),
    removeServer: (serverName) => runtime.removeRemoteMcpServer(serverName),
    refreshServerTools: (serverName) => runtime.refreshRemoteMcpServer(serverName),
    logoutServer: (serverName) => runtime.logoutRemoteMcpServer(serverName),
    beginLogin: (input) => runtime.beginRemoteMcpLogin(input),
  };
}

function readConfiguredMcpServers(configResponse: ConfigReadResponse): Record<string, Record<string, unknown>> {
  const rawServers = configResponse.config.mcp_servers;
  if (rawServers === null || rawServers === undefined || typeof rawServers !== "object" || Array.isArray(rawServers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawServers).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        entry[1] !== null && typeof entry[1] === "object" && !Array.isArray(entry[1]),
    ),
  );
}

function mapRemoteMcpServer(
  status: McpServerStatus,
  configured: Record<string, unknown> | undefined,
): BrowserRemoteMcpServer {
  return {
    serverName: status.name,
    serverUrl: readConfiguredServerUrl(configured),
    authStatus: status.authStatus,
    connectionState: "idle",
    scopes: readConfiguredScopes(configured),
    tools: mapRemoteMcpTools(status.tools),
    expiresAt: null,
    lastError: null,
    clientId: readConfiguredClientId(configured),
  };
}

function readConfiguredServerUrl(configured: Record<string, unknown> | undefined): string {
  const url = configured?.url;
  return typeof url === "string" ? url : "";
}

function readConfiguredScopes(configured: Record<string, unknown> | undefined): string[] {
  const scopes = configured?.scopes;
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
}

function readConfiguredClientId(configured: Record<string, unknown> | undefined): string | null {
  const clientId = configured?.client_id;
  return typeof clientId === "string" ? clientId : null;
}

function mapRemoteMcpTools(tools: McpServerStatus["tools"]): BrowserRemoteMcpTool[] {
  return Object.entries(tools).flatMap(([qualifiedName, tool]) => {
    if (tool === undefined || tool === null) {
      return [];
    }
    const name = typeof tool.name === "string" && tool.name.length > 0 ? tool.name : qualifiedName;
    const parsed = splitQualifiedToolName(qualifiedName, name);
    return [
      {
        toolName: parsed.toolName,
        toolNamespace: parsed.toolNamespace,
        tool,
      },
    ];
  });
}

function splitQualifiedToolName(
  qualifiedName: string,
  fallbackName: string,
): {
  toolName: string;
  toolNamespace: string | null;
} {
  const separator = qualifiedName.lastIndexOf("__");
  if (separator <= 0 || separator >= qualifiedName.length - 2) {
    return {
      toolName: fallbackName,
      toolNamespace: null,
    };
  }

  return {
    toolName: qualifiedName.slice(separator + 2),
    toolNamespace: qualifiedName.slice(0, separator),
  };
}

function resolveRemoteMcpServerName(
  input: {
    serverUrl: string;
    serverName?: string | null;
  },
  configuredServers: Record<string, unknown>,
): string {
  const preferred = normalizeRemoteMcpServerName(input.serverName);
  if (preferred !== null) {
    return ensureUniqueRemoteMcpServerName(preferred, configuredServers);
  }

  const derived = normalizeRemoteMcpServerName(deriveRemoteMcpServerName(input.serverUrl)) ?? "remote_mcp";
  return ensureUniqueRemoteMcpServerName(derived, configuredServers);
}

function deriveRemoteMcpServerName(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    return [url.hostname, ...url.pathname.split("/")].filter((part) => part.length > 0).join("_");
  } catch {
    return serverUrl;
  }
}

function normalizeRemoteMcpServerName(serverName: string | null | undefined): string | null {
  if (serverName === null || serverName === undefined) {
    return null;
  }
  const normalized = serverName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function ensureUniqueRemoteMcpServerName(
  serverName: string,
  configuredServers: Record<string, unknown>,
): string {
  if (!(serverName in configuredServers)) {
    return serverName;
  }
  let suffix = 2;
  while (`${serverName}_${suffix}` in configuredServers) {
    suffix += 1;
  }
  return `${serverName}_${suffix}`;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
