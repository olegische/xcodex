import { WORKSPACE_ROOT } from "../../../apps/webui/src/runtime/constants";
import {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceDirectoryPath
} from "../../../apps/webui/src/runtime/storage";
import type { CodexUiAdapter, JsonRecord } from "./types";

const WORKSPACE_ROOTS_STATE_KEY = "codex.wasm.codexui.workspace-roots-state";
const THREAD_TITLES_KEY = "codex.wasm.codexui.thread-titles";
const UPLOADS_STORAGE_KEY = "codex.wasm.codexui.uploads";
const DEFAULT_HOME_DIRECTORY = "/codex-home";

type WorkspaceRootsState = {
  order: string[];
  labels: Record<string, string>;
  active: string[];
};

type ThreadTitleCache = {
  titles: Record<string, string>;
  order: string[];
};

type UploadEntry = {
  path: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type ThreadSummaryRow = {
  id: string;
  preview: string;
  title?: string;
  name?: string;
};

type ThreadReadPayload = {
  thread?: {
    turns?: Array<{
      items?: Array<{
        type?: string;
        text?: string;
        content?: Array<{ type?: string; text?: string }>;
        command?: string;
        aggregatedOutput?: string;
      }>;
    }>;
  };
};

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const next: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0 && !next.includes(item.trim())) {
      next.push(item.trim());
    }
  }
  return next;
}

function loadWorkspaceRootsState(): WorkspaceRootsState {
  const raw = globalThis.localStorage.getItem(WORKSPACE_ROOTS_STATE_KEY);
  if (raw === null) {
    return { order: [], labels: {}, active: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    const labelsRecord = asRecord(record?.labels) ?? {};
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(labelsRecord)) {
      if (typeof value === "string" && key.trim().length > 0) {
        labels[key] = value;
      }
    }
    return {
      order: normalizeStringArray(record?.order),
      active: normalizeStringArray(record?.active),
      labels
    };
  } catch {
    return { order: [], labels: {}, active: [] };
  }
}

function saveWorkspaceRootsState(state: WorkspaceRootsState) {
  globalThis.localStorage.setItem(WORKSPACE_ROOTS_STATE_KEY, JSON.stringify(state));
}

function loadThreadTitleCache(): ThreadTitleCache {
  const raw = globalThis.localStorage.getItem(THREAD_TITLES_KEY);
  if (raw === null) {
    return { titles: {}, order: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    const titlesRecord = asRecord(record?.titles) ?? {};
    const titles: Record<string, string> = {};
    for (const [key, value] of Object.entries(titlesRecord)) {
      if (typeof value === "string" && key.trim().length > 0) {
        titles[key] = value;
      }
    }
    return {
      titles,
      order: normalizeStringArray(record?.order)
    };
  } catch {
    return { titles: {}, order: [] };
  }
}

function saveThreadTitleCache(cache: ThreadTitleCache) {
  globalThis.localStorage.setItem(THREAD_TITLES_KEY, JSON.stringify(cache));
}

function loadUploads(): UploadEntry[] {
  const raw = globalThis.localStorage.getItem(UPLOADS_STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is UploadEntry => {
      const record = asRecord(entry);
      return (
        typeof record?.path === "string" &&
        typeof record?.name === "string" &&
        typeof record?.type === "string" &&
        typeof record?.size === "number" &&
        typeof record?.dataUrl === "string"
      );
    });
  } catch {
    return [];
  }
}

function saveUploads(entries: UploadEntry[]) {
  globalThis.localStorage.setItem(UPLOADS_STORAGE_KEY, JSON.stringify(entries));
}

function scoreFileCandidate(path: string, query: string): number {
  if (!query) {
    return 0;
  }
  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const baseName = lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
  if (baseName === lowerQuery) return 0;
  if (baseName.startsWith(lowerQuery)) return 1;
  if (baseName.includes(lowerQuery)) return 2;
  if (lowerPath.includes(`/${lowerQuery}`)) return 3;
  if (lowerPath.includes(lowerQuery)) return 4;
  return 10;
}

