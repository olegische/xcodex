import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_DEMO_INSTRUCTIONS,
  INSTRUCTIONS_STORAGE_KEY,
  PROVIDER_CONFIG_KEY,
  WORKSPACE_ROOT,
  WORKSPACE_STORAGE_KEY,
} from "./constants";
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open webui db"));
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

type WorkspaceFileRecord = {
  path: string;
  content: string;
};

export type WorkspaceSnapshot = {
  rootPath: string;
  files: WorkspaceFileRecord[];
};

export async function loadStoredWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  if (raw === null) {
    return {
      rootPath: WORKSPACE_ROOT,
      files: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    return {
      rootPath: typeof parsed.rootPath === "string" ? parsed.rootPath : WORKSPACE_ROOT,
      files: Array.isArray(parsed.files)
        ? parsed.files
            .filter(
              (file): file is WorkspaceFileRecord =>
                file !== null &&
                typeof file === "object" &&
                typeof file.path === "string" &&
                typeof file.content === "string",
            )
            .map((file) => ({
              path: normalizeWorkspaceFilePath(file.path),
              content: file.content,
            }))
        : [],
    };
  } catch {
    return {
      rootPath: WORKSPACE_ROOT,
      files: [],
    };
  }
}

export async function saveStoredWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  window.localStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      rootPath: WORKSPACE_ROOT,
      files: snapshot.files
        .map((file) => ({
          path: normalizeWorkspaceFilePath(file.path),
          content: file.content,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );
  window.dispatchEvent(new CustomEvent("codex:workspace-changed"));
}

export function normalizeWorkspaceFilePath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return WORKSPACE_ROOT;
  }
  if (trimmed === WORKSPACE_ROOT.replace(/^\/+/, "")) {
    return WORKSPACE_ROOT;
  }
  if (trimmed.startsWith(`${WORKSPACE_ROOT.replace(/^\/+/, "")}/`)) {
    return `/${trimmed}`;
  }
  return `${WORKSPACE_ROOT}/${trimmed}`;
}

export function normalizeWorkspaceDirectoryPath(path: string): string {
  return normalizeWorkspaceFilePath(path).replace(/\/+$/, "");
}

export function upsertWorkspaceFile(files: WorkspaceFileRecord[], nextFile: WorkspaceFileRecord): WorkspaceFileRecord[] {
  const nextFiles = files.filter((file) => file.path !== nextFile.path);
  nextFiles.push({
    path: normalizeWorkspaceFilePath(nextFile.path),
    content: nextFile.content,
  });
  nextFiles.sort((left, right) => left.path.localeCompare(right.path));
  return nextFiles;
}

export function previewWorkspaceContent(content: string, maxLength: number = 240): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength)}...`;
}

export function parentDirectory(path: string): string {
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return `/${normalized.slice(0, lastSlash)}`;
}
