import {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceFilePath,
  saveStoredWorkspaceSnapshot,
  upsertWorkspaceFile,
} from "../runtime/storage";

export async function ensureWorkspaceDocument(path: string, defaultContent: string): Promise<string> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const normalizedPath = normalizeWorkspaceFilePath(path);
  const file = workspace.files.find((entry) => entry.path === normalizedPath);
  if (file !== undefined) {
    return file.content;
  }

  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: normalizedPath,
    content: defaultContent,
  });
  await saveStoredWorkspaceSnapshot(workspace);
  return defaultContent;
}

export async function upsertWorkspaceDocument(path: string, content: string): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const normalizedPath = normalizeWorkspaceFilePath(path);
  const existing = workspace.files.find((entry) => entry.path === normalizedPath);
  if (existing?.content === content) {
    return;
  }
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: normalizedPath,
    content,
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

export function subscribeWorkspaceDocument(listener: () => void): () => void {
  window.addEventListener("codex:workspace-changed", listener);
  return () => {
    window.removeEventListener("codex:workspace-changed", listener);
  };
}

export async function deleteWorkspaceDocuments(paths: string[]): Promise<void> {
  const normalizedPaths = new Set(paths.map(normalizeWorkspaceFilePath));
  const workspace = await loadStoredWorkspaceSnapshot();
  const nextFiles = workspace.files.filter((entry) => !normalizedPaths.has(entry.path));
  if (nextFiles.length === workspace.files.length) {
    return;
  }
  await saveStoredWorkspaceSnapshot({
    ...workspace,
    files: nextFiles,
  });
}
