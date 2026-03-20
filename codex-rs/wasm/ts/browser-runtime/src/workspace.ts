import { normalizeHostValue } from "@browser-codex/wasm-runtime-core/host-values";
import type { JsonValue } from "./types/core.ts";
import type { BrowserWorkspaceAdapter } from "./types/runtime.ts";

export const DEFAULT_WORKSPACE_ROOT = "/workspace";
export const DEFAULT_WORKSPACE_STORAGE_KEY =
  "codex.wasm.workspace.codex-browser-terminal";
export const WORKSPACE_CHANGED_EVENT = "codex:workspace-changed";

type WorkspacePatchHunk = {
  oldText: string;
  newText: string;
};

type WorkspacePatchOperation =
  | { type: "add"; path: string; content: string }
  | { type: "update"; path: string; hunks: WorkspacePatchHunk[] }
  | { type: "delete"; path: string };

export type WorkspaceFileRecord = {
  path: string;
  content: string;
};

export type WorkspaceSnapshot = {
  rootPath: string;
  files: WorkspaceFileRecord[];
};

export type WorkspaceStorageLike = Pick<Storage, "getItem" | "setItem">;

export type WorkspaceEventTargetLike = Pick<EventTarget, "dispatchEvent">;

export type LocalStorageWorkspaceAdapterOptions = {
  rootPath?: string;
  storageKey?: string;
  storage?: WorkspaceStorageLike;
  eventTarget?: WorkspaceEventTargetLike;
};

export function createLocalStorageWorkspaceAdapter(
  options: LocalStorageWorkspaceAdapterOptions = {},
): BrowserWorkspaceAdapter {
  const normalizeFilePath = (path: string): string =>
    normalizeWorkspaceFilePath(path, options);
  const normalizeDirectoryPath = (path: string): string =>
    normalizeWorkspaceDirectoryPath(path, options);

  return {
    async readFile(request: JsonValue): Promise<JsonValue> {
      const normalizedRequest = normalizeHostValue(request) as Record<
        string,
        unknown
      >;
      if (typeof normalizedRequest.path !== "string") {
        throw createHostError("invalidInput", "readFile expected path");
      }
      const workspace = await loadStoredWorkspaceSnapshot(options);
      const path = normalizeFilePath(normalizedRequest.path);
      const file = workspace.files.find((entry) => entry.path === path);
      if (file === undefined) {
        throw createHostError(
          "notFound",
          `workspace file was not found: ${path}`,
        );
      }
      return {
        path,
        content: file.content,
      };
    },

    async listDir(request: JsonValue): Promise<JsonValue> {
      const normalizedRequest = normalizeHostValue(request) as Record<
        string,
        unknown
      >;
      if (typeof normalizedRequest.path !== "string") {
        throw createHostError("invalidInput", "listDir expected path");
      }
      const recursive = normalizedRequest.recursive === true;
      const workspace = await loadStoredWorkspaceSnapshot(options);
      const path = normalizeDirectoryPath(normalizedRequest.path);
      return {
        entries: workspace.files
          .filter((file) =>
            recursive
              ? file.path === path || file.path.startsWith(`${path}/`)
              : parentDirectory(file.path) === path,
          )
          .sort((left, right) => left.path.localeCompare(right.path))
          .map((file) => ({
            path: file.path,
            isDir: false,
            sizeBytes: new TextEncoder().encode(file.content).length,
          })),
      };
    },

    async search(request: JsonValue): Promise<JsonValue> {
      const normalizedRequest = normalizeHostValue(request) as Record<
        string,
        unknown
      >;
      if (
        typeof normalizedRequest.path !== "string" ||
        typeof normalizedRequest.query !== "string" ||
        typeof normalizedRequest.caseSensitive !== "boolean"
      ) {
        throw createHostError(
          "invalidInput",
          "search expected path, query and caseSensitive",
        );
      }
      const workspace = await loadStoredWorkspaceSnapshot(options);
      const path = normalizeDirectoryPath(normalizedRequest.path);
      const query = normalizedRequest.caseSensitive
        ? normalizedRequest.query
        : normalizedRequest.query.toLocaleLowerCase();
      return {
        matches: workspace.files
          .filter((file) => file.path === path || file.path.startsWith(`${path}/`))
          .flatMap((file) =>
            file.content.split("\n").flatMap((line, index) => {
              const candidate = normalizedRequest.caseSensitive
                ? line
                : line.toLocaleLowerCase();
              if (!candidate.includes(query)) {
                return [];
              }
              return [{ path: file.path, lineNumber: index + 1, line }];
            }),
          ),
      };
    },

    async applyPatch(request: JsonValue): Promise<JsonValue> {
      const normalizedRequest = normalizeHostValue(request) as Record<
        string,
        unknown
      >;
      if (typeof normalizedRequest.patch !== "string") {
        throw createHostError("invalidInput", "applyPatch expected patch");
      }
      const workspace = await loadStoredWorkspaceSnapshot(options);
      const operations = parseWorkspacePatch(
        normalizedRequest.patch,
        normalizeFilePath,
      );
      const filesChanged: string[] = [];

      for (const operation of operations) {
        if (operation.type === "add") {
          const existingFile = workspace.files.find(
            (file) => file.path === operation.path,
          );
          if (existingFile !== undefined) {
            throw createHostError(
              "conflict",
              `workspace file already exists: ${operation.path}`,
            );
          }
          workspace.files = upsertWorkspaceFile(workspace.files, {
            path: operation.path,
            content: operation.content,
          });
          filesChanged.push(operation.path);
          continue;
        }

        if (operation.type === "delete") {
          const nextFiles = workspace.files.filter(
            (file) => file.path !== operation.path,
          );
          if (nextFiles.length === workspace.files.length) {
            throw createHostError(
              "notFound",
              `workspace file was not found: ${operation.path}`,
            );
          }
          workspace.files = nextFiles;
          filesChanged.push(operation.path);
          continue;
        }

        const originalFile = workspace.files.find(
          (file) => file.path === operation.path,
        );
        const currentContent = originalFile?.content ?? "";
        const nextContent = applyUpdateHunksToContent(
          currentContent,
          operation.hunks,
        );
        workspace.files = upsertWorkspaceFile(workspace.files, {
          path: operation.path,
          content: nextContent,
        });
        filesChanged.push(operation.path);
      }

      await saveStoredWorkspaceSnapshot(workspace, options);
      return { filesChanged };
    },
  };
}

