import type { CodexUiPersistence, IndexedDbPersistenceOptions, IndexedDbStoreNames, StoredUserConfig } from "./types";

const DEFAULT_DB_NAME = "codexui-wasm";
const DEFAULT_DB_VERSION = 1;
const DEFAULT_STORE_NAMES: IndexedDbStoreNames = {
  authState: "authState",
  config: "config",
  sessions: "sessions",
  userConfig: "userConfig",
};

export function createIndexedDbCodexUiPersistence<TAuthState, TConfig, TSnapshot>(
  defaultConfig: TConfig,
  options: IndexedDbPersistenceOptions = {},
): CodexUiPersistence<TAuthState, TConfig, TSnapshot> {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const dbVersion = options.dbVersion ?? DEFAULT_DB_VERSION;
  const storeNames = {
    ...DEFAULT_STORE_NAMES,
    ...options.storeNames,
  };
  const authStateKey = options.authStateKey ?? "current";
  const configKey = options.configKey ?? "current";
  const userConfigKey = options.userConfigKey ?? "current";

  return {
    async loadAuthState() {
      return await readRecord<TAuthState | null>(dbName, dbVersion, storeNames.authState, authStateKey, null, storeNames);
    },
    async saveAuthState(authState) {
      await writeRecord(dbName, dbVersion, storeNames.authState, authStateKey, authState, storeNames);
    },
    async clearAuthState() {
      await deleteRecord(dbName, dbVersion, storeNames.authState, authStateKey, storeNames);
    },
    async loadConfig() {
      return await readRecord<TConfig>(dbName, dbVersion, storeNames.config, configKey, structuredClone(defaultConfig), storeNames);
    },
    async saveConfig(config) {
      await writeRecord(dbName, dbVersion, storeNames.config, configKey, config, storeNames);
    },
    async clearConfig() {
      await deleteRecord(dbName, dbVersion, storeNames.config, configKey, storeNames);
    },
    async loadSession(threadId) {
      return await readRecord<TSnapshot | null>(dbName, dbVersion, storeNames.sessions, threadId, null, storeNames);
    },
    async saveSession(snapshot, threadId) {
      await writeRecord(dbName, dbVersion, storeNames.sessions, threadId ?? inferThreadId(snapshot), snapshot, storeNames);
    },
    async deleteSession(threadId) {
      await deleteRecord(dbName, dbVersion, storeNames.sessions, threadId, storeNames);
    },
    async loadUserConfig() {
      return await readRecord<StoredUserConfig | null>(dbName, dbVersion, storeNames.userConfig, userConfigKey, null, storeNames);
    },
    async saveUserConfig(input) {
      const current = await readRecord<StoredUserConfig | null>(dbName, dbVersion, storeNames.userConfig, userConfigKey, null, storeNames);
      if (
        input.expectedVersion !== null &&
        input.expectedVersion !== undefined &&
        current !== null &&
        current.version !== input.expectedVersion
      ) {
        throw new Error(`user config version mismatch: expected ${input.expectedVersion}, got ${current.version}`);
      }
      if (
        input.expectedVersion !== null &&
        input.expectedVersion !== undefined &&
        current === null &&
        input.expectedVersion !== "0"
      ) {
        throw new Error(`user config version mismatch: expected ${input.expectedVersion}, got <missing>`);
      }
      const nextVersion = current === null ? 1 : Number.parseInt(current.version, 10) + 1;
      const next: StoredUserConfig = {
        filePath: input.filePath?.trim() || "/codex-home/config.toml",
        version: String(Number.isFinite(nextVersion) ? nextVersion : Date.now()),
        content: input.content,
      };
      await writeRecord(dbName, dbVersion, storeNames.userConfig, userConfigKey, next, storeNames);
      return next;
    },
  };
}

async function openDb(
  dbName: string,
  dbVersion: number,
  storeNames: IndexedDbStoreNames,
): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(storeNames)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`failed to open indexeddb ${dbName}`));
  });
}

async function readRecord<T>(
  dbName: string,
  dbVersion: number,
  storeName: string,
  key: string,
  fallback: T,
  storeNames: IndexedDbStoreNames,
): Promise<T> {
  const db = await openDb(dbName, dbVersion, storeNames);
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
    request.onerror = () => reject(request.error ?? new Error(`failed to read ${storeName}/${key}`));
  });
}

async function writeRecord(
  dbName: string,
  dbVersion: number,
  storeName: string,
  key: string,
  value: unknown,
  storeNames: IndexedDbStoreNames,
): Promise<void> {
  const db = await openDb(dbName, dbVersion, storeNames);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`failed to write ${storeName}/${key}`));
  });
}

async function deleteRecord(
  dbName: string,
  dbVersion: number,
  storeName: string,
  key: string,
  storeNames: IndexedDbStoreNames,
): Promise<void> {
  const db = await openDb(dbName, dbVersion, storeNames);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx.objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`failed to delete ${storeName}/${key}`));
  });
}

function inferThreadId(snapshot: unknown): string {
  if (snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const threadId = (snapshot as Record<string, unknown>).threadId;
    if (typeof threadId === "string" && threadId.length > 0) {
      return threadId;
    }
  }
  throw new Error("saveSession requires threadId or snapshot.threadId");
}
