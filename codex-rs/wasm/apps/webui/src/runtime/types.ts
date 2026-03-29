export type {
  JsonValue,
} from "@browser-codex/wasm-runtime-core/types";
export type {
  Account,
  AuthState,
  BrowserRuntimeClient,
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
  CodexCompatibleConfig,
  CodexModelProviderConfig,
  DemoInstructions,
  DemoTransportMode,
  ModelPreset,
  ProviderKind,
  StoredThreadSession,
  StoredThreadSessionMetadata,
  XrouterProvider,
} from "xcodex-embedded-client/types";
import type {
  Account,
  AuthState,
  BrowserRuntimeClient,
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
  CodexCompatibleConfig,
  DemoInstructions,
  DemoTransportMode,
  JsonValue,
  ModelPreset,
  XrouterProvider,
} from "xcodex-embedded-client/types";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import type { ThreadReadResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadReadResponse";
import type { ThreadListResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadListResponse";
import type { ThreadResumeParams } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadStartParams";
import type { ThreadStartResponse } from "../../../../../app-server-protocol/schema/typescript/v2/ThreadStartResponse";
import type { TurnInterruptParams } from "../../../../../app-server-protocol/schema/typescript/v2/TurnInterruptParams";
import type { TurnInterruptResponse } from "../../../../../app-server-protocol/schema/typescript/v2/TurnInterruptResponse";
import type { TurnStartParams } from "../../../../../app-server-protocol/schema/typescript/v2/TurnStartParams";
import type { TurnStartResponse } from "../../../../../app-server-protocol/schema/typescript/v2/TurnStartResponse";

export type UserInstructions = {
  directory: string;
  text: string;
};

export type DemoProtocolMode = "app-server" | "responses-api" | "a2a";
export type WebUiTransportMode = DemoTransportMode | "local-codex";

export type SkillInstructions = {
  name: string;
  path: string;
  contents: string;
};

export type InstructionSnapshot = {
  userInstructions: UserInstructions | null;
  skills: SkillInstructions[];
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
  protocolMode: DemoProtocolMode;
  transportMode: WebUiTransportMode;
  runtime: BrowserRuntime | null;
  authState: AuthState | null;
  codexConfig: CodexCompatibleConfig;
  demoInstructions: DemoInstructions;
  account: Account | null;
  requiresOpenaiAuth: boolean;
  models: ModelPreset[];
  threadGroups: import("../types").ThreadGroupSummary[];
  transcript: TranscriptEntry[];
  events: JsonValue[];
  output: string;
};

export type BrowserRuntime = {
  protocolMode: DemoProtocolMode;
  shutdown(): Promise<void>;
  readAccount(request: { refreshToken: boolean }): Promise<{
    account: Account | null;
    requiresOpenaiAuth: boolean;
  }>;
  threadStart(params: ThreadStartParams): Promise<ThreadStartResponse>;
  threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse>;
  listThreads?(params: {
    archived: boolean;
    limit: number;
    sortKey: string;
  }): Promise<ThreadListResponse>;
  threadRead(params: { threadId: string; includeTurns: boolean }): Promise<ThreadReadResponse>;
  turnStart(params: TurnStartParams): Promise<TurnStartResponse>;
  turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse>;
  subscribeToNotifications(listener: (notification: ServerNotification) => void): () => void;
  runResponsesTurn?(request: {
    message: string;
    model: string;
    previousResponseId: string | null;
    reasoningEffort: "low" | "medium" | "high" | null;
  }): Promise<ResponsesTurnResult>;
  runA2ATurn?(request: {
    message: string;
    model: string;
    previousTaskId: string | null;
  }): Promise<A2ATurnResult>;
} & Pick<
  BrowserRuntimeClient,
  "loadAuthState" | "saveAuthState" | "clearAuthState" | "listModels"
>;

export type ProviderDraft = {
  protocolMode: DemoProtocolMode;
  transportMode: WebUiTransportMode;
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

export type ResponsesTurnResult = {
  responseId: string;
  output: string;
};

export type A2ATurnResult = {
  taskId: string;
  output: string;
  transcript: TranscriptEntry[];
};
