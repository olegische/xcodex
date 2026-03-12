import { WORKSPACE_ROOT } from "./constants";
import {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspaceFilePath,
  parentDirectory,
  previewWorkspaceContent,
  saveStoredWorkspaceSnapshot,
  type WorkspaceSnapshot,
  upsertWorkspaceFile,
} from "./storage";
import type { JsonValue, WorkspaceDebugFile } from "./types";
import { createHostError, normalizeHostValue } from "./utils";

type WorkspacePatchHunk = {
  oldText: string;
  newText: string;
};

type WorkspacePatchOperation =
  | { type: "add"; path: string; content: string }
  | { type: "update"; path: string; hunks: WorkspacePatchHunk[] }
  | { type: "delete"; path: string };

export async function loadWorkspaceDebugSnapshot(): Promise<WorkspaceDebugFile[]> {
  const workspace = await loadStoredWorkspaceSnapshot();
  return workspace.files.map((file) => ({
    path: file.path,
    content: file.content,
    bytes: new TextEncoder().encode(file.content).length,
    preview: previewWorkspaceContent(file.content),
  }));
}

export async function resetWorkspace(): Promise<void> {
  await saveStoredWorkspaceSnapshot({
    rootPath: WORKSPACE_ROOT,
    files: [],
  });
}

export function debugWorkspaceSnapshot(label: string, workspace: WorkspaceSnapshot, path?: string): void {
  console.info(`[webui] ${label}`, {
    path: path ?? null,
    fileCount: workspace.files.length,
    files: workspace.files.map((file) => ({
      path: file.path,
      bytes: new TextEncoder().encode(file.content).length,
      preview: previewWorkspaceContent(file.content),
    })),
  });
}

export async function readWorkspaceFile(request: JsonValue): Promise<JsonValue> {
  const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
  if (typeof normalizedRequest.path !== "string") {
    throw createHostError("invalidInput", "readFile expected path");
  }
  const workspace = await loadStoredWorkspaceSnapshot();
  const path = normalizeWorkspaceFilePath(normalizedRequest.path);
  const file = workspace.files.find((entry) => entry.path === path);
  if (file === undefined) {
    throw createHostError("notFound", `workspace file was not found: ${path}`);
  }
  return {
    path,
    content: file.content,
  };
}

export async function listWorkspaceDir(request: JsonValue): Promise<JsonValue> {
  const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
  if (typeof normalizedRequest.path !== "string") {
    throw createHostError("invalidInput", "listDir expected path");
  }
  const recursive = normalizedRequest.recursive === true;
  const workspace = await loadStoredWorkspaceSnapshot();
  const path = normalizeWorkspaceDirectoryPath(normalizedRequest.path);
  return {
    entries: workspace.files
      .filter((file) =>
        recursive ? file.path === path || file.path.startsWith(`${path}/`) : parentDirectory(file.path) === path,
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        isDir: false,
        sizeBytes: new TextEncoder().encode(file.content).length,
      })),
  };
}

export async function searchWorkspace(request: JsonValue): Promise<JsonValue> {
  const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
  if (
    typeof normalizedRequest.path !== "string" ||
    typeof normalizedRequest.query !== "string" ||
    typeof normalizedRequest.caseSensitive !== "boolean"
  ) {
    throw createHostError("invalidInput", "search expected path, query and caseSensitive");
  }
  const workspace = await loadStoredWorkspaceSnapshot();
  const path = normalizeWorkspaceDirectoryPath(normalizedRequest.path);
  const query = normalizedRequest.caseSensitive
    ? normalizedRequest.query
    : normalizedRequest.query.toLocaleLowerCase();
  return {
    matches: workspace.files
      .filter((file) => file.path === path || file.path.startsWith(`${path}/`))
      .flatMap((file) =>
        file.content.split("\n").flatMap((line, index) => {
          const candidate = normalizedRequest.caseSensitive ? line : line.toLocaleLowerCase();
          if (!candidate.includes(query)) {
            return [];
          }
          return [{ path: file.path, lineNumber: index + 1, line }];
        }),
      ),
  };
}

export async function writeWorkspaceFile(request: JsonValue): Promise<JsonValue> {
  const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
  if (typeof normalizedRequest.path !== "string" || typeof normalizedRequest.content !== "string") {
    throw createHostError("invalidInput", "writeFile expected path and content");
  }
  const workspace = await loadStoredWorkspaceSnapshot();
  const path = normalizeWorkspaceFilePath(normalizedRequest.path);
  const content = normalizedRequest.content;
  workspace.files = upsertWorkspaceFile(workspace.files, { path, content });
  await saveStoredWorkspaceSnapshot(workspace);
  return {
    path,
    bytesWritten: new TextEncoder().encode(content).length,
  };
}

