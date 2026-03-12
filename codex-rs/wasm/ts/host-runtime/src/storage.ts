import type { JsonValue, SessionSnapshotPayload } from "./protocol.js";
import type { HostFsAdapter } from "./runtime.js";
import type { HostSessionStoreAdapter } from "./runtime.js";

type SessionRecord = {
  threadId: string;
  metadata: JsonValue;
  inlineItems: JsonValue[] | null;
  artifactPath: string | null;
};

type WorkspaceRecord = {
  workspaceId: string;
  rootPath: string;
  inlineFiles: WorkspaceFilePayload[] | null;
  artifactPath: string | null;
};

export interface SessionIndexStore {
  get(threadId: string): Promise<SessionRecord | null>;
  set(record: SessionRecord): Promise<void>;
}

export interface SessionArtifactStore {
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export type WorkspaceFilePayload = {
  path: string;
  content: string;
};

export type WorkspaceSnapshotPayload = {
  workspaceId: string;
  rootPath: string;
  files: WorkspaceFilePayload[];
};

export interface WorkspaceIndexStore {
  get(workspaceId: string): Promise<WorkspaceRecord | null>;
  set(record: WorkspaceRecord): Promise<void>;
}

export type BrowserSessionStoreOptions = {
  indexStore: SessionIndexStore;
  artifactStore?: SessionArtifactStore;
  inlineItemsThresholdBytes?: number;
  artifactPrefix?: string;
};

export type BrowserWorkspaceStoreOptions = {
  indexStore: WorkspaceIndexStore;
  artifactStore?: SessionArtifactStore;
  inlineFilesThresholdBytes?: number;
  artifactPrefix?: string;
};

export type WorkspaceFsAdapterOptions = {
  workspaceStore: ReturnType<typeof createBrowserWorkspaceStore>;
  resolveWorkspaceId(): Promise<string>;
};

export type IndexedDbSessionIndexStoreOptions = {
  indexedDb: IDBFactory;
  dbName?: string;
  storeName?: string;
};

export type IndexedDbWorkspaceIndexStoreOptions = {
  indexedDb: IDBFactory;
  dbName?: string;
  storeName?: string;
};

export type BrowserSessionStoreFactoryOptions = {
  indexedDb: IDBFactory;
  dbName?: string;
  storeName?: string;
  opfsRoot?: FileSystemDirectoryHandle;
  inlineItemsThresholdBytes?: number;
  artifactPrefix?: string;
};

export type BrowserWorkspaceStoreFactoryOptions = {
  indexedDb: IDBFactory;
  dbName?: string;
  storeName?: string;
  opfsRoot?: FileSystemDirectoryHandle;
  inlineFilesThresholdBytes?: number;
  artifactPrefix?: string;
};

const DEFAULT_DB_NAME = "codex-wasm";
const DEFAULT_STORE_NAME = "threadSessions";
const DEFAULT_ARTIFACT_PREFIX = "threads";
const DEFAULT_WORKSPACE_STORE_NAME = "workspaces";
const DEFAULT_WORKSPACE_ARTIFACT_PREFIX = "workspaces";
const DEFAULT_INLINE_THRESHOLD_BYTES = 32 * 1024;

export function createBrowserSessionStoreAdapter(
  options: BrowserSessionStoreOptions,
): HostSessionStoreAdapter {
  const inlineItemsThresholdBytes =
    options.inlineItemsThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;
  const artifactPrefix = options.artifactPrefix ?? DEFAULT_ARTIFACT_PREFIX;

  return {
    async load(params) {
      const record = await options.indexStore.get(params.threadId);
      if (record === null) {
        return {
          snapshot: null,
        };
      }

      let items = record.inlineItems;
      if (record.artifactPath !== null) {
        if (options.artifactStore === undefined) {
          throw new Error(
            `session artifact store is required to load ${record.artifactPath}`,
          );
        }
        const payload = await options.artifactStore.readText(record.artifactPath);
        if (payload === null) {
          throw new Error(`session artifact ${record.artifactPath} was not found`);
        }
        items = parseItemsPayload(record.artifactPath, payload);
      }

      return {
        snapshot: {
          threadId: record.threadId,
          metadata: record.metadata,
          items: items ?? [],
        },
      };
    },

    async save(params) {
      const snapshot = params.snapshot;
      const encodedItems = JSON.stringify(snapshot.items);
      const encodedItemsBytes = new TextEncoder().encode(encodedItems).length;
      const shouldSpillToArtifact =
        options.artifactStore !== undefined &&
        encodedItemsBytes > inlineItemsThresholdBytes;
      const existingRecord = await options.indexStore.get(snapshot.threadId);

      let artifactPath: string | null = null;
      let inlineItems: JsonValue[] | null = snapshot.items;

      if (shouldSpillToArtifact) {
        artifactPath = buildArtifactPath(artifactPrefix, snapshot.threadId);
        inlineItems = null;
        await options.artifactStore!.writeText(artifactPath, encodedItems);
      } else if (options.artifactStore !== undefined) {
        const staleArtifactPath = existingRecord?.artifactPath;
        if (staleArtifactPath !== undefined && staleArtifactPath !== null) {
          await options.artifactStore.delete(staleArtifactPath);
        }
      }

      await options.indexStore.set({
        threadId: snapshot.threadId,
        metadata: snapshot.metadata,
        inlineItems,
        artifactPath,
      });
    },
  };
}

export function createBrowserWorkspaceStore(
  options: BrowserWorkspaceStoreOptions,
): {
  load(params: {
    workspaceId: string;
  }): Promise<{ snapshot: WorkspaceSnapshotPayload | null }>;
  save(params: {
    snapshot: WorkspaceSnapshotPayload;
  }): Promise<void>;
} {
  const inlineFilesThresholdBytes =
    options.inlineFilesThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;
  const artifactPrefix =
    options.artifactPrefix ?? DEFAULT_WORKSPACE_ARTIFACT_PREFIX;

  return {
    async load(params) {
      const record = await options.indexStore.get(params.workspaceId);
      if (record === null) {
        return {
          snapshot: null,
        };
      }

      let files = record.inlineFiles;
      if (record.artifactPath !== null) {
        if (options.artifactStore === undefined) {
          throw new Error(
            `workspace artifact store is required to load ${record.artifactPath}`,
          );
        }
        const payload = await options.artifactStore.readText(record.artifactPath);
        if (payload === null) {
          throw new Error(`workspace artifact ${record.artifactPath} was not found`);
        }
        files = parseWorkspaceFilesPayload(record.artifactPath, payload);
      }

      return {
        snapshot: {
          workspaceId: record.workspaceId,
          rootPath: record.rootPath,
          files: files ?? [],
        },
      };
    },

    async save(params) {
      const snapshot = normalizeWorkspaceSnapshot(params.snapshot);
      const encodedFiles = JSON.stringify(snapshot.files);
      const encodedFilesBytes = new TextEncoder().encode(encodedFiles).length;
      const shouldSpillToArtifact =
        options.artifactStore !== undefined &&
        encodedFilesBytes > inlineFilesThresholdBytes;
      const existingRecord = await options.indexStore.get(snapshot.workspaceId);

      let artifactPath: string | null = null;
      let inlineFiles: WorkspaceFilePayload[] | null = snapshot.files;

      if (shouldSpillToArtifact) {
        artifactPath = buildWorkspaceArtifactPath(artifactPrefix, snapshot.workspaceId);
        inlineFiles = null;
        await options.artifactStore!.writeText(artifactPath, encodedFiles);
      } else if (options.artifactStore !== undefined) {
        const staleArtifactPath = existingRecord?.artifactPath;
        if (staleArtifactPath !== undefined && staleArtifactPath !== null) {
          await options.artifactStore.delete(staleArtifactPath);
        }
      }

      await options.indexStore.set({
        workspaceId: snapshot.workspaceId,
        rootPath: snapshot.rootPath,
        inlineFiles,
        artifactPath,
      });
    },
  };
}

export function createWorkspaceFsAdapter(
  options: WorkspaceFsAdapterOptions,
): HostFsAdapter {
  return {
    async readFile(params) {
      const snapshot = await loadRequiredWorkspaceSnapshot(options);
      const normalizedPath = normalizeWorkspaceFilePath(
        snapshot.rootPath,
        params.path,
      );
      const file = snapshot.files.find((entry) => entry.path === normalizedPath);
      if (file === undefined) {
        throw new Error(`workspace file was not found: ${normalizedPath}`);
      }
      return {
        path: file.path,
        content: file.content,
      };
    },

    async listDir(params) {
      const snapshot = await loadRequiredWorkspaceSnapshot(options);
      const normalizedPrefix = normalizeWorkspaceDirectoryPath(
        snapshot.rootPath,
        params.path,
      );
      const entries = snapshot.files
        .filter((file) =>
          params.recursive
            ? file.path.startsWith(`${normalizedPrefix}/`) ||
              file.path === normalizedPrefix
            : parentDirectory(file.path) === normalizedPrefix,
        )
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => ({
          path: file.path,
          isDir: false,
          sizeBytes: new TextEncoder().encode(file.content).length,
        }));

      return {
        entries,
      };
    },

    async search(params) {
      const snapshot = await loadRequiredWorkspaceSnapshot(options);
      const normalizedPrefix = normalizeWorkspaceDirectoryPath(
        snapshot.rootPath,
        params.path,
      );
      const query = params.caseSensitive
        ? params.query
        : params.query.toLocaleLowerCase();
      const matches = snapshot.files
        .filter(
          (file) =>
            file.path.startsWith(`${normalizedPrefix}/`) ||
            file.path === normalizedPrefix,
        )
        .flatMap((file) =>
          file.content.split("\n").flatMap((line, index) => {
            const candidate = params.caseSensitive
              ? line
              : line.toLocaleLowerCase();
            if (!candidate.includes(query)) {
              return [];
            }
            return [
              {
                path: file.path,
                lineNumber: index + 1,
                line,
              },
            ];
          }),
        );

      return {
        matches,
      };
    },

    async writeFile(params) {
      const snapshot = await loadRequiredWorkspaceSnapshot(options);
      const normalizedPath = normalizeWorkspaceFilePath(
        snapshot.rootPath,
        params.path,
      );
      const nextSnapshot = {
        ...snapshot,
        files: upsertWorkspaceFile(snapshot.files, {
          path: normalizedPath,
          content: params.content,
        }),
      };
      await options.workspaceStore.save({
        snapshot: nextSnapshot,
      });

      return {
        path: normalizedPath,
        bytesWritten: new TextEncoder().encode(params.content).length,
      };
    },

    async applyPatch(params) {
      const snapshot = await loadRequiredWorkspaceSnapshot(options);
      const parsedPatch = parseSingleFilePatch(params.patch, snapshot.rootPath);
      const originalFile = snapshot.files.find(
        (file) => file.path === parsedPatch.path,
      );
      if (originalFile === undefined) {
        throw new Error(`workspace file was not found: ${parsedPatch.path}`);
      }

      if (!originalFile.content.includes(parsedPatch.oldText)) {
        throw new Error(
          `patch target block was not found in workspace file: ${parsedPatch.path}`,
        );
      }

      const nextSnapshot = {
        ...snapshot,
        files: upsertWorkspaceFile(snapshot.files, {
          path: parsedPatch.path,
          content: originalFile.content.replace(
            parsedPatch.oldText,
            parsedPatch.newText,
          ),
        }),
      };
      await options.workspaceStore.save({
        snapshot: nextSnapshot,
      });

      return {
        filesChanged: [parsedPatch.path],
      };
    },
  };
}

