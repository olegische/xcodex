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
import {
  createIndexedDbRuntimeStorage,
  DEFAULT_CODEX_CONFIG,
  PROVIDER_CONFIG_KEY,
  USER_CONFIG_STORAGE_KEY,
} from "@browser-codex/wasm-runtime-client";
import type { StoredThreadSession, StoredThreadSessionMetadata } from "@browser-codex/wasm-runtime-core";
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_DEMO_INSTRUCTIONS,
  INSTRUCTIONS_STORAGE_KEY,
  THREAD_BINDING_STORAGE_KEY,
  THREAD_RUNTIME_REVISION,
  THREAD_RUNTIME_REVISION_STORAGE_KEY,
} from "./constants";
import type {
  AuthState,
  CodexCompatibleConfig,
  DemoInstructions,
  InstructionSnapshot,
} from "./types";
import { normalizeCodexConfig, normalizeDemoInstructions } from "./utils";

const storage = createIndexedDbRuntimeStorage<
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata
>({
  dbName: DB_NAME,
  dbVersion: DB_VERSION,
  defaultConfig: DEFAULT_CODEX_CONFIG,
  normalizeConfig: normalizeCodexConfig,
  legacySessionStoreName: "sessions",
  keys: {
    providerConfig: PROVIDER_CONFIG_KEY,
    userConfig: USER_CONFIG_STORAGE_KEY,
  },
  getSessionId(session) {
    return session.metadata.threadId;
  },
  getSessionMetadata(session) {
    return session.metadata;
  },
});

export const deleteStoredThreadSession = storage.deleteSession;
export const loadStoredAuthState = storage.loadAuthState;
export const saveStoredAuthState = storage.saveAuthState;
export const clearStoredAuthState = storage.clearAuthState;
export const loadStoredCodexConfig = storage.loadConfig;
export const saveStoredCodexConfig = storage.saveConfig;
export const clearStoredCodexConfig = storage.clearConfig;
export const loadStoredUserConfig = storage.loadUserConfig;
export const saveStoredUserConfig = storage.saveUserConfig;

export async function loadStoredThreadBinding(): Promise<string | null> {
  const value = window.localStorage.getItem(THREAD_BINDING_STORAGE_KEY);
  if (value === null) {
    return null;
  }
  const threadId = value.trim();
  return threadId.length === 0 ? null : threadId;
}

export async function saveStoredThreadBinding(threadId: string): Promise<void> {
  const normalizedThreadId = threadId.trim();
  if (normalizedThreadId.length === 0) {
    throw new Error("cannot persist an empty thread id");
  }
  window.localStorage.setItem(THREAD_BINDING_STORAGE_KEY, normalizedThreadId);
}

export async function clearStoredThreadBinding(): Promise<void> {
  window.localStorage.removeItem(THREAD_BINDING_STORAGE_KEY);
}

export async function syncStoredThreadRuntimeRevision(): Promise<boolean> {
  const currentRevision = window.localStorage.getItem(THREAD_RUNTIME_REVISION_STORAGE_KEY);
  if (currentRevision === THREAD_RUNTIME_REVISION) {
    return false;
  }
  window.localStorage.setItem(THREAD_RUNTIME_REVISION_STORAGE_KEY, THREAD_RUNTIME_REVISION);
  return true;
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
