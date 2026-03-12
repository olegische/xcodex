import type {
  AccountPayload,
  AuthRefreshReason,
  AuthStatePayload,
  ModelPresetPayload,
} from "./protocol.js";
import type { HostAuthAdapter } from "./runtime.js";

export interface AuthStateStore {
  load(): Promise<AuthStatePayload | null>;
  save(authState: AuthStatePayload): Promise<void>;
  clear(): Promise<void>;
}

export interface BrowserAuthProvider {
  readAccount(params: {
    authState: AuthStatePayload | null;
    refreshToken: boolean;
  }): Promise<{ account: AccountPayload | null; requiresOpenaiAuth: boolean }>;
  listModels(params: {
    authState: AuthStatePayload | null;
    cursor: string | null;
    limit: number | null;
  }): Promise<{ data: ModelPresetPayload[]; nextCursor: string | null }>;
  refreshAuth(params: {
    authState: AuthStatePayload | null;
    reason: AuthRefreshReason;
    previousAccountId: string | null;
  }): Promise<{
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType: string | null;
  }>;
}

export interface BrowserAuthAdapterOptions {
  store: AuthStateStore;
  provider: BrowserAuthProvider;
}

const AUTH_DB_NAME = "codex-wasm-browser-auth";
const AUTH_STORE_NAME = "auth-state";
const AUTH_RECORD_KEY = "current";

export function createBrowserAuthAdapter(
  options: BrowserAuthAdapterOptions,
): HostAuthAdapter {
  const { store, provider } = options;

  return {
    async loadAuthState() {
      return {
        authState: await store.load(),
      };
    },

    async saveAuthState(params) {
      await store.save(params.authState);
    },

    async clearAuthState() {
      await store.clear();
    },

    async readAccount(params) {
      return provider.readAccount({
        authState: await store.load(),
        refreshToken: params.refreshToken,
      });
    },

    async listModels(params) {
      return provider.listModels({
        authState: await store.load(),
        cursor: params.cursor,
        limit: params.limit,
      });
    },

    async refreshAuth(params) {
      const authState = await store.load();
      const refreshed = await provider.refreshAuth({
        authState,
        reason: params.reason,
        previousAccountId: params.previousAccountId,
      });
      if (authState !== null) {
        await store.save({
          ...authState,
          authMode: "chatgptAuthTokens",
          accessToken: refreshed.accessToken,
          chatgptAccountId: refreshed.chatgptAccountId,
          chatgptPlanType: refreshed.chatgptPlanType,
          lastRefreshAt: Math.floor(Date.now() / 1000),
        });
      }
      return refreshed;
    },
  };
}

export function createInMemoryAuthStateStore(
  initialAuthState: AuthStatePayload | null = null,
): AuthStateStore {
  let authState = initialAuthState;

  return {
    async load() {
      return authState;
    },

    async save(nextAuthState) {
      authState = nextAuthState;
    },

    async clear() {
      authState = null;
    },
  };
}

export interface IndexedDbAuthStateStoreOptions {
  dbName?: string;
  storeName?: string;
  recordKey?: string;
}

export function createIndexedDbAuthStateStore(
  options: IndexedDbAuthStateStoreOptions = {},
): AuthStateStore {
  const dbName = options.dbName ?? AUTH_DB_NAME;
  const storeName = options.storeName ?? AUTH_STORE_NAME;
  const recordKey = options.recordKey ?? AUTH_RECORD_KEY;

  return {
    async load() {
      return openAuthDb(dbName, storeName).then(
        (db) =>
          new Promise<AuthStatePayload | null>((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const request = store.get(recordKey);
            request.onsuccess = () => resolve((request.result as AuthStatePayload | undefined) ?? null);
            request.onerror = () => reject(request.error ?? new Error("failed to load auth state"));
          }),
      );
    },

    async save(authState) {
      const db = await openAuthDb(dbName, storeName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const request = store.put(authState, recordKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("failed to save auth state"));
      });
    },

    async clear() {
      const db = await openAuthDb(dbName, storeName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const request = store.delete(recordKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("failed to clear auth state"));
      });
    },
  };
}

function openAuthDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open auth db"));
  });
}