export async function loadStoredWorkspaceSnapshot(
  options: LocalStorageWorkspaceAdapterOptions = {},
): Promise<WorkspaceSnapshot> {
  const storage = resolveWorkspaceStorage(options);
  const rootPath = resolveWorkspaceRoot(options.rootPath);
  const raw = storage.getItem(options.storageKey ?? DEFAULT_WORKSPACE_STORAGE_KEY);
  if (raw === null) {
    return {
      rootPath,
      files: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    return {
      rootPath:
        typeof parsed.rootPath === "string"
          ? normalizeWorkspaceDirectoryPath(parsed.rootPath, { rootPath })
          : rootPath,
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
              path: normalizeWorkspaceFilePath(file.path, { rootPath }),
              content: file.content,
            }))
        : [],
    };
  } catch {
    return {
      rootPath,
      files: [],
    };
  }
}

export async function saveStoredWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  options: LocalStorageWorkspaceAdapterOptions = {},
): Promise<void> {
  const storage = resolveWorkspaceStorage(options);
  const rootPath = resolveWorkspaceRoot(options.rootPath ?? snapshot.rootPath);
  storage.setItem(
    options.storageKey ?? DEFAULT_WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      rootPath,
      files: snapshot.files
        .map((file) => ({
          path: normalizeWorkspaceFilePath(file.path, { rootPath }),
          content: file.content,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );

  const eventTarget = resolveWorkspaceEventTarget(options.eventTarget);
  eventTarget?.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT));
}

export function normalizeWorkspaceFilePath(
  path: string,
  options: Pick<LocalStorageWorkspaceAdapterOptions, "rootPath"> = {},
): string {
  const rootPath = resolveWorkspaceRoot(options.rootPath);
  const normalizedRoot = rootPath.replace(/^\/+/, "");
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");

  if (trimmed.length === 0 || trimmed === normalizedRoot) {
    return rootPath;
  }
  if (trimmed.startsWith(`${normalizedRoot}/`)) {
    return `/${trimmed}`;
  }
  return `${rootPath}/${trimmed}`;
}

export function normalizeWorkspaceDirectoryPath(
  path: string,
  options: Pick<LocalStorageWorkspaceAdapterOptions, "rootPath"> = {},
): string {
  return normalizeWorkspaceFilePath(path, options).replace(/\/+$/, "");
}

export function parentDirectory(path: string): string {
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return `/${normalized.slice(0, lastSlash)}`;
}

function upsertWorkspaceFile(
  files: WorkspaceFileRecord[],
  nextFile: WorkspaceFileRecord,
): WorkspaceFileRecord[] {
  const nextFiles = files.filter((file) => file.path !== nextFile.path);
  nextFiles.push(nextFile);
  nextFiles.sort((left, right) => left.path.localeCompare(right.path));
  return nextFiles;
}

function applyUpdateHunksToContent(
  content: string,
  hunks: WorkspacePatchHunk[],
): string {
  let cursor = 0;
  let nextContent = "";

  for (const hunk of hunks) {
    if (hunk.oldText.length === 0) {
      nextContent += content.slice(cursor, cursor) + hunk.newText;
      continue;
    }
    const matchIndex = content.indexOf(hunk.oldText, cursor);
    if (matchIndex === -1) {
      throw createHostError(
        "conflict",
        "patch target block was not found in workspace file",
      );
    }
    nextContent += content.slice(cursor, matchIndex);
    nextContent += hunk.newText;
    cursor = matchIndex + hunk.oldText.length;
  }

  nextContent += content.slice(cursor);
  return nextContent;
}

function parseWorkspacePatch(
  patch: string,
  normalizeFilePath: (path: string) => string,
): WorkspacePatchOperation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.startsWith("--- ")) {
    return parseUnifiedWorkspacePatch(lines, normalizeFilePath);
  }
  if (lines[0] !== "*** Begin Patch") {
    throw createHostError(
      "invalidInput",
      "workspace patch parser expected `*** Begin Patch`",
    );
  }

  const operations: WorkspacePatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      return operations;
    }
    if (line.startsWith("*** Add File: ")) {
      const path = normalizeFilePath(line.slice("*** Add File: ".length).trim());
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        if (!lines[index].startsWith("+")) {
          throw createHostError(
            "invalidInput",
            "workspace patch parser expected added lines for `*** Add File:`",
          );
        }
        contentLines.push(lines[index].slice(1));
        index += 1;
      }
      operations.push({ type: "add", path, content: contentLines.join("\n") });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: normalizeFilePath(line.slice("*** Delete File: ".length).trim()),
      });
      index += 1;
      continue;
    }
    if (!line.startsWith("*** Update File: ")) {
      throw createHostError(
        "invalidInput",
        `workspace patch parser found an unsupported directive: ${line}`,
      );
    }

    const path = normalizeFilePath(line.slice("*** Update File: ".length).trim());
    index += 1;
    const hunks: WorkspacePatchHunk[] = [];
    while (index < lines.length && !lines[index].startsWith("*** ")) {
      if (!lines[index].startsWith("@@")) {
        throw createHostError(
          "invalidInput",
          "workspace patch parser expected `@@` hunk header",
        );
      }
      index += 1;
      const oldLines: string[] = [];
      const newLines: string[] = [];
      while (
        index < lines.length &&
        !lines[index].startsWith("@@") &&
        !lines[index].startsWith("*** ")
      ) {
        const hunkLine = lines[index];
        if (hunkLine === "\\ No newline at end of file") {
          index += 1;
          continue;
        }
        if (hunkLine.startsWith("-")) {
          oldLines.push(hunkLine.slice(1));
        } else if (hunkLine.startsWith("+")) {
          newLines.push(hunkLine.slice(1));
        } else if (hunkLine.startsWith(" ")) {
          oldLines.push(hunkLine.slice(1));
          newLines.push(hunkLine.slice(1));
        } else {
          throw createHostError(
            "invalidInput",
            "workspace patch parser found an unsupported hunk line",
          );
        }
        index += 1;
      }
      hunks.push({ oldText: oldLines.join("\n"), newText: newLines.join("\n") });
    }
    operations.push({ type: "update", path, hunks });
  }

  throw createHostError(
    "invalidInput",
    "workspace patch parser expected `*** End Patch`",
  );
}

