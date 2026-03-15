import type {
  AccountPayload,
  BridgeEnvelope,
  BridgeEvent,
  BridgeFileEntry,
  BridgeRequest,
  BridgeResponse,
  BridgeToolSpec,
  AuthRefreshReason,
  AuthStatePayload,
  FsSearchMatch,
  HostError,
  JsonValue,
  ModelPresetPayload,
  SessionSnapshotPayload,
} from "./protocol.js";

export interface WasmBridgeTransport {
  send(message: BridgeEnvelope): Promise<void>;
  subscribe(listener: (message: BridgeEnvelope) => void): () => void;
}

export interface HostFsAdapter {
  readFile(params: { path: string }): Promise<{ path: string; content: string }>;
  listDir(params: {
    path: string;
    recursive: boolean;
  }): Promise<{ entries: BridgeFileEntry[] }>;
  search(params: {
    path: string;
    query: string;
    caseSensitive: boolean;
  }): Promise<{ matches: FsSearchMatch[] }>;
  writeFile(params: {
    path: string;
    content: string;
  }): Promise<{ path: string; bytesWritten: number }>;
  applyPatch(params: { patch: string }): Promise<{ filesChanged: string[] }>;
}

export interface HostModelTransportAdapter {
  start(params: {
    requestId: string;
    payload: JsonValue;
  }): Promise<{ requestId: string }>;
  cancel(params: { requestId: string }): Promise<void>;
}

export interface HostToolExecutorAdapter {
  list(): Promise<{ tools: BridgeToolSpec[] }>;
  invoke(params: {
    callId: string;
    toolName: string;
    toolNamespace?: string | null;
    input: JsonValue;
  }): Promise<{ callId: string; output: JsonValue }>;
  cancel(params: { callId: string }): Promise<void>;
}

export interface HostSessionStoreAdapter {
  load(params: { threadId: string }): Promise<{ snapshot: SessionSnapshotPayload | null }>;
  save(params: { snapshot: SessionSnapshotPayload }): Promise<void>;
}

export interface HostAuthAdapter {
  loadAuthState(): Promise<{ authState: AuthStatePayload | null }>;
  saveAuthState(params: { authState: AuthStatePayload }): Promise<void>;
  clearAuthState(): Promise<void>;
  readAccount(params: {
    refreshToken: boolean;
  }): Promise<{ account: AccountPayload | null; requiresOpenaiAuth: boolean }>;
  listModels(params: {
    cursor: string | null;
    limit: number | null;
  }): Promise<{ data: ModelPresetPayload[]; nextCursor: string | null }>;
  refreshAuth(params: {
    reason: AuthRefreshReason;
    previousAccountId: string | null;
  }): Promise<{
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType: string | null;
  }>;
}

export interface HostGitAdapter {
  metadata(params: {
    path: string;
  }): Promise<{ branch: string | null; commit: string | null; isDirty: boolean }>;
}

export interface HostMcpAdapter {
  invoke(params: {
    server: string;
    method: string;
    params: JsonValue;
  }): Promise<{ result: JsonValue }>;
}

export type HostAdapters = {
  fs: HostFsAdapter;
  modelTransport: HostModelTransportAdapter;
  toolExecutor: HostToolExecutorAdapter;
  sessionStore: HostSessionStoreAdapter;
  auth?: HostAuthAdapter;
  git?: HostGitAdapter;
  mcp?: HostMcpAdapter;
};

export class BridgeProtocolError extends Error {
  public readonly error: HostError;

  public constructor(error: HostError) {
    super(error.message);
    this.name = "BridgeProtocolError";
    this.error = error;
  }
}

function optionalAdapterUnavailable(adapter: string): BridgeProtocolError {
  return new BridgeProtocolError({
    code: "unavailable",
    message: `optional host adapter \`${adapter}\` is not configured`,
    retryable: false,
    data: {
      adapter,
    },
  });
}

export class HostRuntime {
  public constructor(private readonly adapters: HostAdapters) {}

