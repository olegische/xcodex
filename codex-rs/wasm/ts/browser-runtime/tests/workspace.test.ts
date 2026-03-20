import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspacePatch,
  createLocalStorageWorkspaceAdapter,
  listWorkspaceDir,
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceFilePath,
  readWorkspaceFile,
  saveStoredWorkspaceSnapshot,
  searchWorkspace,
  WORKSPACE_CHANGED_EVENT,
} from "../src/workspace.ts";

test("createLocalStorageWorkspaceAdapter reads, lists, searches and patches workspace files", async () => {
  const storage = createMemoryLocalStorage();
  await saveStoredWorkspaceSnapshot(
    {
      rootPath: "/workspace",
      files: [
        { path: "/workspace/src/app.ts", content: "console.log('hello');\nconst value = 1;" },
        { path: "/workspace/src/util.ts", content: "export const value = 2;" },
      ],
    },
    { storage },
  );

  const workspace = createLocalStorageWorkspaceAdapter({ storage });

  assert.deepEqual(await workspace.readFile({ path: "src/app.ts" }), {
    path: "/workspace/src/app.ts",
    content: "console.log('hello');\nconst value = 1;",
  });

  assert.deepEqual(await workspace.listDir({ path: "/workspace/src", recursive: false }), {
    entries: [
      {
        path: "/workspace/src/app.ts",
        isDir: false,
        sizeBytes: new TextEncoder().encode("console.log('hello');\nconst value = 1;").length,
      },
      {
        path: "/workspace/src/util.ts",
        isDir: false,
        sizeBytes: new TextEncoder().encode("export const value = 2;").length,
      },
    ],
  });

  assert.deepEqual(await workspace.search({ path: "/workspace/src", query: "const", caseSensitive: true }), {
    matches: [
      {
        path: "/workspace/src/app.ts",
        lineNumber: 2,
        line: "const value = 1;",
      },
      {
        path: "/workspace/src/util.ts",
        lineNumber: 1,
        line: "export const value = 2;",
      },
    ],
  });

  assert.deepEqual(
    await workspace.applyPatch({ patch: `*** Begin Patch
*** Update File: src/app.ts
@@
-const value = 1;
+const value = 2;
*** Add File: src/new.ts
+export const created = true;
*** End Patch` }),
    {
      filesChanged: ["/workspace/src/app.ts", "/workspace/src/new.ts"],
    },
  );

  assert.deepEqual(await loadStoredWorkspaceSnapshot({ storage }), {
    rootPath: "/workspace",
    files: [
      { path: "/workspace/src/app.ts", content: "console.log('hello');\nconst value = 2;" },
      { path: "/workspace/src/new.ts", content: "export const created = true;" },
      { path: "/workspace/src/util.ts", content: "export const value = 2;" },
    ],
  });
});

test("workspace helpers support direct function imports backed by window.localStorage", async () => {
  const storage = createMemoryLocalStorage();
  const eventLog: string[] = [];
  installWindowMock(storage, {
    dispatchEvent(event) {
      eventLog.push(event.type);
      return true;
    },
  });

  await saveStoredWorkspaceSnapshot({
    rootPath: "/workspace",
    files: [{ path: "src/index.ts", content: "alpha\nBeta" }],
  });

  assert.deepEqual(await readWorkspaceFile({ path: "src/index.ts" }), {
    path: "/workspace/src/index.ts",
    content: "alpha\nBeta",
  });
  assert.deepEqual(await listWorkspaceDir({ path: "/workspace", recursive: true }), {
    entries: [
      {
        path: "/workspace/src/index.ts",
        isDir: false,
        sizeBytes: new TextEncoder().encode("alpha\nBeta").length,
      },
    ],
  });
  assert.deepEqual(await searchWorkspace({ path: "/workspace", query: "beta", caseSensitive: false }), {
    matches: [{ path: "/workspace/src/index.ts", lineNumber: 2, line: "Beta" }],
  });
  assert.deepEqual(
    await applyWorkspacePatch({ patch: `--- a/src/index.ts
+++ b/src/index.ts
@@
-alpha
+gamma` }),
    { filesChanged: ["/workspace/src/index.ts"] },
  );
  assert.deepEqual(eventLog, [WORKSPACE_CHANGED_EVENT, WORKSPACE_CHANGED_EVENT]);
});

test("workspace snapshot helpers normalize paths and custom roots", async () => {
  const storage = createMemoryLocalStorage();

  await saveStoredWorkspaceSnapshot(
    {
      rootPath: "project",
      files: [{ path: "nested/file.txt", content: "content" }],
    },
    {
      rootPath: "/project",
      storage,
      storageKey: "custom.workspace",
    },
  );

  assert.equal(normalizeWorkspaceFilePath("nested/file.txt", { rootPath: "/project" }), "/project/nested/file.txt");
  assert.deepEqual(
    await loadStoredWorkspaceSnapshot({
      rootPath: "/project",
      storage,
      storageKey: "custom.workspace",
    }),
    {
      rootPath: "/project",
      files: [{ path: "/project/nested/file.txt", content: "content" }],
    },
  );
});

function createMemoryLocalStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

function installWindowMock(
  storage: Storage,
  eventTarget?: Pick<EventTarget, "dispatchEvent">,
): void {
  Object.assign(globalThis, {
    window: {
      localStorage: storage,
      dispatchEvent: eventTarget?.dispatchEvent?.bind(eventTarget),
    },
  });
}
