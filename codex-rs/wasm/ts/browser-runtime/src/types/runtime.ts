import type { BrowserCodexProtocolClient as InternalBrowserCodexProtocolClient } from "@browser-codex/wasm-browser-codex-runtime";
import type {
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
} from "@browser-codex/wasm-browser-codex-runtime";
import type {
  Account,
  AuthState,
  CodexCompatibleConfig,
  ModelPreset,
  StoredUserConfig,
} from "./config.ts";
import type {
  JsonValue,
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from "./core.ts";

export type BrowserCodexProtocolClient = InternalBrowserCodexProtocolClient;
export type {
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
};

export type BrowserWorkspaceAdapter = {
  readFile(request: JsonValue): Promise<JsonValue>;
  listDir(request: JsonValue): Promise<JsonValue>;
  search(request: JsonValue): Promise<JsonValue>;
  applyPatch(request: JsonValue): Promise<JsonValue>;
};

export type BrowserDynamicToolCatalogEntry = {
  toolName: string;
  toolNamespace: string;
  description: string;
  inputSchema: JsonValue;
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

export type BrowserRuntimeNotification = {
  method: string;
  params: unknown;
};

export type BrowserRuntimeClient = BrowserCodexProtocolClient & {
  loadAuthState(): Promise<AuthState | null>;
  saveAuthState(authState: AuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  listModels(request: {
    cursor: string | null;
    limit: number | null;
  }): Promise<{
    data: ModelPreset[];
    nextCursor: string | null;
  }>;
};

export type BrowserRuntimeContext = {
  runtime: BrowserRuntimeClient;
  loadConfig(): Promise<CodexCompatibleConfig>;
  saveConfig(config: CodexCompatibleConfig): Promise<void>;
  subscribe(listener: (notification: BrowserRuntimeNotification) => void): () => void;
};

export type BrowserRuntimeStorage<
  TAuthState = AuthState,
  TConfig = CodexCompatibleConfig,
  TSession = StoredThreadSession,
  TSessionMetadata = StoredThreadSessionMetadata,
> = {
  loadSession(threadId: string): Promise<TSession | null>;
  saveSession(session: TSession): Promise<void>;
  deleteSession(threadId: string): Promise<void>;
  listSessions(): Promise<TSessionMetadata[]>;
  loadAuthState(): Promise<TAuthState | null>;
  saveAuthState(authState: TAuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  loadConfig(): Promise<TConfig>;
  saveConfig(config: TConfig): Promise<void>;
  clearConfig(): Promise<void>;
  loadUserConfig(): Promise<StoredUserConfig | null>;
  saveUserConfig(input: {
    filePath?: string | null;
    expectedVersion?: string | null;
    content: string;
  }): Promise<StoredUserConfig>;
};

export type CreateIndexedDbCodexStorageOptions<
  TAuthState,
  TConfig,
  TSession,
  TSessionMetadata,
> = {
  dbName: string;
  dbVersion: number;
  defaultConfig: TConfig;
  normalizeConfig(config: TConfig): TConfig;
  legacySessionStoreName?: string | null;
  keys?: {
    authState?: string;
    providerConfig?: string;
    userConfig?: string;
  };
  storeNames?: {
    threadSessions?: string;
    authState?: string;
    providerConfig?: string;
    userConfig?: string;
  };
  getSessionId(session: TSession): string;
  getSessionMetadata(session: TSession): TSessionMetadata;
};

export type CreateBrowserCodexRuntimeContextOptions = {
  codexHome?: string;
  cwd: string;
  storage: BrowserRuntimeStorage;
  workspace: BrowserWorkspaceAdapter;
  transport?: {
    loadRuntimeModule?: () => Promise<unknown>;
    loadXrouterRuntime?: () => Promise<unknown>;
  };
  telemetry?: {
    initializePageTelemetry?: boolean;
  };
  dynamicTools?: BrowserDynamicToolExecutor;
  bootstrap?: {
    baseInstructions?: string;
    developerInstructions?: string | null;
    userInstructions?: string | null;
    ephemeral?: boolean;
  };
  requestUserInput?: (request: {
    questions: Array<{
      id: string;
      header: string;
      question: string;
      options: Array<{
        label: string;
        description: string;
      }>;
    }>;
  }) => Promise<{
    answers: Array<{
      id: string;
      value: unknown;
    }>;
  }>;
  requestBrowserToolApproval?: (
    request: BrowserToolApprovalRequest,
  ) => Promise<BrowserToolApprovalResponse>;
  readAccount?: (args: {
    authState: AuthState | null;
    config: CodexCompatibleConfig;
    allowRefresh: boolean;
  }) => Promise<{
    account: Account | null;
    requiresOpenaiAuth: boolean;
  }>;
};
