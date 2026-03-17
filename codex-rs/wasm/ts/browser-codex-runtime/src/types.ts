import type { DynamicToolSpec } from "../../../../app-server-protocol/schema/typescript/v2/DynamicToolSpec";
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

export type BrowserRuntimePersistence<TAuthState, TConfig, TSnapshot> = {
  loadAuthState(): Promise<TAuthState | null>;
  saveAuthState(authState: TAuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  loadConfig(): Promise<TConfig>;
  loadSession(threadId: string): Promise<TSnapshot | null>;
  saveSession(snapshot: TSnapshot): Promise<void>;
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

export type BrowserCodexRuntimeDeps<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TDispatch,
  TEvent,
  TSnapshot,
  TRefreshAuthResult,
> = {
  persistence: BrowserRuntimePersistence<TAuthState, TConfig, TSnapshot>;
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
  normalizeThread(thread: unknown): Record<string, unknown>;
  threadToSnapshot(thread: Record<string, unknown>): TSnapshot;
  withRequestedThreadId(snapshot: TSnapshot, requestedThreadId: string): TSnapshot;
  buildDispatch(snapshot: TSnapshot, events: TEvent[]): TDispatch;
  mapNotificationToEvent(notification: ServerNotification): TEvent;
  emitRuntimeEvents(events: TEvent[]): void;
  turnIdFromRuntimeEvent(event: TEvent): string | null;
  isTurnCompletedEvent(event: TEvent): boolean;
  formatError(error: unknown): string;
  requestUserInput?(request: {
    questions: BrowserRuntimeRequestUserInputQuestion[];
  }): Promise<BrowserRuntimeRequestUserInputResponse>;
  resolveUnhandledServerRequest?(request: ServerRequest): Promise<Record<string, unknown>>;
  actualThreadIdFromSnapshot?(snapshot: TSnapshot): string | null;
  resolveDynamicToolTarget?(toolName: string): {
    toolNamespace: string;
    toolName: string;
  } | null;
  normalizeDynamicToolName?(tool: BrowserDynamicToolCatalogEntry): string;
  logScope?: string;
};

export type CreateBrowserCodexRuntimeParams<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TDispatch,
  TEvent,
  TSnapshot,
  TRefreshAuthResult,
> = {
  runtimeModule: RuntimeModule;
  host: unknown;
  deps: BrowserCodexRuntimeDeps<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >;
  experimentalApi?: boolean;
};
