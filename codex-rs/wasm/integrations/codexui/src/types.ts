import type { AppServerClientStartArgs } from "@browser-codex/wasm-runtime-core/app-server-client";
import type { BrowserRuntimeHost, RuntimeModule, WasmProtocolRuntime } from "@browser-codex/wasm-runtime-core/types";
import type { RequestId } from "../../../../app-server-protocol/schema/typescript/RequestId";

export type JsonRecord = Record<string, unknown>;

export type CodexUiNotification = {
  method: string;
  params: unknown;
  atIso: string;
};

export type CodexUiPendingServerRequest = {
  id: number;
  method: string;
  params: unknown;
  receivedAtIso: string;
};

export type CodexUiServerRequestReply = {
  id: number;
  result?: unknown;
  error?: {
    code?: number;
    message: string;
    data?: unknown;
  };
};

export type CodexUiRpcBody = {
  method: string;
  params?: unknown;
};

export type CodexUiRuntimeFactoryArgs = {
  runtimeModule: RuntimeModule;
  host: BrowserRuntimeHost;
  wasmInput?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
};

export type CodexUiAdapterOptions = CodexUiRuntimeFactoryArgs & {
  client?: AppServerClientStartArgs;
};

export type CodexUiHttpCompatibility = {
  handle(request: Request): Promise<Response | null>;
  handleRpc(request: Request): Promise<Response>;
  handleMethodCatalog(): Promise<Response>;
  handleNotificationCatalog(): Promise<Response>;
  handlePendingServerRequests(): Promise<Response>;
  handleRespondServerRequest(request: Request): Promise<Response>;
  handleEvents(): Promise<Response>;
};

export type CodexUiAdapter = {
  rpc<T = unknown>(body: CodexUiRpcBody): Promise<T>;
  subscribeNotifications(cb: (notification: CodexUiNotification) => void): () => void;
  listPendingServerRequests(): Promise<CodexUiPendingServerRequest[]>;
  respondServerRequest(body: CodexUiServerRequestReply): Promise<void>;
  methodCatalog(): Promise<string[]>;
  notificationCatalog(): Promise<string[]>;
  http(): CodexUiHttpCompatibility;
  dispose(): Promise<void>;
};

export type CodexUiBrowserCompatOptions = {
  codexApiBasePath?: string;
};

export type CodexUiBrowserCompatHandle = {
  dispose(): void;
};

export type CreatedRuntime = {
  runtime: WasmProtocolRuntime;
  contractVersion: string;
};

export type PendingRequestEntry = {
  compatId: number;
  runtimeId: RequestId;
  method: string;
  params: unknown;
  receivedAtIso: string;
};
