import type { Thread } from "../../../../app-server-protocol/schema/typescript/v2/Thread";
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
import type {
  Account,
  AuthState,
  BrowserSecurityConfig,
  BrowserRuntimeClient,
  BrowserRuntimeContext,
  BrowserRuntimeNotification,
  BrowserRuntimeStorage,
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
  BrowserWorkspaceAdapter,
  CodexCompatibleConfig,
  CodexModelProviderConfig,
  CreateBrowserCodexRuntimeContextOptions,
  DemoInstructions,
  DemoTransportMode,
  JsonValue,
  ModelPreset,
  ProviderKind,
  RuntimeMode,
  StoredThreadSession,
  StoredThreadSessionMetadata,
  StoredUserConfig,
  XrouterProvider,
} from "xcodex-runtime/types";

export type {
  Account,
  AuthState,
  BrowserSecurityConfig,
  BrowserRuntimeClient,
  BrowserRuntimeContext,
  BrowserRuntimeNotification,
  BrowserRuntimeStorage,
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
  BrowserWorkspaceAdapter,
  CodexCompatibleConfig,
  CodexModelProviderConfig,
  CreateBrowserCodexRuntimeContextOptions,
  DemoInstructions,
  DemoTransportMode,
  JsonValue,
  ModelPreset,
  ProviderKind,
  RuntimeMode,
  StoredThreadSession,
  StoredThreadSessionMetadata,
  StoredUserConfig,
  Thread,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadRollbackParams,
  ThreadRollbackResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
  XrouterProvider,
};

export type EmbeddedClientNotification = BrowserRuntimeNotification & {
  atIso: string;
};

export type EmbeddedPendingServerRequest = {
  id: number;
  method: string;
  receivedAtIso: string;
  params: unknown;
};

export type EmbeddedPendingServerRequestReply = {
  result?: unknown;
  error?: {
    code?: number;
    message: string;
  };
};

export type BrowserToolApprovalBroker = {
  requestBrowserToolApproval(
    request: BrowserToolApprovalRequest,
  ): Promise<BrowserToolApprovalResponse>;
  subscribe(listener: (notification: EmbeddedClientNotification) => void): () => void;
  getPendingServerRequests(): Promise<EmbeddedPendingServerRequest[]>;
  replyToServerRequest(
    id: number,
    payload: EmbeddedPendingServerRequestReply,
  ): Promise<void>;
};

export type StoredThreadSummary = {
  id: string;
  rolloutId: string;
  cwd: string;
  title: string;
  createdAtIso: string;
  updatedAtIso: string;
  archived: boolean;
  lastPreview: string;
  modelProvider: string;
};

export type SearchStoredThreadSummariesResult = {
  threadIds: string[];
  indexedThreadCount: number;
};

export type CreateEmbeddedCodexClientOptions = Omit<
  CreateBrowserCodexRuntimeContextOptions,
  "workspace" | "requestBrowserToolApproval"
> & {
  workspace?: BrowserWorkspaceAdapter;
  approvalBroker?: BrowserToolApprovalBroker;
  requestBrowserToolApproval?: (
    request: BrowserToolApprovalRequest,
  ) => Promise<BrowserToolApprovalResponse>;
};

export type EmbeddedCodexClient = {
  getContext(): Promise<BrowserRuntimeContext>;
  invalidateRuntimeContext(): void;
  subscribe(listener: (notification: EmbeddedClientNotification) => void): Promise<() => void>;
  loadConfig(): Promise<Awaited<ReturnType<BrowserRuntimeContext["loadConfig"]>>>;
  saveConfig(
    config: Parameters<BrowserRuntimeContext["saveConfig"]>[0],
  ): Promise<void>;
  loadAuthState(): Promise<Awaited<ReturnType<BrowserRuntimeClient["loadAuthState"]>>>;
  saveAuthState(
    authState: Parameters<BrowserRuntimeClient["saveAuthState"]>[0],
  ): Promise<void>;
  clearAuthState(): Promise<void>;
  listModels(
    request?: { cursor?: string | null; limit?: number | null },
  ): Promise<Awaited<ReturnType<BrowserRuntimeClient["listModels"]>>>;
  getPendingServerRequests(): Promise<EmbeddedPendingServerRequest[]>;
  replyToServerRequest(
    id: number,
    payload: EmbeddedPendingServerRequestReply,
  ): Promise<void>;
  listThreads(params: ThreadListParams): Promise<ThreadListResponse>;
  readThread(params: ThreadReadParams): Promise<ThreadReadResponse>;
  startThread(params: ThreadStartParams): Promise<ThreadStartResponse>;
  resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse>;
  rollbackThread(params: ThreadRollbackParams): Promise<ThreadRollbackResponse>;
  startTurn(params: TurnStartParams): Promise<TurnStartResponse>;
  interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse>;
  listStoredThreadSummaries(): Promise<StoredThreadSummary[]>;
  searchStoredThreadSummaries(
    query: string,
    limit?: number,
  ): Promise<SearchStoredThreadSummariesResult>;
};
