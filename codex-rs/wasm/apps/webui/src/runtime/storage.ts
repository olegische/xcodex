import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_DEMO_INSTRUCTIONS,
  INSTRUCTIONS_STORAGE_KEY,
  PROVIDER_CONFIG_KEY,
  USER_CONFIG_STORAGE_KEY,
  WORKSPACE_ROOT,
} from "./constants";
import {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspaceFilePath,
  parentDirectory,
  previewWorkspaceContent,
  saveStoredWorkspaceSnapshot,
  upsertWorkspaceFile,
  type WorkspaceSnapshot,
} from "@browser-codex/wasm-browser-host/workspace-storage";
import type {
  AuthState,
  CodexCompatibleConfig,
  DemoInstructions,
  InstructionSnapshot,
  SessionSnapshot,
} from "./types";
import { normalizeCodexConfig, normalizeDemoInstructions } from "./utils";
import { DEFAULT_CODEX_CONFIG } from "./constants";

export async function openWebUiDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions");
      }
      if (!db.objectStoreNames.contains("authState")) {
        db.createObjectStore("authState");
      }
      if (!db.objectStoreNames.contains("providerConfig")) {
        db.createObjectStore("providerConfig");
      }
      if (!db.objectStoreNames.contains("userConfig")) {
        db.createObjectStore("userConfig");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open webui db"));
  });
}

type StoredUserConfig = {
  filePath: string;
  version: string;
  content: string;
};

export async function loadStoredUserConfig(): Promise<StoredUserConfig | null> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("userConfig", "readonly");
    const request = tx.objectStore("userConfig").get(USER_CONFIG_STORAGE_KEY);
    request.onsuccess = () => resolve((request.result as StoredUserConfig | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("failed to load user config"));
  });
}

export async function saveStoredUserConfig(input: {
  filePath?: string | null;
  expectedVersion?: string | null;
  content: string;
}): Promise<StoredUserConfig> {
  const db = await openWebUiDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction("userConfig", "readwrite");
    const store = tx.objectStore("userConfig");
    const readRequest = store.get(USER_CONFIG_STORAGE_KEY);
    readRequest.onerror = () =>
      reject(readRequest.error ?? new Error("failed to read current user config"));
    readRequest.onsuccess = () => {
      const current = (readRequest.result as StoredUserConfig | undefined) ?? null;
      if (
        input.expectedVersion !== null &&
        input.expectedVersion !== undefined &&
        current !== null &&
        current.version !== input.expectedVersion
      ) {
        reject(
          new Error(
            `user config version mismatch: expected ${input.expectedVersion}, got ${current.version}`,
          ),
        );
        return;
      }

      if (
        (input.expectedVersion !== null && input.expectedVersion !== undefined) &&
        current === null &&
        input.expectedVersion !== "0"
      ) {
        reject(
          new Error(
            `user config version mismatch: expected ${input.expectedVersion}, got <missing>`,
          ),
        );
        return;
      }

      const nextVersion = current === null ? 1 : Number.parseInt(current.version, 10) + 1;
      const next: StoredUserConfig = {
        filePath: input.filePath?.trim() || "/codex-home/config.toml",
        version: String(Number.isFinite(nextVersion) ? nextVersion : Date.now()),
        content: input.content,
      };
      const writeRequest = store.put(next, USER_CONFIG_STORAGE_KEY);
      writeRequest.onerror = () =>
        reject(writeRequest.error ?? new Error("failed to save user config"));
      writeRequest.onsuccess = () => resolve(next);
    };
  });
}

export async function loadStoredSession(threadId: string): Promise<SessionSnapshot | null> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const request = tx.objectStore("sessions").get(threadId);
    request.onsuccess = () => resolve((request.result as SessionSnapshot | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("failed to load session"));
  });
}

export async function saveStoredSession(snapshot: SessionSnapshot): Promise<void> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    const request = tx.objectStore("sessions").put(snapshot, snapshot.threadId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to save session"));
  });
}

export async function deleteStoredSession(threadId: string): Promise<void> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    const request = tx.objectStore("sessions").delete(threadId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to delete session"));
  });
}