export function createIndexedDbSessionIndexStore(
  options: IndexedDbSessionIndexStoreOptions,
): SessionIndexStore {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const dbPromise = openDatabase(options.indexedDb, dbName, storeName);

  return {
    async get(threadId) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(threadId);
      const [result] = await Promise.all([
        requestToPromise<SessionRecord | undefined>(request),
        waitForTransaction(transaction),
      ]);
      return result ?? null;
    },

    async set(record) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record);
      await waitForTransaction(transaction);
    },
  };
}

export function createIndexedDbWorkspaceIndexStore(
  options: IndexedDbWorkspaceIndexStoreOptions,
): WorkspaceIndexStore {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_WORKSPACE_STORE_NAME;
  const dbPromise = openDatabase(
    options.indexedDb,
    dbName,
    storeName,
    "workspaceId",
  );

  return {
    async get(workspaceId) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(workspaceId);
      const [result] = await Promise.all([
        requestToPromise<WorkspaceRecord | undefined>(request),
        waitForTransaction(transaction),
      ]);
      return result ?? null;
    },

    async set(record) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record);
      await waitForTransaction(transaction);
    },
  };
}

export function createOpfsArtifactStore(
  root: FileSystemDirectoryHandle,
): SessionArtifactStore {
  return {
    async readText(path) {
      const { directory, fileName } = splitParentPath(path);
      try {
        const parent = await getDirectoryHandle(root, directory, false);
        const fileHandle = await parent.getFileHandle(fileName);
        return await (await fileHandle.getFile()).text();
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async writeText(path, content) {
      const { directory, fileName } = splitParentPath(path);
      const parent = await getDirectoryHandle(root, directory, true);
      const fileHandle = await parent.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    },

    async delete(path) {
      const { directory, fileName } = splitParentPath(path);
      try {
        const parent = await getDirectoryHandle(root, directory, false);
        await parent.removeEntry(fileName);
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    },
  };
}

export function createIndexedDbBackedSessionStore(
  options: BrowserSessionStoreFactoryOptions,
): HostSessionStoreAdapter {
  return createBrowserSessionStoreAdapter({
    indexStore: createIndexedDbSessionIndexStore({
      indexedDb: options.indexedDb,
      dbName: options.dbName,
      storeName: options.storeName,
    }),
    artifactStore:
      options.opfsRoot === undefined
        ? undefined
        : createOpfsArtifactStore(options.opfsRoot),
    inlineItemsThresholdBytes: options.inlineItemsThresholdBytes,
    artifactPrefix: options.artifactPrefix,
  });
}

export function createIndexedDbBackedWorkspaceStore(
  options: BrowserWorkspaceStoreFactoryOptions,
): ReturnType<typeof createBrowserWorkspaceStore> {
  return createBrowserWorkspaceStore({
    indexStore: createIndexedDbWorkspaceIndexStore({
      indexedDb: options.indexedDb,
      dbName: options.dbName,
      storeName: options.storeName,
    }),
    artifactStore:
      options.opfsRoot === undefined
        ? undefined
        : createOpfsArtifactStore(options.opfsRoot),
    inlineFilesThresholdBytes: options.inlineFilesThresholdBytes,
    artifactPrefix: options.artifactPrefix,
  });
}

function buildArtifactPath(prefix: string, threadId: string): string {
  const sanitizedThreadId = threadId.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  return `${trimSlashes(prefix)}/${sanitizedThreadId}.items.json`;
}

function buildWorkspaceArtifactPath(prefix: string, workspaceId: string): string {
  const sanitizedWorkspaceId = workspaceId.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  return `${trimSlashes(prefix)}/${sanitizedWorkspaceId}.files.json`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function parseItemsPayload(path: string, payload: string): JsonValue[] {
  const parsed = JSON.parse(payload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`session artifact ${path} does not contain a JSON array`);
  }
  return parsed as JsonValue[];
}

function parseWorkspaceFilesPayload(
  path: string,
  payload: string,
): WorkspaceFilePayload[] {
  const parsed = JSON.parse(payload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`workspace artifact ${path} does not contain a JSON array`);
  }
  return parsed as WorkspaceFilePayload[];
}

async function openDatabase(
  indexedDb: IDBFactory,
  dbName: string,
  storeName: string,
  keyPath = "threadId",
): Promise<IDBDatabase> {
  const request = indexedDb.open(dbName, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName, {
        keyPath,
      });
    }
  };
  return requestToPromise(request);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexedDB request failed"));
    };
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("indexedDB transaction failed"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("indexedDB transaction aborted"));
    };
  });
}