  public async handleRequest(request: BridgeRequest): Promise<BridgeResponse> {
    switch (request.method) {
      case "fsReadFile":
        return {
          method: "fsReadFile",
          result: await this.adapters.fs.readFile(request.params),
        };
      case "fsListDir":
        return {
          method: "fsListDir",
          result: await this.adapters.fs.listDir(request.params),
        };
      case "fsSearch":
        return {
          method: "fsSearch",
          result: await this.adapters.fs.search(request.params),
        };
      case "fsWriteFile":
        return {
          method: "fsWriteFile",
          result: await this.adapters.fs.writeFile(request.params),
        };
      case "fsApplyPatch":
        return {
          method: "fsApplyPatch",
          result: await this.adapters.fs.applyPatch(request.params),
        };
      case "authStateLoad":
        if (this.adapters.auth === undefined) {
          throw optionalAdapterUnavailable("auth");
        }
        return {
          method: "authStateLoad",
          result: await this.adapters.auth.loadAuthState(),
        };
      case "authStateSave":
        if (this.adapters.auth === undefined) {
          throw optionalAdapterUnavailable("auth");
        }
        await this.adapters.auth.saveAuthState(request.params);
        return {
          method: "authStateSave",
          result: {},
        };
      case "authStateClear":
        if (this.adapters.auth === undefined) {
          throw optionalAdapterUnavailable("auth");
        }
        await this.adapters.auth.clearAuthState();
        return {
          method: "authStateClear",
          result: {},
        };
      case "accountRead":
        if (this.adapters.auth === undefined) {
          throw optionalAdapterUnavailable("auth");
        }
        return {
          method: "accountRead",
          result: await this.adapters.auth.readAccount(request.params),
        };
      case "modelList":
        if (this.adapters.auth === undefined) {
          throw optionalAdapterUnavailable("auth");
        }
        return {
          method: "modelList",
          result: await this.adapters.auth.listModels(request.params),
        };
      case "authRefresh":
        if (this.adapters.auth === undefined) {
          throw optionalAdapterUnavailable("auth");
        }
        return {
          method: "authRefresh",
          result: await this.adapters.auth.refreshAuth(request.params),
        };
      case "modelStart":
        return {
          method: "modelStart",
          result: await this.adapters.modelTransport.start(request.params),
        };
      case "modelCancel":
        await this.adapters.modelTransport.cancel(request.params);
        return {
          method: "modelCancel",
          result: {},
        };
      case "toolList":
        return {
          method: "toolList",
          result: await this.adapters.toolExecutor.list(),
        };
      case "toolInvoke":
        return {
          method: "toolInvoke",
          result: await this.adapters.toolExecutor.invoke(request.params),
        };
      case "toolCancel":
        await this.adapters.toolExecutor.cancel(request.params);
        return {
          method: "toolCancel",
          result: {},
        };
      case "sessionLoad":
        return {
          method: "sessionLoad",
          result: await this.adapters.sessionStore.load(request.params),
        };
      case "sessionSave":
        await this.adapters.sessionStore.save(request.params);
        return {
          method: "sessionSave",
          result: {},
        };
      case "gitMetadata":
        if (this.adapters.git === undefined) {
          throw optionalAdapterUnavailable("git");
        }
        return {
          method: "gitMetadata",
          result: await this.adapters.git.metadata(request.params),
        };
      case "mcpInvoke":
        if (this.adapters.mcp === undefined) {
          throw optionalAdapterUnavailable("mcp");
        }
        return {
          method: "mcpInvoke",
          result: await this.adapters.mcp.invoke(request.params),
        };
    }
  }

  public toEnvelope(id: string, response: BridgeResponse): BridgeEnvelope {
    return {
      id,
      payload: {
        kind: "response",
        method: response.method,
        result: response.result,
      },
    };
  }

  public toEventEnvelope(id: string, event: BridgeEvent): BridgeEnvelope {
    return {
      id,
      payload: {
        kind: "event",
        event: event.event,
        payload: event.payload,
      },
    };
  }
}
