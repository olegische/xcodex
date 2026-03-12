export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type HostErrorCode =
  | "notFound"
  | "permissionDenied"
  | "invalidInput"
  | "conflict"
  | "rateLimited"
  | "timeout"
  | "unavailable"
  | "internal";

export type HostError = {
  code: HostErrorCode;
  message: string;
  retryable: boolean;
  data: JsonValue | null;
};

export type BridgeEnvelope = {
  id: string;
  payload: BridgeMessage;
};

export type BridgeMessage =
  | {
      kind: "request";
      method: BridgeRequest["method"];
      params: BridgeRequest["params"];
    }
  | {
      kind: "response";
      method: BridgeResponse["method"];
      result: BridgeResponse["result"];
    }
  | {
      kind: "event";
      event: BridgeEvent["event"];
      payload: BridgeEvent["payload"];
    };

export type BridgeRequest =
  | { method: "fsReadFile"; params: { path: string } }
  | { method: "fsListDir"; params: { path: string; recursive: boolean } }
  | {
      method: "fsSearch";
      params: { path: string; query: string; caseSensitive: boolean };
    }
  | { method: "fsWriteFile"; params: { path: string; content: string } }
  | { method: "fsApplyPatch"; params: { patch: string } }
  | { method: "authStateLoad"; params: Record<string, never> }
  | { method: "authStateSave"; params: { authState: AuthStatePayload } }
  | { method: "authStateClear"; params: Record<string, never> }
  | { method: "accountRead"; params: { refreshToken: boolean } }
  | { method: "modelList"; params: { cursor: string | null; limit: number | null } }
  | {
      method: "authRefresh";
      params: {
        reason: AuthRefreshReason;
        previousAccountId: string | null;
      };
    }
  | { method: "modelStart"; params: { requestId: string; payload: JsonValue } }
  | { method: "modelCancel"; params: { requestId: string } }
  | { method: "toolList"; params: Record<string, never> }
  | {
      method: "toolInvoke";
      params: { callId: string; toolName: string; input: JsonValue };
    }
  | { method: "toolCancel"; params: { callId: string } }
  | { method: "sessionLoad"; params: { threadId: string } }
  | { method: "sessionSave"; params: { snapshot: SessionSnapshotPayload } }
  | { method: "gitMetadata"; params: { path: string } }
  | {
      method: "mcpInvoke";
      params: { server: string; method: string; params: JsonValue };
    };

export type BridgeResponse =
  | { method: "fsReadFile"; result: { path: string; content: string } }
  | { method: "fsListDir"; result: { entries: BridgeFileEntry[] } }
  | { method: "fsSearch"; result: { matches: FsSearchMatch[] } }
  | {
      method: "fsWriteFile";
      result: { path: string; bytesWritten: number };
    }
  | { method: "fsApplyPatch"; result: { filesChanged: string[] } }
  | { method: "authStateLoad"; result: { authState: AuthStatePayload | null } }
  | { method: "authStateSave"; result: Record<string, never> }
  | { method: "authStateClear"; result: Record<string, never> }
  | {
      method: "accountRead";
      result: { account: AccountPayload | null; requiresOpenaiAuth: boolean };
    }
  | {
      method: "modelList";
      result: { data: ModelPresetPayload[]; nextCursor: string | null };
    }
  | {
      method: "authRefresh";
      result: {
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType: string | null;
      };
    }
  | { method: "modelStart"; result: { requestId: string } }
  | { method: "modelCancel"; result: Record<string, never> }
  | { method: "toolList"; result: { tools: BridgeToolSpec[] } }
  | {
      method: "toolInvoke";
      result: { callId: string; output: JsonValue };
    }
  | { method: "toolCancel"; result: Record<string, never> }
  | { method: "sessionLoad"; result: { snapshot: SessionSnapshotPayload | null } }
  | { method: "sessionSave"; result: Record<string, never> }
  | {
      method: "gitMetadata";
      result: { branch: string | null; commit: string | null; isDirty: boolean };
    }
  | { method: "mcpInvoke"; result: { result: JsonValue } }
  | { method: "error"; result: { error: HostError } };

export type BridgeEvent =
  | {
      event: "modelStarted";
      payload: { requestId: string };
    }
  | {
      event: "modelDelta";
      payload: { requestId: string; payload: JsonValue };
    }
  | {
      event: "modelCompleted";
      payload: { requestId: string };
    }
  | {
      event: "modelFailed";
      payload: { requestId: string; error: HostError };
    }
  | {
      event: "toolCallProgress";
      payload: { callId: string; payload: JsonValue };
    };

export type BridgeFileEntry = {
  path: string;
  isDir: boolean;
  sizeBytes: number | null;
};

export type FsSearchMatch = {
  path: string;
  lineNumber: number;
  line: string;
};

export type BridgeToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonValue;
};

export type AuthMode = "apiKey" | "chatgpt" | "chatgptAuthTokens";

export type AuthRefreshReason = "unauthorized";

export type AuthStatePayload = {
  authMode: AuthMode;
  openaiApiKey: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  chatgptAccountId: string | null;
  chatgptPlanType: string | null;
  lastRefreshAt: number | null;
};

export type AccountPayload = {
  email: string | null;
  planType: string | null;
  chatgptAccountId: string | null;
  authMode: AuthMode | null;
};

export type ModelPresetPayload = {
  id: string;
  displayName: string;
  isDefault: boolean;
  showInPicker: boolean;
  supportsApi: boolean;
};

export type SessionSnapshotPayload = {
  threadId: string;
  metadata: JsonValue;
  items: JsonValue[];
};