async function getDirectoryHandle(
  root: FileSystemDirectoryHandle,
  directory: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of directory.split("/")) {
    if (segment.length === 0) {
      continue;
    }
    current = await current.getDirectoryHandle(segment, { create });
  }
  return current;
}

function splitParentPath(path: string): {
  directory: string;
  fileName: string;
} {
  const normalized = trimSlashes(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return {
      directory: "",
      fileName: normalized,
    };
  }
  return {
    directory: normalized.slice(0, lastSlash),
    fileName: normalized.slice(lastSlash + 1),
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "NotFoundError"
      : error instanceof Error
        ? error.name === "NotFoundError"
        : false
  );
}

export function createInMemorySessionIndexStore(
  initialRecords: SessionSnapshotPayload[] = [],
): SessionIndexStore {
  const records = new Map<string, SessionRecord>(
    initialRecords.map((snapshot) => [
      snapshot.threadId,
      {
        threadId: snapshot.threadId,
        metadata: snapshot.metadata,
        inlineItems: snapshot.items,
        artifactPath: null,
      },
    ]),
  );

  return {
    async get(threadId) {
      return records.get(threadId) ?? null;
    },
    async set(record) {
      records.set(record.threadId, record);
    },
  };
}

export function createInMemoryArtifactStore(): SessionArtifactStore & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>();

  return {
    files,
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, content) {
      files.set(path, content);
    },
    async delete(path) {
      files.delete(path);
    },
  };
}

