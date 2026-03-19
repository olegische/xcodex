import type { DynamicToolCallParams } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolCallResponse";
import type { ThreadListParams } from "../../../../app-server-protocol/schema/typescript/v2/ThreadListParams";
import type { ThreadListResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadListResponse";
import type { ThreadReadParams } from "../../../../app-server-protocol/schema/typescript/v2/ThreadReadParams";
import type { ThreadReadResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadReadResponse";
import type { ThreadResumeParams } from "../../../../app-server-protocol/schema/typescript/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadResumeResponse";
import type { ThreadRollbackParams } from "../../../../app-server-protocol/schema/typescript/v2/ThreadRollbackParams";
import type { ThreadRollbackResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadRollbackResponse";
import type { ThreadStartParams } from "../../../../app-server-protocol/schema/typescript/v2/ThreadStartParams";
import type { ThreadStartResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { TurnInterruptParams } from "../../../../app-server-protocol/schema/typescript/v2/TurnInterruptParams";
import type { TurnInterruptResponse } from "../../../../app-server-protocol/schema/typescript/v2/TurnInterruptResponse";
import type { TurnStartParams } from "../../../../app-server-protocol/schema/typescript/v2/TurnStartParams";
import type { TurnStartResponse } from "../../../../app-server-protocol/schema/typescript/v2/TurnStartResponse";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";
import {
  AppServerClient,
  asDynamicToolContentItems,
  BrowserAppServerRuntimeCore,
  qualifyDynamicToolName,
  resolveDynamicToolTarget,
  startBrowserAppServerClient,
} from "@browser-codex/wasm-runtime-core";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import type {
  BrowserCodexProtocolClient,
  BrowserCodexRuntimeDeps,
  CreateBrowserCodexRuntimeParams,
} from "./types";

export class BrowserCodexRuntime<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TRefreshAuthResult,
> extends BrowserAppServerRuntimeCore implements BrowserCodexProtocolClient {
  private readonly deps: BrowserCodexRuntimeDeps<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TRefreshAuthResult
  >;

  constructor(
    client: AppServerClient,
    deps: BrowserCodexRuntimeDeps<
      TAuthState,
      TConfig,
      TAccount,
      TModelPreset,
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

  async threadStart(params: ThreadStartParams): Promise<ThreadStartResponse> {
    const dynamicTools = await this.buildDynamicToolSpecs();
    return await this.requestTyped<ThreadStartResponse>("thread/start", {
      ...params,
      dynamicTools,
    } as Record<string, unknown>);
  }

  async threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return await this.requestTyped<ThreadResumeResponse>("thread/resume", {
      ...params,
      threadId: this.resolveThreadId(params.threadId),
    });
  }

  async threadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return await this.requestTyped<ThreadReadResponse>("thread/read", {
      ...params,
      threadId: this.resolveThreadId(params.threadId),
    });
  }

  async threadList(params: ThreadListParams): Promise<ThreadListResponse> {
    return await this.requestTyped<ThreadListResponse>("thread/list", params);
  }

  async threadRollback(params: ThreadRollbackParams): Promise<ThreadRollbackResponse> {
    return await this.requestTyped<ThreadRollbackResponse>("thread/rollback", {
      ...params,
      threadId: this.resolveThreadId(params.threadId),
    });
  }

  async turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return await this.requestTyped<TurnStartResponse>("turn/start", {
      ...params,
      threadId: this.resolveThreadId(params.threadId),
    });
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return await this.requestTyped<TurnInterruptResponse>("turn/interrupt", {
      ...params,
      threadId: this.resolveThreadId(params.threadId),
    });
  }

  protected async handleServerRequest(request: ServerRequest): Promise<void> {
    const result = await this.resolveServerRequest(request);
    await this.client.resolveServerRequest(request.id, result as JsonValue);
  }

  private async buildDynamicToolSpecs(): Promise<Array<{
    name: string;
    description: string;
    inputSchema: JsonValue;
  }>> {
      const { tools } = await this.deps.dynamicTools.list();
    return tools.map((tool) => ({
      name: this.deps.normalizeDynamicToolName?.(tool) ?? qualifyDynamicToolName(tool),
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
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
      resolveDynamicToolTarget(toolName);

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
  TRefreshAuthResult,
>(
  params: CreateBrowserCodexRuntimeParams<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TRefreshAuthResult
  >,
): Promise<
  BrowserCodexRuntime<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TRefreshAuthResult
  >
> {
  const client = await startBrowserAppServerClient(params.runtimeModule, params.host, {
    experimentalApi: params.experimentalApi ?? true,
  });
  return new BrowserCodexRuntime(client, params.deps);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
