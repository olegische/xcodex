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

export function subscribeWorkspaceDocument(listener: () => void): () => void {
  window.addEventListener("codex:workspace-changed", listener);
  return () => {
    window.removeEventListener("codex:workspace-changed", listener);
  };
}
