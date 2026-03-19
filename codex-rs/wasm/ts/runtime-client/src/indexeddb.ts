import type { StoredUserConfig } from "./types.ts";

export type IndexedDbRuntimeStoreNames = {
  threadSessions: string;
  authState: string;
  providerConfig: string;
  userConfig: string;
};

export type IndexedDbRuntimeKeys = {
  authState: string;
  providerConfig: string;
  userConfig: string;
};

const DEFAULT_STORE_NAMES: IndexedDbRuntimeStoreNames = {
  threadSessions: "threadSessions",
  authState: "authState",
  providerConfig: "providerConfig",
  userConfig: "userConfig",
};

const DEFAULT_KEYS: IndexedDbRuntimeKeys = {
  authState: "current",
  providerConfig: "current",
  userConfig: "current",
};

export function createIndexedDbRuntimeStorage<TAuthState, TConfig, TSession, TSessionMetadata>(options: {
  dbName: string;
  dbVersion: number;
  defaultConfig: TConfig;
  normalizeConfig(config: TConfig): TConfig;
  getSessionId(session: TSession): string;
  getSessionMetadata(session: TSession): TSessionMetadata;
  legacySessionStoreName?: string | null;
  storeNames?: Partial<IndexedDbRuntimeStoreNames>;
  keys?: Partial<IndexedDbRuntimeKeys>;
}) {
  const storeNames = {
    ...DEFAULT_STORE_NAMES,
    ...options.storeNames,
  };
  const keys = {
    ...DEFAULT_KEYS,
    ...options.keys,
  };

  async function openDb(): Promise<IDBDatabase> {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(options.dbName, options.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        const legacySessionStoreName = options.legacySessionStoreName?.trim() ?? "";
        if (
          legacySessionStoreName.length > 0 &&
          legacySessionStoreName !== storeNames.threadSessions &&
          db.objectStoreNames.contains(legacySessionStoreName)
        ) {
          db.deleteObjectStore(legacySessionStoreName);
        }
        for (const storeName of Object.values(storeNames)) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`failed to open indexeddb ${options.dbName}`));
    });
  }

  async function loadSession(threadId: string): Promise<TSession | null> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames.threadSessions, "readonly");
      const request = tx.objectStore(storeNames.threadSessions).get(threadId);
      request.onsuccess = () => resolve((request.result as TSession | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("failed to load thread session"));
    });
  }

  async function saveSession(session: TSession): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames.threadSessions, "readwrite");
      const request = tx.objectStore(storeNames.threadSessions).put(session, options.getSessionId(session));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to save thread session"));
    });
  }

  async function deleteSession(threadId: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames.threadSessions, "readwrite");
      const request = tx.objectStore(storeNames.threadSessions).delete(threadId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to delete thread session"));
    });
  }

  async function listSessions(): Promise<TSessionMetadata[]> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames.threadSessions, "readonly");
      const request = tx.objectStore(storeNames.threadSessions).getAll();
      request.onsuccess = () => {
        const sessions = Array.isArray(request.result) ? (request.result as TSession[]) : [];
        resolve(sessions.map((session) => options.getSessionMetadata(session)));
      };
      request.onerror = () => reject(request.error ?? new Error("failed to list thread sessions"));
    });
  }

  async function loadAuthState(): Promise<TAuthState | null> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames.authState, "readonly");
      const request = tx.objectStore(storeNames.authState).get(keys.authState);
      request.onsuccess = () => resolve((request.result as TAuthState | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("failed to load auth state"));
    });
  }

  async function saveAuthState(authState: TAuthState): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames.authState, "readwrite");
      const request = tx.objectStore(storeNames.authState).put(authState, keys.authState);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to save auth state"));
    });
  }

  async function clearAuthState(): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames.authState, "readwrite");
      const request = tx.objectStore(storeNames.authState).delete(keys.authState);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to clear auth state"));
    });
  }

  async function loadConfig(): Promise<TConfig> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames.providerConfig, "readonly");
      const request = tx.objectStore(storeNames.providerConfig).get(keys.providerConfig);
      request.onsuccess = () =>
        resolve(
          options.normalizeConfig(
            (request.result as TConfig | undefined) ?? structuredClone(options.defaultConfig),
          ),
        );
      request.onerror = () => reject(request.error ?? new Error("failed to load provider config"));
    });
  }

  async function saveConfig(config: TConfig): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames.providerConfig, "readwrite");
      const request = tx.objectStore(storeNames.providerConfig).put(config, keys.providerConfig);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to save provider config"));
    });
  }

  async function clearConfig(): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames.providerConfig, "readwrite");
      const request = tx.objectStore(storeNames.providerConfig).delete(keys.providerConfig);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to clear provider config"));
    });
  }

  async function loadUserConfig(): Promise<StoredUserConfig | null> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames.userConfig, "readonly");
      const request = tx.objectStore(storeNames.userConfig).get(keys.userConfig);
      request.onsuccess = () => resolve((request.result as StoredUserConfig | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("failed to load user config"));
    });
  }

  async function saveUserConfig(input: {
    filePath?: string | null;
    expectedVersion?: string | null;
    content: string;
  }): Promise<StoredUserConfig> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames.userConfig, "readwrite");
      const store = tx.objectStore(storeNames.userConfig);
      const readRequest = store.get(keys.userConfig);
      readRequest.onerror = () => reject(readRequest.error ?? new Error("failed to read current user config"));
      readRequest.onsuccess = () => {
        const current = (readRequest.result as StoredUserConfig | undefined) ?? null;
        if (
          input.expectedVersion !== null &&
          input.expectedVersion !== undefined &&
          current !== null &&
          current.version !== input.expectedVersion
        ) {
          reject(new Error(`user config version mismatch: expected ${input.expectedVersion}, got ${current.version}`));
          return;
        }
        if (
          input.expectedVersion !== null &&
          input.expectedVersion !== undefined &&
          current === null &&
          input.expectedVersion !== "0"
        ) {
          reject(new Error(`user config version mismatch: expected ${input.expectedVersion}, got <missing>`));
          return;
        }
        const nextVersion = current === null ? 1 : Number.parseInt(current.version, 10) + 1;
        const next: StoredUserConfig = {
          filePath: input.filePath?.trim() || "/codex-home/config.toml",
          version: String(Number.isFinite(nextVersion) ? nextVersion : Date.now()),
          content: input.content,
        };
        const writeRequest = store.put(next, keys.userConfig);
        writeRequest.onerror = () => reject(writeRequest.error ?? new Error("failed to save user config"));
        writeRequest.onsuccess = () => resolve(next);
      };
    });
  }

  return {
    openDb,
    loadSession,
    saveSession,
    deleteSession,
    listSessions,
    loadAuthState,
    saveAuthState,
    clearAuthState,
    loadConfig,
    saveConfig,
    clearConfig,
    loadUserConfig,
    saveUserConfig,
  };
}
