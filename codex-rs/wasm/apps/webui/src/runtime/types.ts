export type {
  BrowserRuntimeHost,
  JsonValue,
  RuntimeModule,
  WasmProtocolRuntime,
} from "@browser-codex/wasm-runtime-core/types";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ThreadReadResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadReadResponse";
import type { ThreadResumeParams } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadStartParams";
import type { ThreadStartResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { TurnInterruptParams } from "../../../../../app-server-protocol/schema/typescript/v2/TurnInterruptParams";
import type { TurnInterruptResponse } from "../../../../../app-server-protocol/schema/typescript/v2/TurnInterruptResponse";
import type { TurnStartParams } from "../../../../../app-server-protocol/schema/typescript/v2/TurnStartParams";
import type { TurnStartResponse } from "../../../../../app-server-protocol/schema/typescript/v2/TurnStartResponse";

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
  threadStart(params: ThreadStartParams): Promise<ThreadStartResponse>;
  threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse>;
  threadRead(params: { threadId: string; includeTurns: boolean }): Promise<ThreadReadResponse>;
  turnStart(params: TurnStartParams): Promise<TurnStartResponse>;
  turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse>;
  subscribeToNotifications(listener: (notification: ServerNotification) => void): () => void;
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
  turnId: string;
  events: RuntimeEvent[];
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