export async function applyWorkspacePatch(request: JsonValue): Promise<JsonValue> {
  const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
  if (typeof normalizedRequest.patch !== "string") {
    throw createHostError("invalidInput", "applyPatch expected patch");
  }
  const workspace = await loadStoredWorkspaceSnapshot();
  const operations = parseWorkspacePatch(normalizedRequest.patch);
  const filesChanged: string[] = [];

  for (const operation of operations) {
    if (operation.type === "add") {
      const existingFile = workspace.files.find((file) => file.path === operation.path);
      if (existingFile !== undefined) {
        throw createHostError("conflict", `workspace file already exists: ${operation.path}`);
      }
      workspace.files = upsertWorkspaceFile(workspace.files, {
        path: operation.path,
        content: operation.content,
      });
      filesChanged.push(operation.path);
      continue;
    }

    if (operation.type === "delete") {
      const nextFiles = workspace.files.filter((file) => file.path !== operation.path);
      if (nextFiles.length === workspace.files.length) {
        throw createHostError("notFound", `workspace file was not found: ${operation.path}`);
      }
      workspace.files = nextFiles;
      filesChanged.push(operation.path);
      continue;
    }

    const originalFile = workspace.files.find((file) => file.path === operation.path);
    const currentContent = originalFile?.content ?? "";
    const nextContent = applyUpdateHunksToContent(currentContent, operation.hunks);
    workspace.files = upsertWorkspaceFile(workspace.files, {
      path: operation.path,
      content: nextContent,
    });
    filesChanged.push(operation.path);
  }

  await saveStoredWorkspaceSnapshot(workspace);
  debugWorkspaceSnapshot("workspace.after-apply-patch", workspace);
  return { filesChanged };
}

function applyUpdateHunksToContent(content: string, hunks: WorkspacePatchHunk[]): string {
  let cursor = 0;
  let nextContent = "";

  for (const hunk of hunks) {
    if (hunk.oldText.length === 0) {
      nextContent += content.slice(cursor, cursor) + hunk.newText;
      continue;
    }
    const matchIndex = content.indexOf(hunk.oldText, cursor);
    if (matchIndex === -1) {
      throw createHostError("conflict", "patch target block was not found in workspace file");
    }
    nextContent += content.slice(cursor, matchIndex);
    nextContent += hunk.newText;
    cursor = matchIndex + hunk.oldText.length;
  }

  nextContent += content.slice(cursor);
  return nextContent;
}

function parseWorkspacePatch(patch: string): WorkspacePatchOperation[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") {
    throw createHostError("invalidInput", "workspace patch parser expected `*** Begin Patch`");
  }

  const operations: WorkspacePatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      return operations;
    }
    if (line.startsWith("*** Add File: ")) {
      const path = normalizeWorkspaceFilePath(line.slice("*** Add File: ".length).trim());
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        if (!lines[index].startsWith("+")) {
          throw createHostError("invalidInput", "workspace patch parser expected added lines for `*** Add File:`");
        }
        contentLines.push(lines[index].slice(1));
        index += 1;
      }
      operations.push({ type: "add", path, content: contentLines.join("\n") });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      operations.push({ type: "delete", path: normalizeWorkspaceFilePath(line.slice("*** Delete File: ".length).trim()) });
      index += 1;
      continue;
    }
    if (!line.startsWith("*** Update File: ")) {
      throw createHostError("invalidInput", `workspace patch parser found an unsupported directive: ${line}`);
    }

    const path = normalizeWorkspaceFilePath(line.slice("*** Update File: ".length).trim());
    index += 1;
    const hunks: WorkspacePatchHunk[] = [];
    while (index < lines.length && !lines[index].startsWith("*** ")) {
      if (!lines[index].startsWith("@@")) {
        throw createHostError("invalidInput", "workspace patch parser expected `@@` hunk header");
      }
      index += 1;
      const oldLines: string[] = [];
      const newLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("*** ")) {
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
          throw createHostError("invalidInput", "workspace patch parser found an unsupported hunk line");
        }
        index += 1;
      }
      hunks.push({ oldText: oldLines.join("\n"), newText: newLines.join("\n") });
    }
    operations.push({ type: "update", path, hunks });
  }

  throw createHostError("invalidInput", "workspace patch parser expected `*** End Patch`");
}
