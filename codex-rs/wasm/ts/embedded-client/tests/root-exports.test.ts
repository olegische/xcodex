import assert from "node:assert/strict";
import test from "node:test";

test("root entrypoint exports the embedded client API", async () => {
  installBrowserGlobals();
  const {
    createBrowserToolApprovalBroker,
    formatBrowserToolApprovalReason,
  } = await import("../src/approval-broker.ts");
  const {
    createEmbeddedCodexClient,
    createEmbeddedCodexClientWithDeps,
  } = await import("../src/client.ts");
  const {
    listStoredThreadSummaries,
    searchStoredThreadSummaries,
    toIsoDateTime,
    toStoredThreadReadResponse,
    toStoredThreadSummary,
  } = await import("../src/stored-threads.ts");
  const runtime = await import("../src/index.ts");

  assert.equal(
    runtime.createBrowserToolApprovalBroker,
    createBrowserToolApprovalBroker,
  );
  assert.equal(
    runtime.formatBrowserToolApprovalReason,
    formatBrowserToolApprovalReason,
  );
  assert.equal(runtime.createEmbeddedCodexClient, createEmbeddedCodexClient);
  assert.equal(
    runtime.createEmbeddedCodexClientWithDeps,
    createEmbeddedCodexClientWithDeps,
  );
  assert.equal(runtime.listStoredThreadSummaries, listStoredThreadSummaries);
  assert.equal(runtime.searchStoredThreadSummaries, searchStoredThreadSummaries);
  assert.equal(runtime.toIsoDateTime, toIsoDateTime);
  assert.equal(runtime.toStoredThreadReadResponse, toStoredThreadReadResponse);
  assert.equal(runtime.toStoredThreadSummary, toStoredThreadSummary);
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
