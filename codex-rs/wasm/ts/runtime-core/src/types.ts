export type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";
import type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";

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