function parseUnifiedWorkspacePatch(
  lines: string[],
  normalizeFilePath: (path: string) => string,
): WorkspacePatchOperation[] {
  const operations: WorkspacePatchOperation[] = [];
  let index = 0;

  while (index < lines.length) {
    const oldHeader = lines[index];
    if (oldHeader.trim().length === 0) {
      index += 1;
      continue;
    }
    if (!oldHeader.startsWith("--- ")) {
      throw createHostError(
        "invalidInput",
        `workspace patch parser found an unsupported unified diff header: ${oldHeader}`,
      );
    }
    const newHeader = lines[index + 1];
    if (newHeader === undefined || !newHeader.startsWith("+++ ")) {
      throw createHostError(
        "invalidInput",
        "workspace patch parser expected `+++` after unified diff `---` header",
      );
    }

    const oldPath = parseUnifiedDiffPath(
      oldHeader.slice(4).trim(),
      normalizeFilePath,
    );
    const newPath = parseUnifiedDiffPath(
      newHeader.slice(4).trim(),
      normalizeFilePath,
    );
    index += 2;

    const hunks: WorkspacePatchHunk[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.startsWith("--- ")) {
        break;
      }
      if (line.startsWith("@@")) {
        index += 1;
        const oldLines: string[] = [];
        const newLines: string[] = [];
        while (index < lines.length) {
          const hunkLine = lines[index];
          if (hunkLine.startsWith("@@") || hunkLine.startsWith("--- ")) {
            break;
          }
          if (hunkLine === "\\ No newline at end of file") {
            index += 1;
            continue;
          }
          if (hunkLine.startsWith("-")) {
            oldLines.push(hunkLine.slice(1));
          } else if (hunkLine.startsWith("+")) {
            newLines.push(hunkLine.slice(1));
          } else if (hunkLine.startsWith(" ")) {
            oldLines.push(hunkLine.slice(1));
            newLines.push(hunkLine.slice(1));
          } else {
            throw createHostError(
              "invalidInput",
              "workspace patch parser found an unsupported unified diff hunk line",
            );
          }
          index += 1;
        }
        hunks.push({ oldText: oldLines.join("\n"), newText: newLines.join("\n") });
        continue;
      }
      index += 1;
    }

    if (oldPath === null && newPath === null) {
      throw createHostError(
        "invalidInput",
        "workspace patch parser expected a real file path in unified diff headers",
      );
    }
    if (oldPath === null) {
      operations.push({
        type: "add",
        path: newPath ?? "",
        content: hunks.map((hunk) => hunk.newText).join(""),
      });
      continue;
    }
    if (newPath === null) {
      operations.push({ type: "delete", path: oldPath });
      continue;
    }
    operations.push({ type: "update", path: newPath, hunks });
  }

  return operations;
}

