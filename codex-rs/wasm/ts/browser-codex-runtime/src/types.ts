import type { DynamicToolSpec } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolSpec";
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
import type { JsonValue, RuntimeModule } from "@browser-codex/wasm-runtime-core/types";
import type { ServerNotification } from "../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ServerRequest } from "../../../../app-server-protocol/schema/typescript/ServerRequest";

export type BrowserDynamicToolCatalogEntry = {
  toolNamespace: string;
  toolName: string;
  description: string;
  inputSchema: DynamicToolSpec["inputSchema"];
};

export type BrowserDynamicToolExecutor = {
  list(): Promise<{
    tools: BrowserDynamicToolCatalogEntry[];
  }>;
  invoke(params: {
    callId: string;
    toolName: string;
    toolNamespace: string;
    input: JsonValue;
  }): Promise<{
    output: JsonValue;
  }>;
};

export type BrowserToolApprovalKind =
  | "code_execution"
  | "network"
  | "navigation"
  | "mutation"
  | "sensitive_read";

export type BrowserToolApprovalOption =
  | "allow_once"
  | "allow_for_session"
  | "deny"
  | "abort";

export type BrowserToolApprovalRequest = {
  approvalId: string;
  toolName: string;
  canonicalToolName: string;
  requiredScopes: string[];
  runtimeMode: "chat" | "inspect" | "interact" | "agent" | "chaos";
  origin: string;
  displayOrigin: string;
  targetOrigin: string | null;
  targetUrl: string | null;
  approvalKind: BrowserToolApprovalKind;
  reason: string;
  grantOptions: BrowserToolApprovalOption[];
};

export type BrowserToolApprovalResponse = {
  decision: BrowserToolApprovalOption;
};

export type BrowserRuntimePersistence<TAuthState, TConfig> = {
  loadAuthState(): Promise<TAuthState | null>;
  saveAuthState(authState: TAuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  loadConfig(): Promise<TConfig>;
};

export type BrowserRuntimeRequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: Array<{
    label: string;
    description: string;
  }>;
};

export type BrowserRuntimeRequestUserInputResponse = {
  answers: Array<{
    id: string;
    value: JsonValue;
  }>;
};

export type BrowserCodexProtocolClient = {
  threadStart(params: ThreadStartParams): Promise<ThreadStartResponse>;
  threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse>;
  threadRead(params: ThreadReadParams): Promise<ThreadReadResponse>;
  threadList(params: ThreadListParams): Promise<ThreadListResponse>;
  threadRollback(params: ThreadRollbackParams): Promise<ThreadRollbackResponse>;
  turnStart(params: TurnStartParams): Promise<TurnStartResponse>;
  turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse>;
  subscribeToNotifications(listener: (notification: ServerNotification) => void): () => void;
};

export type BrowserCodexRuntimeDeps<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TRefreshAuthResult,
> = {
  persistence: BrowserRuntimePersistence<TAuthState, TConfig>;
  dynamicTools: BrowserDynamicToolExecutor;
  readAccount(args: {
    authState: TAuthState | null;
    config: TConfig;
    refreshToken: boolean;
  }): Promise<{
    account: TAccount | null;
    requiresOpenaiAuth: boolean;
  }>;
  discoverModels(args: {
    config: TConfig;
    cursor: string | null;
    limit: number | null;
  }): Promise<{
    data: TModelPreset[];
    nextCursor: string | null;
  }>;
  refreshAuth(context: {
    reason: "unauthorized";
    previousAccountId: string | null;
  }): Promise<TRefreshAuthResult>;
  formatError(error: unknown): string;
  requestUserInput?(request: {
    questions: BrowserRuntimeRequestUserInputQuestion[];
  }): Promise<BrowserRuntimeRequestUserInputResponse>;
  requestBrowserToolApproval?(
    request: BrowserToolApprovalRequest,
  ): Promise<BrowserToolApprovalResponse>;
  resolveUnhandledServerRequest?(request: ServerRequest): Promise<Record<string, unknown>>;
  resolveDynamicToolTarget?(toolName: string): {
    toolNamespace: string;
    toolName: string;
  } | null;
  normalizeDynamicToolName?(tool: BrowserDynamicToolCatalogEntry): string;
  onTurnStart?(): void | Promise<void>;
  logScope?: string;
};

export type CreateBrowserCodexRuntimeParams<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TRefreshAuthResult,
> = {
  runtimeModule: RuntimeModule;
  host: unknown;
  deps: BrowserCodexRuntimeDeps<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TRefreshAuthResult
  >;
  experimentalApi?: boolean;
};