export function createInMemoryWorkspaceIndexStore(
  initialRecords: WorkspaceSnapshotPayload[] = [],
): WorkspaceIndexStore {
  const records = new Map<string, WorkspaceRecord>(
    initialRecords.map((snapshot) => {
      const normalizedSnapshot = normalizeWorkspaceSnapshot(snapshot);
      return [
        normalizedSnapshot.workspaceId,
        {
          workspaceId: normalizedSnapshot.workspaceId,
          rootPath: normalizedSnapshot.rootPath,
          inlineFiles: normalizedSnapshot.files,
          artifactPath: null,
        },
      ];
    }),
  );

  return {
    async get(workspaceId) {
      return records.get(workspaceId) ?? null;
    },
    async set(record) {
      records.set(record.workspaceId, record);
    },
  };
}

function normalizeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshotPayload,
): WorkspaceSnapshotPayload {
  const rootPath = normalizeWorkspaceRoot(snapshot.rootPath);
  const files = snapshot.files.map((file) => ({
    path: normalizeWorkspaceFilePath(rootPath, file.path),
    content: file.content,
  }));

  return {
    workspaceId: snapshot.workspaceId,
    rootPath,
    files,
  };
}

function normalizeWorkspaceRoot(rootPath: string): string {
  const trimmed = trimSlashes(rootPath);
  return trimmed.length === 0 ? "/workspace" : `/${trimmed}`;
}

