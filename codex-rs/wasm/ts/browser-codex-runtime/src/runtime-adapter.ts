import type { DynamicToolCallParams } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolSpec";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
import {
  AppServerClient,
  asDynamicToolContentItems,
  BrowserAppServerRuntimeCore,
  startBrowserAppServerClient,
} from "@browser-codex/wasm-runtime-core";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import type {
  BrowserCodexRuntimeDeps,
  BrowserDynamicToolCatalogEntry,
  CreateBrowserCodexRuntimeParams,
} from "./types";

export class BrowserCodexRuntime<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TDispatch,
  TEvent,
  TSnapshot,
  TRefreshAuthResult,
> extends BrowserAppServerRuntimeCore<TDispatch, TEvent, TSnapshot> {
  private readonly deps: BrowserCodexRuntimeDeps<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >;

  constructor(
    client: AppServerClient,
    deps: BrowserCodexRuntimeDeps<
      TAuthState,
      TConfig,
      TAccount,
      TModelPreset,
      TDispatch,
      TEvent,
      TSnapshot,
      TRefreshAuthResult
    >,
  ) {
    super(client);
    this.deps = deps;
  }

  async loadAuthState(): Promise<TAuthState | null> {
    return await this.deps.persistence.loadAuthState();
  }

  async saveAuthState(authState: TAuthState): Promise<void> {
    await this.deps.persistence.saveAuthState(authState);
  }

  async clearAuthState(): Promise<void> {
    await this.deps.persistence.clearAuthState();
  }

  async readAccount(request: { refreshToken: boolean }): Promise<{
    account: TAccount | null;
    requiresOpenaiAuth: boolean;
  }> {
    const [authState, config] = await Promise.all([
      this.deps.persistence.loadAuthState(),
      this.deps.persistence.loadConfig(),
    ]);
    return await this.deps.readAccount({
      authState,
      config,
      refreshToken: request.refreshToken,
    });
  }

  async listModels(request: {
    cursor: string | null;
    limit: number | null;
  }): Promise<{
    data: TModelPreset[];
    nextCursor: string | null;
  }> {
    const config = await this.deps.persistence.loadConfig();
    return await this.deps.discoverModels({
      config,
      cursor: request.cursor,
      limit: request.limit,
    });
  }

  async refreshAuth(context: {
    reason: "unauthorized";
    previousAccountId: string | null;
  }): Promise<TRefreshAuthResult> {
    return await this.deps.refreshAuth(context);
  }

  async startThread(request: {
    threadId: string;
    metadata: JsonValue;
  }): Promise<TDispatch> {
    const config = await this.deps.persistence.loadConfig();
    const dynamicTools = await listDynamicToolSpecs(this.deps.dynamicTools, this.deps.normalizeDynamicToolName);
    const response = await this.request("thread/start", {
      threadId: request.threadId,
      model: readThreadStartModel(config),
      modelProvider: readThreadStartModelProvider(config),
      cwd: "/workspace",
      approvalPolicy: "on-request",
      ephemeral: false,
      dynamicTools,
    });
    const thread = this.deps.normalizeThread((response as { thread?: unknown }).thread);
    const actualThreadId =
      typeof thread.id === "string" && thread.id.length > 0 ? thread.id : request.threadId;
    this.rememberThreadAlias(request.threadId, actualThreadId);
    const snapshot = await this.readThreadSnapshot(actualThreadId);
    return this.deps.buildDispatch(this.deps.withRequestedThreadId(snapshot, request.threadId), [
      {
        method: "thread/started",
        params: {
          thread,
        },
      } as TEvent,
    ]);
  }

  async resumeThread(request: { threadId: string }): Promise<TDispatch> {
    const response = await this.request("thread/resume", {
      threadId: this.resolveThreadId(request.threadId),
    });
    const thread = this.deps.normalizeThread((response as { thread?: unknown }).thread);
    const actualThreadId =
      typeof thread.id === "string" && thread.id.length > 0 ? thread.id : this.resolveThreadId(request.threadId);
    this.rememberThreadAlias(request.threadId, actualThreadId);
    const snapshot = await this.readThreadSnapshot(actualThreadId);
    return this.deps.buildDispatch(this.deps.withRequestedThreadId(snapshot, request.threadId), []);
  }

  async runTurn(request: {
    threadId: string;
    turnId: string;
    input: JsonValue;
    modelPayload: JsonValue;
  }): Promise<TDispatch> {
    const modelPayload = asRecord(request.modelPayload);
    const dispatchPromise = this.createPendingTurnDispatch(request.threadId);
    const turnStartParams = {
      threadId: this.resolveThreadId(request.threadId),
      input: mapTurnInputTextItems(request.input),
      model: typeof modelPayload.model === "string" ? modelPayload.model : null,
      effort: typeof modelPayload.reasoningEffort === "string" ? modelPayload.reasoningEffort : null,
      personality: typeof modelPayload.personality === "string" ? modelPayload.personality : null,
      approvalPolicy: "on-request",
    };
    const logScope = this.deps.logScope ?? "browser-runtime";
    console.info(`[${logScope}] turn-input`, {
      requestedThreadId: request.threadId,
      resolvedThreadId: turnStartParams.threadId,
      requestedTurnId: request.turnId,
      model: turnStartParams.model,
      effort: turnStartParams.effort,
      personality: turnStartParams.personality,
      inputCount: Array.isArray(request.input) ? request.input.length : 0,
      codexInputCount: turnStartParams.input.length,
    });

    const response = (await this.request("turn/start", turnStartParams)) as { turn?: { id?: string } };
    const turnId = typeof response.turn?.id === "string" ? response.turn.id : request.turnId;
    console.info(`[${logScope}] turn-started`, {
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

  protected eventFromNotification(notification: Parameters<typeof this.deps.mapNotificationToEvent>[0]): TEvent {
    return this.deps.mapNotificationToEvent(notification);
  }

  protected handleRuntimeEvent(event: TEvent): void {
    this.deps.emitRuntimeEvents([event]);
  }

  protected turnIdFromRuntimeEvent(event: TEvent): string | null {
    return this.deps.turnIdFromRuntimeEvent(event);
  }

  protected isTurnCompletedEvent(event: TEvent): boolean {
    return this.deps.isTurnCompletedEvent(event);
  }

  protected async handleServerRequest(request: ServerRequest): Promise<void> {
    const result = await this.resolveServerRequest(request);
    await this.client.resolveServerRequest(request.id, result as JsonValue);
  }

  protected async readThreadSnapshot(threadId: string): Promise<TSnapshot> {
    const response = (await this.request("thread/read", {
      threadId,
      includeTurns: true,
    })) as { thread?: unknown };
    const snapshot = this.deps.threadToSnapshot(
      this.deps.normalizeThread(response.thread),
    );
    await this.deps.persistence.saveSession(snapshot);
    return snapshot;
  }

  protected buildResolvedDispatch(snapshot: TSnapshot, events: TEvent[]): TDispatch {
    return this.deps.buildDispatch(snapshot, events);
  }

  protected actualThreadIdFromSnapshot(snapshot: TSnapshot): string | null {
    return this.deps.actualThreadIdFromSnapshot?.(snapshot) ?? null;
  }

  private async resolveServerRequest(request: ServerRequest): Promise<Record<string, unknown>> {
    switch (request.method) {
      case "item/tool/requestUserInput": {
        if (this.deps.requestUserInput === undefined) {
          return { answers: {} };
        }
        const params = asRecord(request.params);
        const response = await this.deps.requestUserInput({
          questions: Array.isArray(params.questions)
            ? params.questions.map((question) => {
                const record = asRecord(question);
                return {
                  id: typeof record.id === "string" ? record.id : "",
                  header: typeof record.header === "string" ? record.header : "",
                  question: typeof record.question === "string" ? record.question : "",
                  options: Array.isArray(record.options)
                    ? record.options.map((option) => {
                        const optionRecord = asRecord(option);
                        return {
                          label: typeof optionRecord.label === "string" ? optionRecord.label : "",
                          description:
                            typeof optionRecord.description === "string" ? optionRecord.description : "",
                        };
                      })
                    : [],
                };
              })
            : [],
        });
        return {
          answers: Object.fromEntries(
            response.answers.map((answer) => [answer.id, { answers: [String(answer.value ?? "")] }]),
          ),
        };
      }
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        return { decision: "cancel" };
      case "item/permissions/requestApproval":
        return { permissions: {}, scope: "turn" };
      case "item/tool/call":
        return await this.handleDynamicToolCall(request);
      case "mcpServer/elicitation/request":
        return { action: "cancel", content: null, meta: null };
      default:
        return (await this.deps.resolveUnhandledServerRequest?.(request)) ?? {};
    }
  }

  private async handleDynamicToolCall(request: ServerRequest): Promise<DynamicToolCallResponse> {
    const params = request.params as DynamicToolCallParams;
    const toolName = typeof params.tool === "string" ? params.tool : "";
    const callId = typeof params.callId === "string" ? params.callId : String(request.id);
    const target =
      this.deps.resolveDynamicToolTarget?.(toolName) ??
      defaultResolveDynamicToolTarget(toolName);

    if (target === null) {
      return {
        contentItems: [
          {
            type: "inputText",
            text: `Unsupported dynamic tool: ${toolName}`,
          },
        ],
        success: false,
      };
    }

    try {
      const result = await this.deps.dynamicTools.invoke({
        callId,
        toolName: target.toolName,
        toolNamespace: target.toolNamespace,
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
            text: `${toolName} failed: ${this.deps.formatError(error)}`,
          },
        ],
        success: false,
      };
    }
  }
}

export async function createBrowserCodexRuntime<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TDispatch,
  TEvent,
  TSnapshot,
  TRefreshAuthResult,
>(
  params: CreateBrowserCodexRuntimeParams<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >,
): Promise<
  BrowserCodexRuntime<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >
> {
  const client = await startBrowserAppServerClient(params.runtimeModule, params.host, {
    experimentalApi: params.experimentalApi ?? true,
  });
  return new BrowserCodexRuntime(client, params.deps);
}

async function listDynamicToolSpecs(
  executor: {
    list(): Promise<{
      tools: BrowserDynamicToolCatalogEntry[];
    }>;
  },
  normalizeDynamicToolName: ((tool: BrowserDynamicToolCatalogEntry) => string) | undefined,
): Promise<DynamicToolSpec[]> {
  const listed = await executor.list();
  return listed.tools.map((tool) => ({
    name: normalizeDynamicToolName?.(tool) ?? defaultNormalizeDynamicToolName(tool),
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function defaultNormalizeDynamicToolName(tool: BrowserDynamicToolCatalogEntry): string {
  if (tool.toolNamespace === "browser" && !tool.toolName.startsWith("browser__")) {
    return `browser__${tool.toolName}`;
  }
  return tool.toolName;
}

function defaultResolveDynamicToolTarget(toolName: string): {
  toolNamespace: string;
  toolName: string;
} | null {
  if (toolName.startsWith("browser__")) {
    return {
      toolNamespace: "browser",
      toolName,
    };
  }
  const match = /^([a-z0-9_]+)__(.+)$/i.exec(toolName);
  if (match === null) {
    return null;
  }
  return {
    toolNamespace: match[1] ?? "browser",
    toolName,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapTurnInputTextItems(input: JsonValue): Array<{
  type: "text";
  text: string;
  textElements: [];
}> {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((item) => {
    const record = asRecord(item);
    if (record.type !== "message" || record.role !== "user" || !Array.isArray(record.content)) {
      return [];
    }
    return record.content.flatMap((part) => {
      const content = asRecord(part);
      if (content.type !== "input_text" || typeof content.text !== "string") {
        return [];
      }
      return [
        {
          type: "text" as const,
          text: content.text,
          textElements: [],
        },
      ];
    });
  });
}

function readThreadStartModel(config: unknown): string | null {
  const record = asRecord(config);
  return typeof record.model === "string" && record.model.trim().length > 0 ? record.model.trim() : null;
}

function readThreadStartModelProvider(config: unknown): string | null {
  const record = asRecord(config);
  return typeof record.modelProvider === "string" && record.modelProvider.length > 0
    ? record.modelProvider
    : null;
}
