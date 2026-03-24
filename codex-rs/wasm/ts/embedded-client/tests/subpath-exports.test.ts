import assert from "node:assert/strict";
import test from "node:test";

test("subpath entrypoints re-export the browser runtime helpers", async () => {
  installBrowserGlobals();

  const embeddedAssets = await import("../src/assets.ts");
  const embeddedConfig = await import("../src/config.ts");
  const embeddedStorage = await import("../src/storage.ts");
  const embeddedTransport = await import("../src/transport.ts");
  const embeddedWorkspace = await import("../src/workspace.ts");

  const runtimeAssets = await import("../../browser-runtime/src/assets.ts");
  const runtimeConfig = await import("../../browser-runtime/src/config.ts");
  const runtimeStorage = await import("../../browser-runtime/src/storage.ts");
  const runtimeTransport = await import("../../browser-runtime/src/transport.ts");
  const runtimeWorkspace = await import("../../browser-runtime/src/workspace.ts");

  assert.equal(typeof embeddedAssets.loadBuildManifest, "function");
  assert.equal(typeof embeddedAssets.loadRuntimeModule, "function");
  assert.equal(typeof embeddedAssets.loadXrouterRuntime, "function");
  assert.equal(typeof embeddedAssets.toBrowserAssetUrl, "function");
  assert.equal(typeof embeddedAssets.toBrowserModuleUrl, "function");
  assert.equal(embeddedAssets.loadBuildManifest.name, runtimeAssets.loadBuildManifest.name);
  assert.equal(embeddedAssets.loadRuntimeModule.name, runtimeAssets.loadRuntimeModule.name);

  assert.deepEqual(embeddedConfig.DEFAULT_CODEX_CONFIG, runtimeConfig.DEFAULT_CODEX_CONFIG);
  assert.deepEqual(
    embeddedConfig.XROUTER_PROVIDER_OPTIONS,
    runtimeConfig.XROUTER_PROVIDER_OPTIONS,
  );
  assert.equal(typeof embeddedConfig.detectTransportMode, "function");
  assert.equal(typeof embeddedConfig.materializeCodexConfig, "function");
  assert.equal(typeof embeddedConfig.normalizeCodexConfig, "function");

  assert.equal(typeof embeddedStorage.createIndexedDbCodexStorage, "function");
  assert.equal(
    embeddedStorage.createIndexedDbCodexStorage.name,
    runtimeStorage.createIndexedDbCodexStorage.name,
  );
  assert.equal(
    typeof embeddedTransport.createBrowserRuntimeModelTransportAdapter,
    "function",
  );
  assert.equal(
    embeddedTransport.createBrowserRuntimeModelTransportAdapter.name,
    runtimeTransport.createBrowserRuntimeModelTransportAdapter.name,
  );

  assert.equal(typeof embeddedWorkspace.createLocalStorageWorkspaceAdapter, "function");
  assert.equal(typeof embeddedWorkspace.createBrowserWorkspaceAdapter, "function");
  assert.equal(typeof embeddedWorkspace.readWorkspaceFile, "function");
  assert.equal(typeof embeddedWorkspace.listWorkspaceDir, "function");
  assert.equal(typeof embeddedWorkspace.searchWorkspace, "function");
  assert.equal(typeof embeddedWorkspace.applyWorkspacePatch, "function");
  assert.equal(typeof embeddedWorkspace.loadStoredWorkspaceSnapshot, "function");
  assert.equal(typeof embeddedWorkspace.saveStoredWorkspaceSnapshot, "function");
  assert.equal(typeof embeddedWorkspace.normalizeWorkspaceFilePath, "function");
  assert.equal(typeof embeddedWorkspace.normalizeWorkspaceDirectoryPath, "function");
  assert.equal(typeof embeddedWorkspace.parentDirectory, "function");
  assert.equal(
    embeddedWorkspace.DEFAULT_WORKSPACE_ROOT,
    runtimeWorkspace.DEFAULT_WORKSPACE_ROOT,
  );
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