function normalizeWorkspaceFilePath(rootPath: string, path: string): string {
  const normalizedRoot = normalizeWorkspaceRoot(rootPath);
  const trimmedPath = trimSlashes(path);
  if (trimmedPath.length === 0) {
    return normalizedRoot;
  }
  if (trimmedPath === trimSlashes(normalizedRoot)) {
    return normalizedRoot;
  }
  if (trimmedPath.startsWith(`${trimSlashes(normalizedRoot)}/`)) {
    return `/${trimmedPath}`;
  }
  return `${normalizedRoot}/${trimmedPath}`;
}

function normalizeWorkspaceDirectoryPath(rootPath: string, path: string): string {
  return normalizeWorkspaceFilePath(rootPath, path).replace(/\/+$/, "");
}

async function loadRequiredWorkspaceSnapshot(
  options: WorkspaceFsAdapterOptions,
): Promise<WorkspaceSnapshotPayload> {
  const workspaceId = await options.resolveWorkspaceId();
  const snapshot = await options.workspaceStore.load({
    workspaceId,
  });
  if (snapshot.snapshot === null) {
    throw new Error(`workspace snapshot was not found: ${workspaceId}`);
  }
  return snapshot.snapshot;
}

function upsertWorkspaceFile(
  files: WorkspaceFilePayload[],
  nextFile: WorkspaceFilePayload,
): WorkspaceFilePayload[] {
  const nextFiles = files.filter((file) => file.path !== nextFile.path);
  nextFiles.push(nextFile);
  nextFiles.sort((left, right) => left.path.localeCompare(right.path));
  return nextFiles;
}

function parentDirectory(path: string): string {
  const normalized = trimSlashes(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return `/${normalized.slice(0, lastSlash)}`;
}

function parseSingleFilePatch(
  patch: string,
  rootPath: string,
): {
  path: string;
  oldText: string;
  newText: string;
} {
  const updateFileMatch = patch.match(/\*\*\* Update File: ([^\n]+)/);
  if (updateFileMatch === null) {
    throw new Error("workspace patch parser expected `*** Update File:`");
  }

  const bodyMatch = patch.match(/@@\n([\s\S]+)\n\*\*\* End Patch/);
  if (bodyMatch === null) {
    throw new Error("workspace patch parser expected a single `@@` hunk");
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of bodyMatch[1].split("\n")) {
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }

  return {
    path: normalizeWorkspaceFilePath(rootPath, updateFileMatch[1]),
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
  };
}
