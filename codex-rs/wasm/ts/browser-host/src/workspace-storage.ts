import { WORKSPACE_ROOT, WORKSPACE_STORAGE_KEY } from "./constants";

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

export function upsertWorkspaceFile(
  files: WorkspaceFileRecord[],
  nextFile: WorkspaceFileRecord,
): WorkspaceFileRecord[] {
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
