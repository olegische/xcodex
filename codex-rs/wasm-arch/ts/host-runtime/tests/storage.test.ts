import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrowserSessionStoreAdapter,
  createBrowserWorkspaceStore,
  createWorkspaceFsAdapter,
  createInMemoryArtifactStore,
  createInMemorySessionIndexStore,
  createInMemoryWorkspaceIndexStore,
} from "../src/storage.ts";

test("browser session store keeps small snapshots inline", async () => {
  const sessionStore = createBrowserSessionStoreAdapter({
    indexStore: createInMemorySessionIndexStore(),
    inlineItemsThresholdBytes: 1024,
  });

  await sessionStore.save({
    snapshot: {
      threadId: "thread-inline",
      metadata: {
        workspaceRoot: "/repo",
      },
      items: [{ type: "message", text: "hello" }],
    },
  });

  const loaded = await sessionStore.load({
    threadId: "thread-inline",
  });

  assert.deepEqual(loaded, {
    snapshot: {
      threadId: "thread-inline",
      metadata: {
        workspaceRoot: "/repo",
      },
      items: [{ type: "message", text: "hello" }],
    },
  });
});

test("browser session store spills large snapshots into artifact storage", async () => {
  const artifactStore = createInMemoryArtifactStore();
  const sessionStore = createBrowserSessionStoreAdapter({
    indexStore: createInMemorySessionIndexStore(),
    artifactStore,
    inlineItemsThresholdBytes: 32,
    artifactPrefix: "thread-artifacts",
  });

  await sessionStore.save({
    snapshot: {
      threadId: "thread-large",
      metadata: {},
      items: [
        {
          type: "message",
          text: "this payload is intentionally much larger than the inline limit",
        },
      ],
    },
  });

  assert.deepEqual(
    [...artifactStore.files.keys()],
    ["thread-artifacts/thread-large.items.json"],
  );

  const loaded = await sessionStore.load({
    threadId: "thread-large",
  });

  assert.deepEqual(loaded, {
    snapshot: {
      threadId: "thread-large",
      metadata: {},
      items: [
        {
          type: "message",
          text: "this payload is intentionally much larger than the inline limit",
        },
      ],
    },
  });
});

test("browser session store deletes stale artifacts when snapshot becomes small", async () => {
  const artifactStore = createInMemoryArtifactStore();
  const sessionStore = createBrowserSessionStoreAdapter({
    indexStore: createInMemorySessionIndexStore(),
    artifactStore,
    inlineItemsThresholdBytes: 16,
  });

  await sessionStore.save({
    snapshot: {
      threadId: "thread-shrink",
      metadata: {},
      items: [{ text: "large payload for artifact storage" }],
    },
  });
  await sessionStore.save({
    snapshot: {
      threadId: "thread-shrink",
      metadata: {},
      items: [{ text: "tiny" }],
    },
  });

  assert.equal(artifactStore.files.size, 0);
  assert.deepEqual(await sessionStore.load({ threadId: "thread-shrink" }), {
    snapshot: {
      threadId: "thread-shrink",
      metadata: {},
      items: [{ text: "tiny" }],
    },
  });
});

test("browser workspace store keeps small file sets inline", async () => {
  const workspaceStore = createBrowserWorkspaceStore({
    indexStore: createInMemoryWorkspaceIndexStore(),
    inlineFilesThresholdBytes: 1024,
  });

  await workspaceStore.save({
    snapshot: {
      workspaceId: "workspace-inline",
      rootPath: "/workspace",
      files: [
        {
          path: "src/lib.rs",
          content: "pub fn greet() -> &'static str { \"hello\" }",
        },
      ],
    },
  });

  const loaded = await workspaceStore.load({
    workspaceId: "workspace-inline",
  });

  assert.deepEqual(loaded, {
    snapshot: {
      workspaceId: "workspace-inline",
      rootPath: "/workspace",
      files: [
        {
          path: "/workspace/src/lib.rs",
          content: "pub fn greet() -> &'static str { \"hello\" }",
        },
      ],
    },
  });
});

test("browser workspace store spills large file sets into artifact storage", async () => {
  const artifactStore = createInMemoryArtifactStore();
  const workspaceStore = createBrowserWorkspaceStore({
    indexStore: createInMemoryWorkspaceIndexStore(),
    artifactStore,
    inlineFilesThresholdBytes: 32,
    artifactPrefix: "workspace-artifacts",
  });

  await workspaceStore.save({
    snapshot: {
      workspaceId: "workspace-large",
      rootPath: "/workspace",
      files: [
        {
          path: "README.md",
          content: "this payload is intentionally much larger than the inline limit",
        },
      ],
    },
  });

  assert.deepEqual(
    [...artifactStore.files.keys()],
    ["workspace-artifacts/workspace-large.files.json"],
  );

  const loaded = await workspaceStore.load({
    workspaceId: "workspace-large",
  });

  assert.deepEqual(loaded, {
    snapshot: {
      workspaceId: "workspace-large",
      rootPath: "/workspace",
      files: [
        {
          path: "/workspace/README.md",
          content: "this payload is intentionally much larger than the inline limit",
        },
      ],
    },
  });
});

test("workspace fs adapter reads, searches, lists, writes, and patches files", async () => {
  const workspaceStore = createBrowserWorkspaceStore({
    indexStore: createInMemoryWorkspaceIndexStore([
      {
        workspaceId: "workspace-1",
        rootPath: "/workspace",
        files: [
          {
            path: "src/lib.rs",
            content: ['pub fn greet() -> &'static str {', '    "hello"', "}"].join(
              "\n",
            ),
          },
        ],
      },
    ]),
  });
  const fsAdapter = createWorkspaceFsAdapter({
    workspaceStore,
    async resolveWorkspaceId() {
      return "workspace-1";
    },
  });

  assert.deepEqual(await fsAdapter.readFile({ path: "src/lib.rs" }), {
    path: "/workspace/src/lib.rs",
    content: ['pub fn greet() -> &'static str {', '    "hello"', "}"].join("\n"),
  });
  const listed = await fsAdapter.listDir({ path: "/workspace/src", recursive: false });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0]?.path, "/workspace/src/lib.rs");
  assert.equal(listed.entries[0]?.isDir, false);
  assert.equal(typeof listed.entries[0]?.sizeBytes, "number");
  assert.deepEqual(await fsAdapter.search({ path: "/workspace", query: "hello", caseSensitive: true }), {
    matches: [
      {
        path: "/workspace/src/lib.rs",
        lineNumber: 2,
        line: '    "hello"',
      },
    ],
  });

  await fsAdapter.writeFile({
    path: "README.md",
    content: "# Demo\n",
  });
  assert.deepEqual(await fsAdapter.readFile({ path: "/workspace/README.md" }), {
    path: "/workspace/README.md",
    content: "# Demo\n",
  });

  await fsAdapter.applyPatch({
    patch: [
      "*** Begin Patch",
      "*** Update File: src/lib.rs",
      "@@",
      " pub fn greet() -> &'static str {",
      '-    "hello"',
      '+    "hello from wasm"',
      " }",
      "*** End Patch",
    ].join("\n"),
  });
  assert.deepEqual(await fsAdapter.readFile({ path: "src/lib.rs" }), {
    path: "/workspace/src/lib.rs",
    content: [
      "pub fn greet() -> &'static str {",
      '    "hello from wasm"',
      "}",
    ].join("\n"),
  });
});