function parseUnifiedDiffPath(
  rawPath: string,
  normalizeFilePath: (path: string) => string,
): string | null {
  const [candidate] = rawPath.split("\t");
  if (candidate === "/dev/null") {
    return null;
  }
  const normalizedCandidate =
    candidate.startsWith("a/") || candidate.startsWith("b/")
      ? candidate.slice(2)
      : candidate;
  return normalizeFilePath(normalizedCandidate);
}

function resolveWorkspaceRoot(rootPath?: string): string {
  const trimmed = (rootPath ?? DEFAULT_WORKSPACE_ROOT)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return trimmed.length === 0 ? DEFAULT_WORKSPACE_ROOT : `/${trimmed}`;
}

function resolveWorkspaceStorage(
  options: LocalStorageWorkspaceAdapterOptions,
): WorkspaceStorageLike {
  if (options.storage !== undefined) {
    return options.storage;
  }
  if (
    typeof window !== "undefined" &&
    "localStorage" in window &&
    window.localStorage !== undefined
  ) {
    return window.localStorage;
  }
  throw createHostError(
    "unsupported",
    "localStorage is not available in this environment",
  );
}

function resolveWorkspaceEventTarget(
  eventTarget?: WorkspaceEventTargetLike,
): WorkspaceEventTargetLike | null {
  if (eventTarget !== undefined) {
    return eventTarget;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  return null;
}

function createHostError(
  code: string,
  message: string,
  data: JsonValue | null = null,
): JsonValue {
  return {
    code,
    message,
    retryable: false,
    data,
  };
}

export const createBrowserWorkspaceAdapter = createLocalStorageWorkspaceAdapter;

const defaultWorkspaceAdapter = createLocalStorageWorkspaceAdapter();

export const readWorkspaceFile = defaultWorkspaceAdapter.readFile;
export const listWorkspaceDir = defaultWorkspaceAdapter.listDir;
export const searchWorkspace = defaultWorkspaceAdapter.search;
export const applyWorkspacePatch = defaultWorkspaceAdapter.applyPatch;
