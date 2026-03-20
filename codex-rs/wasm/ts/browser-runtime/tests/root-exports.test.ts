import assert from "node:assert/strict";
import test from "node:test";
import {
  loadBuildManifest,
  loadRuntimeModule,
  loadXrouterRuntime,
  toBrowserAssetUrl,
  toBrowserModuleUrl,
} from "../src/assets.ts";
import { createIndexedDbCodexStorage } from "../src/storage.ts";
import { createBrowserRuntimeModelTransportAdapter } from "../src/transport.ts";
import {
  DEFAULT_WORKSPACE_ROOT,
  applyWorkspacePatch,
  createBrowserWorkspaceAdapter,
  createLocalStorageWorkspaceAdapter,
  listWorkspaceDir,
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceDirectoryPath,
  normalizeWorkspaceFilePath,
  parentDirectory,
  readWorkspaceFile,
  saveStoredWorkspaceSnapshot,
  searchWorkspace,
} from "../src/workspace.ts";

test("root entrypoint exports the browser happy-path API", async () => {
  installBrowserGlobals();

  const runtime = await import("../src/index.ts");

  assert.equal(runtime.createIndexedDbCodexStorage, createIndexedDbCodexStorage);
  assert.equal(
    runtime.createBrowserRuntimeModelTransportAdapter,
    createBrowserRuntimeModelTransportAdapter,
  );
  assert.equal(runtime.loadBuildManifest, loadBuildManifest);
  assert.equal(runtime.loadRuntimeModule, loadRuntimeModule);
  assert.equal(runtime.loadXrouterRuntime, loadXrouterRuntime);
  assert.equal(runtime.toBrowserAssetUrl, toBrowserAssetUrl);
  assert.equal(runtime.toBrowserModuleUrl, toBrowserModuleUrl);
  assert.equal(
    runtime.createLocalStorageWorkspaceAdapter,
    createLocalStorageWorkspaceAdapter,
  );
  assert.equal(
    runtime.createBrowserWorkspaceAdapter,
    createBrowserWorkspaceAdapter,
  );
  assert.equal(runtime.readWorkspaceFile, readWorkspaceFile);
  assert.equal(runtime.listWorkspaceDir, listWorkspaceDir);
  assert.equal(runtime.searchWorkspace, searchWorkspace);
  assert.equal(runtime.applyWorkspacePatch, applyWorkspacePatch);
  assert.equal(
    runtime.loadStoredWorkspaceSnapshot,
    loadStoredWorkspaceSnapshot,
  );
  assert.equal(
    runtime.saveStoredWorkspaceSnapshot,
    saveStoredWorkspaceSnapshot,
  );
  assert.equal(
    runtime.normalizeWorkspaceFilePath,
    normalizeWorkspaceFilePath,
  );
  assert.equal(
    runtime.normalizeWorkspaceDirectoryPath,
    normalizeWorkspaceDirectoryPath,
  );
  assert.equal(runtime.parentDirectory, parentDirectory);
  assert.equal(runtime.DEFAULT_WORKSPACE_ROOT, DEFAULT_WORKSPACE_ROOT);
});

function installBrowserGlobals(): void {
  Object.assign(globalThis, {
    window: {
      location: { href: "https://example.test/" },
      chrome: undefined,
      getSelection() {
        return null;
      },
    },
    document: {
      title: "Test",
      readyState: "complete",
      activeElement: null,
      querySelectorAll() {
        return [];
      },
    },
  });
}
