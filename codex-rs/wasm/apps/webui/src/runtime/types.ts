export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AuthState = {
  authMode: "apiKey" | "chatgpt" | "chatgptAuthTokens";
  openaiApiKey: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  chatgptAccountId: string | null;
  chatgptPlanType: string | null;
  lastRefreshAt: number | null;
};

export type Account = {
  email: string | null;
  planType: string | null;
  chatgptAccountId: string | null;
  authMode: AuthState["authMode"] | null;
};

export type DemoTransportMode = "openai" | "xrouter-browser" | "openai-compatible";

export type XrouterProvider = "deepseek" | "openai" | "openrouter" | "zai";

export type ProviderKind = "openai" | "openai_compatible" | "xrouter_browser";

export type CodexModelProviderConfig = {
  name: string;
  baseUrl: string;
  envKey: string;
  providerKind: ProviderKind;
  wireApi: "responses";
  metadata?: {
    xrouterProvider?: XrouterProvider | null;
  } | null;
};

export type CodexCompatibleConfig = {
  model: string;
  modelProvider: string;
  modelReasoningEffort: string | null;
  personality: string | null;
  modelProviders: Record<string, CodexModelProviderConfig>;
  env: Record<string, string>;
};

export type ModelPreset = {
  id: string;
  displayName: string;
  description?: string | null;
  isDefault: boolean;
  showInPicker: boolean;
  supportsApi: boolean;
};

export type RuntimeDispatch = {
  value: SessionSnapshot;
  events: RuntimeEvent[];
};

export type UserInstructions = {
  directory: string;
  text: string;
};

export type SkillInstructions = {
  name: string;
  path: string;
  contents: string;
};

export type InstructionSnapshot = {
  userInstructions: UserInstructions | null;
  skills: SkillInstructions[];
};

export type DemoInstructions = {
  baseInstructions: string;
  agentsDirectory: string;
  agentsInstructions: string;
  skillName: string;
  skillPath: string;
  skillContents: string;
};

export type SessionSnapshot = {
  threadId: string;
  metadata: JsonValue;
  items: JsonValue[];
};

export type RuntimeEvent = {
  event: string;
  payload: JsonValue;
};

export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
};

export type RuntimeActivity =
  | { type: "turnStart"; requestId: string; model: string }
  | { type: "delta"; requestId: string; text: string }
  | { type: "toolCall"; requestId: string; callId: string | null; toolName: string | null; arguments: JsonValue }
  | { type: "toolOutput"; requestId: string; callId: string | null; output: JsonValue }
  | { type: "assistantMessage"; requestId: string; content: JsonValue }
  | { type: "completed"; requestId: string; finishReason: string | null }
  | { type: "error"; requestId: string; message: string };

export type WorkspaceDebugFile = {
  path: string;
  content: string;
  bytes: number;
  preview: string;
};

export type DemoState = {
  status: string;
  isError: boolean;
  runtime: BrowserRuntime | null;
  authState: AuthState | null;
  codexConfig: CodexCompatibleConfig;
  demoInstructions: DemoInstructions;
  account: Account | null;
  requiresOpenaiAuth: boolean;
  models: ModelPreset[];
  transcript: TranscriptEntry[];
  events: JsonValue[];
  output: string;
};

export type BrowserRuntime = {
  loadAuthState(): Promise<AuthState | null>;
  saveAuthState(authState: AuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  readAccount(request: { refreshToken: boolean }): Promise<{
    account: Account | null;
    requiresOpenaiAuth: boolean;
  }>;
  listModels(request: {
    cursor: string | null;
    limit: number | null;
  }): Promise<{
    data: ModelPreset[];
    nextCursor: string | null;
  }>;
  refreshAuth(context: {
    reason: "unauthorized";
    previousAccountId: string | null;
  }): Promise<{
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType: string | null;
  }>;
  startThread(request: {
    threadId: string;
    metadata: JsonValue;
  }): Promise<RuntimeDispatch>;
  resumeThread(request: { threadId: string }): Promise<RuntimeDispatch>;
  runTurn(request: {
    threadId: string;
    turnId: string;
    input: JsonValue;
    modelPayload: JsonValue;
  }): Promise<RuntimeDispatch>;
  cancelModelTurn(requestId: string): Promise<void>;
};

export type ProviderDraft = {
  transportMode: DemoTransportMode;
  providerDisplayName: string;
  providerBaseUrl: string;
  apiKey: string;
  xrouterProvider: XrouterProvider;
  modelReasoningEffort: string;
  personality: string;
  model: string;
};

export type WebUiBootstrap = {
  runtime: BrowserRuntime;
  state: DemoState;
  providerDraft: ProviderDraft;
};

export type SendTurnResult = {
  transcript: TranscriptEntry[];
  nextTurnCounter: number;
  output: string;
};

export type RuntimeModule = {
  default(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
  WasmBrowserRuntime: new (host: BrowserRuntimeHost) => BrowserRuntime;
};

export type XrouterRuntimeModule = {
  default(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
  WasmBrowserClient: new (
    provider: string,
    baseUrl?: string | null,
    apiKey?: string | null,
  ) => XrouterBrowserClient;
};

export type XrouterBrowserClient = {
  fetchModelIds(): Promise<unknown>;
  runResponsesStream(
    requestId: string,
    request: JsonValue,
    onEvent: (event: unknown) => void,
  ): Promise<unknown>;
  cancel(requestId: string): void;
};

export type BrowserRuntimeHost = {
  loadSession(threadId: string): Promise<SessionSnapshot | null>;
  loadInstructions(threadId: string): Promise<InstructionSnapshot | null>;
  saveSession(snapshot: SessionSnapshot): Promise<void>;
  loadAuthState(): Promise<AuthState | null>;
  saveAuthState(authState: AuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  readAccount(request: { refreshToken: boolean }): Promise<JsonValue>;
  listModels(request: { cursor: string | null; limit: number | null }): Promise<JsonValue>;
  refreshAuth(context: JsonValue): Promise<JsonValue>;
  readFile(request: JsonValue): Promise<JsonValue>;
  listDir(request: JsonValue): Promise<JsonValue>;
  search(request: JsonValue): Promise<JsonValue>;
  writeFile(request: JsonValue): Promise<JsonValue>;
  applyPatch(request: JsonValue): Promise<JsonValue>;
  updatePlan(request: JsonValue): Promise<void>;
  requestUserInput(request: JsonValue): Promise<JsonValue>;
  startModelTurn(request: JsonValue): Promise<JsonValue>;
  cancelModelTurn(requestId: string): Promise<void>;
};

export type HostToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonValue;
};

export type ActiveModelRequest =
  | {
      kind: "xrouter";
      requestId: string;
      cancel: () => void;
      isCancelled: () => boolean;
    }
  | {
      kind: "responses";
      requestId: string;
      cancel: () => void;
      isCancelled: () => boolean;
    };
