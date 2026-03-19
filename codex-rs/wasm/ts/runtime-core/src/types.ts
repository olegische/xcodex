export type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";
import type { AskForApproval } from "../../../../app-server-protocol/schema/typescript/AskForApproval";
import type { CollaborationMode } from "../../../../app-server-protocol/schema/typescript/CollaborationMode";
import type { EventMsg } from "../../../../app-server-protocol/schema/typescript/EventMsg";
import type { Personality } from "../../../../app-server-protocol/schema/typescript/Personality";
import type { ResponseItem } from "../../../../app-server-protocol/schema/typescript/ResponseItem";
import type { SandboxPolicy } from "../../../../app-server-protocol/schema/typescript/SandboxPolicy";
import type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";

export type LoadThreadSessionRequest = {
  threadId: string;
};

export type DeleteThreadSessionRequest = {
  threadId: string;
};

export type ListThreadSessionsRequest = Record<string, never>;

export type StoredThreadSessionMetadata = {
  threadId: string;
  rolloutId: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  name: string | null;
  preview: string;
  cwd: string;
  modelProvider: string;
};

export type SessionMetaLine = JsonValue;

export type CompactedItem = {
  message: string;
  replacement_history?: ResponseItem[] | null;
};

export type TurnContextNetworkItem = {
  allowed_domains: string[];
  denied_domains: string[];
};

export type TurnContextItem = {
  turn_id?: string | null;
  trace_id?: string | null;
  cwd: string;
  current_date?: string | null;
  timezone?: string | null;
  approval_policy: AskForApproval;
  sandbox_policy: SandboxPolicy;
  network?: TurnContextNetworkItem | null;
  model: string;
  personality?: Personality;
  collaboration_mode?: CollaborationMode;
  realtime_active?: boolean | null;
  effort?: JsonValue;
  summary: JsonValue;
  user_instructions?: string | null;
  developer_instructions?: string | null;
  final_output_json_schema?: JsonValue;
};

export type RolloutItem =
  | { type: "session_meta"; payload: SessionMetaLine }
  | { type: "response_item"; payload: ResponseItem }
  | { type: "compacted"; payload: CompactedItem }
  | { type: "turn_context"; payload: TurnContextItem }
  | { type: "event_msg"; payload: EventMsg };

export type StoredThreadSession = {
  metadata: StoredThreadSessionMetadata;
  items: RolloutItem[];
};

export type SaveThreadSessionRequest = {
  session: StoredThreadSession;
};

export type LoadThreadSessionResponse = {
  session: StoredThreadSession;
};

export type ListThreadSessionsResponse = {
  sessions: StoredThreadSessionMetadata[];
};

export type RuntimeModule = {
  default(input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module): Promise<void>;
  WasmBrowserRuntime: new (host: BrowserRuntimeHost) => WasmProtocolRuntime;
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
  loadThreadSession?(request: LoadThreadSessionRequest): Promise<LoadThreadSessionResponse>;
  saveThreadSession?(request: SaveThreadSessionRequest): Promise<null>;
  deleteThreadSession?(request: DeleteThreadSessionRequest): Promise<null>;
  listThreadSessions?(request: ListThreadSessionsRequest): Promise<ListThreadSessionsResponse>;
  listDiscoverableApps?(request: JsonValue): Promise<JsonValue>;
  runModelTurn?(request: JsonValue, onEvent?: (event: unknown) => void): Promise<JsonValue>;
  emitNotification?(notification: JsonValue): Promise<void>;
  resolveMcpOauthRedirectUri?(request: JsonValue): Promise<JsonValue>;
  waitForMcpOauthCallback?(request: JsonValue): Promise<JsonValue>;
  loadMcpOauthSession?(request: JsonValue): Promise<JsonValue>;
};

export type WasmProtocolRuntime = {
  send(message: unknown): Promise<unknown>;
  nextMessage(): Promise<unknown>;
  enqueueNotification?(notification: unknown): Promise<void>;
  runtimeInfo(): unknown;
  contractVersion(): string;
};