export async function loadStoredAuthState(): Promise<AuthState | null> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("authState", "readonly");
    const request = tx.objectStore("authState").get("current");
    request.onsuccess = () => resolve((request.result as AuthState | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("failed to load auth state"));
  });
}

export async function saveStoredAuthState(authState: AuthState): Promise<void> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("authState", "readwrite");
    const request = tx.objectStore("authState").put(authState, "current");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to save auth state"));
  });
}

export async function clearStoredAuthState(): Promise<void> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("authState", "readwrite");
    const request = tx.objectStore("authState").delete("current");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to clear auth state"));
  });
}

export async function loadStoredCodexConfig(): Promise<CodexCompatibleConfig> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("providerConfig", "readonly");
    const request = tx.objectStore("providerConfig").get(PROVIDER_CONFIG_KEY);
    request.onsuccess = () =>
      resolve(normalizeCodexConfig((request.result as CodexCompatibleConfig | undefined) ?? DEFAULT_CODEX_CONFIG));
    request.onerror = () => reject(request.error ?? new Error("failed to load provider config"));
  });
}

export async function saveStoredCodexConfig(codexConfig: CodexCompatibleConfig): Promise<void> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("providerConfig", "readwrite");
    const request = tx.objectStore("providerConfig").put(codexConfig, PROVIDER_CONFIG_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to save provider config"));
  });
}

export async function clearStoredCodexConfig(): Promise<void> {
  const db = await openWebUiDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("providerConfig", "readwrite");
    const request = tx.objectStore("providerConfig").delete(PROVIDER_CONFIG_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("failed to clear provider config"));
  });
}

export async function loadStoredDemoInstructions(): Promise<DemoInstructions> {
  const raw = window.localStorage.getItem(INSTRUCTIONS_STORAGE_KEY);
  if (raw === null) {
    return structuredClone(DEFAULT_DEMO_INSTRUCTIONS);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("failed to parse stored browser instructions");
  }

  const payload = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const userInstructions =
    payload.userInstructions !== null && typeof payload.userInstructions === "object"
      ? (payload.userInstructions as Record<string, unknown>)
      : null;
  const skills = Array.isArray(payload.skills) ? payload.skills : [];
  const firstSkill =
    skills[0] !== null && typeof skills[0] === "object" ? (skills[0] as Record<string, unknown>) : null;

  return normalizeDemoInstructions({
    baseInstructions: typeof payload.baseInstructions === "string" ? payload.baseInstructions : "",
    agentsDirectory:
      typeof userInstructions?.directory === "string" ? userInstructions.directory : DEFAULT_DEMO_INSTRUCTIONS.agentsDirectory,
    agentsInstructions: typeof userInstructions?.text === "string" ? userInstructions.text : "",
    skillName: typeof firstSkill?.name === "string" ? firstSkill.name : DEFAULT_DEMO_INSTRUCTIONS.skillName,
    skillPath: typeof firstSkill?.path === "string" ? firstSkill.path : DEFAULT_DEMO_INSTRUCTIONS.skillPath,
    skillContents: typeof firstSkill?.contents === "string" ? firstSkill.contents : "",
  });
}

export async function loadStoredInstructionSnapshot(threadId: string): Promise<InstructionSnapshot | null> {
  const raw =
    window.localStorage.getItem(`codex.wasm.instructions.${threadId}`) ??
    window.localStorage.getItem(INSTRUCTIONS_STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`failed to parse instruction snapshot from localStorage for thread ${threadId}`);
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`instruction snapshot for thread ${threadId} must be a JSON object`);
  }

  const snapshot = parsed as {
    userInstructions?: InstructionSnapshot["userInstructions"];
    skills?: InstructionSnapshot["skills"];
  };

  return {
    userInstructions: snapshot.userInstructions ?? null,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  };
}

export {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspaceFilePath,
  parentDirectory,
  previewWorkspaceContent,
  saveStoredWorkspaceSnapshot,
  upsertWorkspaceFile,
};
export type { WorkspaceSnapshot };
