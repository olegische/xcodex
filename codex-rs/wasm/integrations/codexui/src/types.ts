import type { BrowserCodexRuntimeDeps } from "@browser-codex/wasm-browser-codex-runtime";
import type { BrowserRuntimeBootstrapPayload } from "@browser-codex/wasm-browser-host/bootstrap";
import type { BrowserHostFileSystem, BrowserRuntimeHostDeps, NormalizedModelTurnRequest } from "@browser-codex/wasm-browser-host/runtime-host";
import type { JsonValue, RuntimeModule } from "@browser-codex/wasm-runtime-core/types";

export type IndexedDbStoreNames = {
  authState: string;
  config: string;
  sessions: string;
  userConfig: string;
};

export type IndexedDbPersistenceOptions = {
  dbName?: string;
  dbVersion?: number;
  storeNames?: Partial<IndexedDbStoreNames>;
  authStateKey?: string;
  configKey?: string;
  userConfigKey?: string;
};

export type StoredUserConfig = {
  filePath: string;
  version: string;
  content: string;
};

export type CodexUiPersistence<TAuthState, TConfig, TSnapshot> = {
  loadAuthState(): Promise<TAuthState | null>;
  saveAuthState(authState: TAuthState): Promise<void>;
  clearAuthState(): Promise<void>;
  loadConfig(): Promise<TConfig>;
  saveConfig(config: TConfig): Promise<void>;
  clearConfig(): Promise<void>;
  loadSession(threadId: string): Promise<TSnapshot | null>;
  saveSession(snapshot: TSnapshot, threadId?: string): Promise<void>;
  deleteSession(threadId: string): Promise<void>;
  loadUserConfig(): Promise<StoredUserConfig | null>;
  saveUserConfig(input: {
    filePath?: string | null;
    expectedVersion?: string | null;
    content: string;
  }): Promise<StoredUserConfig>;
};

export type CodexUiRuntimeHostOptions<TConfig> = BrowserHostFileSystem & {
  bootstrap: BrowserRuntimeBootstrapPayload;
  persistence: Pick<CodexUiPersistence<unknown, TConfig, unknown>, "loadUserConfig" | "saveUserConfig">;
  runNormalizedModelTurn(request: NormalizedModelTurnRequest): Promise<JsonValue>;
  listDiscoverableApps?: BrowserRuntimeHostDeps["listDiscoverableApps"];
};

export type CreateCodexUiBrowserRuntimeParams<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TDispatch,
  TEvent,
  TSnapshot,
  TRefreshAuthResult,
> = {
  runtimeModule: RuntimeModule;
  host: unknown;
  deps: BrowserCodexRuntimeDeps<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >;
  experimentalApi?: boolean;
};
