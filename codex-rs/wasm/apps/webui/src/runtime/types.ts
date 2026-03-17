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
  method: string;
  params: JsonValue;
};

export type RequestUserInputOption = {
  label: string;
  description: string;
};

export type RequestUserInputQuestion = {
  header: string;
  id: string;
  question: string;
  options: RequestUserInputOption[];
};

export type RequestUserInputRequest = {
  questions: RequestUserInputQuestion[];
};

export type RequestUserInputAnswer = {
  id: string;
  value: JsonValue;
};

export type RequestUserInputResponse = {
  answers: RequestUserInputAnswer[];
};

export type TranscriptEntry = {
  role: "user" | "assistant" | "tool";
  text: string;
  summary?: string | null;
  details?: string | null;
  callId?: string | null;
};

export type RuntimeActivity =
  | { type: "turnStart"; requestId: string; model: string }
  | { type: "delta"; requestId: string; text: string }
  | { type: "toolCall"; requestId: string; callId: string | null; toolName: string | null; arguments: JsonValue }
  | { type: "toolOutput"; requestId: string; callId: string | null; output: JsonValue }
  | { type: "planUpdate"; explanation: string | null; plan: Array<{ step: string; status: string }> }
  | {
      type: "missionState";
      phase: "idle" | "observing" | "planning" | "acting" | "waiting" | "blocked" | "completed" | "failed";
      lane: "page" | "artifacts" | "idle";
      goal: string;
      summary: string;
    }
  | {
      type: "pageEvent";
      kind: "navigation" | "mutation" | "selection" | "click" | "input" | "tool" | "lifecycle";
      summary: string;
      detail: string | null;
      target: string | null;
      timestamp: number;
      data: JsonValue;
    }
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
  runtime: BrowserRuntime | null;
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
  WasmBrowserRuntime: new (host: BrowserRuntimeHost) => WasmProtocolRuntime;
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
  loadBootstrap(request: unknown): Promise<{
    codexHome: string;
    cwd?: string | null;
    model?: string | null;
    modelProviderId?: string | null;
    modelProvider?: JsonValue;
    reasoningEffort?: string | null;
    personality?: string | null;
    baseInstructions?: string | null;
    developerInstructions?: string | null;
    userInstructions?: string | null;
    apiKey?: string | null;
    ephemeral?: boolean;
  }>;
  readFile(request: JsonValue): Promise<JsonValue>;
  listDir(request: JsonValue): Promise<JsonValue>;
  search(request: JsonValue): Promise<JsonValue>;
  applyPatch(request: JsonValue): Promise<JsonValue>;
  loadUserConfig?(request: JsonValue): Promise<JsonValue>;
  saveUserConfig?(request: JsonValue): Promise<JsonValue>;
  listDiscoverableApps?(request: JsonValue): Promise<JsonValue>;
  runModelTurn?(request: JsonValue): Promise<JsonValue>;
  emitNotification?(notification: JsonValue): Promise<void>;
  resolveMcpOauthRedirectUri?(request: JsonValue): Promise<JsonValue>;
  waitForMcpOauthCallback?(request: JsonValue): Promise<JsonValue>;
};

export type WasmProtocolRuntime = {
  send(message: JsonValue): Promise<JsonValue>;
  nextMessage(): Promise<JsonValue>;
  enqueueNotification?(notification: JsonValue): Promise<void>;
  runtimeInfo(): JsonValue;
  contractVersion(): string;
};