function extractThreadMessageText(threadReadPayload: unknown): string {
  const payload = asRecord(threadReadPayload) as ThreadReadPayload | null;
  const turns = Array.isArray(payload?.thread?.turns) ? payload.thread.turns : [];
  const parts: string[] = [];

  for (const turn of turns) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of items) {
      const type = typeof item.type === "string" ? item.type : "";
      if (type === "agentMessage" && typeof item.text === "string" && item.text.trim().length > 0) {
        parts.push(item.text.trim());
        continue;
      }
      if (type === "userMessage" && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) {
            parts.push(block.text.trim());
          }
        }
        continue;
      }
      if (type === "commandExecution") {
        if (typeof item.command === "string" && item.command.trim().length > 0) {
          parts.push(item.command.trim());
        }
        if (typeof item.aggregatedOutput === "string" && item.aggregatedOutput.trim().length > 0) {
          parts.push(item.aggregatedOutput.trim());
        }
      }
    }
  }

  return parts.join("\n").trim();
}

function isExactPhraseMatch(query: string, title: string, preview: string, messageText: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    title.toLowerCase().includes(normalized) ||
    preview.toLowerCase().includes(normalized) ||
    messageText.toLowerCase().includes(normalized)
  );
}

export async function handleCapabilityRoute(
  adapter: CodexUiAdapter,
  request: Request
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/codex-api/workspace-roots-state") {
    return jsonResponse(200, { data: loadWorkspaceRootsState() });
  }

  if (request.method === "PUT" && url.pathname === "/codex-api/workspace-roots-state") {
    const body = (await request.json()) as unknown;
    const record = asRecord(body) ?? {};
    const labelsRecord = asRecord(record.labels) ?? {};
    const labels: Record<string, string> = {};
    for (const [key, value] of Object.entries(labelsRecord)) {
      if (typeof value === "string" && key.trim().length > 0) {
        labels[key] = value;
      }
    }
    saveWorkspaceRootsState({
      order: normalizeStringArray(record.order),
      active: normalizeStringArray(record.active),
      labels
    });
    return jsonResponse(200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/codex-api/home-directory") {
    return jsonResponse(200, { data: { path: DEFAULT_HOME_DIRECTORY } });
  }

  if (request.method === "POST" && url.pathname === "/codex-api/transcribe") {
    return jsonResponse(501, {
      error: "Browser-native runtime does not provide transcription"
    });
  }

  if (request.method === "POST" && url.pathname === "/codex-api/worktree/create") {
    return jsonResponse(501, {
      error: "Browser-native runtime does not support git worktree creation"
    });
  }

  if (request.method === "POST" && url.pathname === "/codex-api/project-root") {
    const body = (await request.json()) as unknown;
    const record = asRecord(body);
    const path = typeof record?.path === "string" ? record.path.trim() : "";
    const label = typeof record?.label === "string" ? record.label.trim() : "";
    if (!path) {
      return jsonResponse(400, { error: "Missing path" });
    }
    const normalizedPath = normalizeWorkspaceDirectoryPath(path);
    const current = loadWorkspaceRootsState();
    current.order = [normalizedPath, ...current.order.filter((value) => value !== normalizedPath)];
    current.active = [normalizedPath, ...current.active.filter((value) => value !== normalizedPath)];
    if (label.length > 0) {
      current.labels[normalizedPath] = label;
    }
    saveWorkspaceRootsState(current);
    return jsonResponse(200, { data: { path: normalizedPath } });
  }

  if (request.method === "GET" && url.pathname === "/codex-api/project-root-suggestion") {
    const basePath = normalizeWorkspaceDirectoryPath(url.searchParams.get("basePath")?.trim() || WORKSPACE_ROOT);
    const roots = loadWorkspaceRootsState();
    let index = 1;
    while (index < 100000) {
      const candidateName = `New Project (${String(index)})`;
      const candidatePath = normalizeWorkspaceDirectoryPath(`${basePath}/${candidateName}`);
      const exists =
        roots.order.includes(candidatePath) ||
        roots.active.includes(candidatePath) ||
        Object.hasOwn(roots.labels, candidatePath);
      if (!exists) {
        return jsonResponse(200, { data: { name: candidateName, path: candidatePath } });
      }
      index += 1;
    }
    return jsonResponse(500, { error: "Failed to compute project name suggestion" });
  }

  if (request.method === "POST" && url.pathname === "/codex-api/composer-file-search") {
    const body = (await request.json()) as unknown;
    const record = asRecord(body);
    const cwd = typeof record?.cwd === "string" ? record.cwd.trim() : "";
    const query = typeof record?.query === "string" ? record.query.trim() : "";
    const limit =
      typeof record?.limit === "number" ? Math.max(1, Math.min(100, Math.floor(record.limit))) : 20;
    if (!cwd) {
      return jsonResponse(400, { error: "Missing cwd" });
    }
    const workspace = await loadStoredWorkspaceSnapshot();
    const normalizedCwd = normalizeWorkspaceDirectoryPath(cwd);
    const data = workspace.files
      .filter((file) => file.path === normalizedCwd || file.path.startsWith(`${normalizedCwd}/`))
      .map((file) => ({
        path: file.path,
        score: scoreFileCandidate(file.path, query)
      }))
      .filter((row) => query.length === 0 || row.score < 10)
      .sort((left, right) => (left.score - right.score) || left.path.localeCompare(right.path))
      .slice(0, limit)
      .map((row) => ({ path: row.path }));
    return jsonResponse(200, { data });
  }

  if (request.method === "GET" && url.pathname === "/codex-api/thread-titles") {
    return jsonResponse(200, { data: loadThreadTitleCache() });
  }

  if (request.method === "PUT" && url.pathname === "/codex-api/thread-titles") {
    const body = (await request.json()) as unknown;
    const record = asRecord(body);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    if (!id) {
      return jsonResponse(400, { error: "Missing id" });
    }
    const cache = loadThreadTitleCache();
    if (title.length === 0) {
      delete cache.titles[id];
      cache.order = cache.order.filter((value) => value !== id);
    } else {
      cache.titles[id] = title;
      cache.order = [id, ...cache.order.filter((value) => value !== id)];
    }
    saveThreadTitleCache(cache);
    return jsonResponse(200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/codex-api/thread-search") {
    const body = (await request.json()) as unknown;
    const record = asRecord(body);
    const query = typeof record?.query === "string" ? record.query.trim() : "";
    const limit =
      typeof record?.limit === "number" ? Math.max(1, Math.min(1000, Math.floor(record.limit))) : 200;
    if (!query) {
      return jsonResponse(200, { data: { threadIds: [], indexedThreadCount: 0 } });
    }
    const listPayload = (await adapter.rpc<{ data?: ThreadSummaryRow[] }>({
      method: "thread/list",
      params: {}
    })) ?? { data: [] };
    const threads = Array.isArray(listPayload.data) ? listPayload.data : [];
    const matchedIds: string[] = [];
    for (const thread of threads) {
      if (typeof thread?.id !== "string" || thread.id.length === 0) {
        continue;
      }
      const readPayload = await adapter.rpc<ThreadReadPayload>({
        method: "thread/read",
        params: { threadId: thread.id }
      });
      const title = typeof thread.title === "string" ? thread.title : typeof thread.name === "string" ? thread.name : "";
      const preview = typeof thread.preview === "string" ? thread.preview : "";
      const messageText = extractThreadMessageText(readPayload);
      if (isExactPhraseMatch(query, title, preview, messageText)) {
        matchedIds.push(thread.id);
        if (matchedIds.length >= limit) {
          break;
        }
      }
    }
    return jsonResponse(200, {
      data: {
        threadIds: matchedIds,
        indexedThreadCount: threads.length
      }
    });
  }

  if (
    (request.method === "GET" && url.pathname === "/codex-api/skills-hub") ||
    (request.method === "GET" && url.pathname === "/codex-api/skills-hub/readme") ||
    (request.method === "POST" && url.pathname === "/codex-api/skills-hub/install") ||
    (request.method === "POST" && url.pathname === "/codex-api/skills-hub/uninstall")
  ) {
    return jsonResponse(501, {
      error: "Browser-native runtime does not provide Skills Hub"
    });
  }

  if (request.method === "POST" && url.pathname === "/codex-api/upload-file") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonResponse(400, { error: "No file in request" });
    }
    const dataUrl = await readFileAsDataUrl(file);
    const safeName = file.name.replaceAll(/[\\/]/g, "_") || "uploaded-file";
    const path = `/uploads/${crypto.randomUUID()}/${safeName}`;
    const uploads = loadUploads();
    uploads.unshift({
      path,
      name: safeName,
      type: file.type,
      size: file.size,
      dataUrl
    });
    saveUploads(uploads.slice(0, 50));
    return jsonResponse(200, { path });
  }

  return null;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  const mime = file.type || "application/octet-stream";
  return `data:${mime};base64,${btoa(binary)}`;
}
