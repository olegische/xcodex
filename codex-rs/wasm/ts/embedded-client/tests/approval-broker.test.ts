import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserToolApprovalBroker } from "../src/approval-broker.ts";

test("approval broker queues pending requests and resolves replies", async () => {
  const broker = createBrowserToolApprovalBroker();
  const notifications: string[] = [];

  const unsubscribe = broker.subscribe((notification) => {
    notifications.push(notification.method);
  });

  const pendingApproval = broker.requestBrowserToolApproval({
    approvalId: "approval-1",
    toolName: "browser__navigate",
    canonicalToolName: "browser__navigate",
    requiredScopes: ["browser.page:navigate"],
    runtimeMode: "agent",
    origin: "https://example.test",
    displayOrigin: "https://example.test",
    targetOrigin: "https://example.test",
    targetUrl: "https://example.test/path",
    approvalKind: "navigation",
    reason: "Navigate the current page to the requested URL.",
    grantOptions: ["allow_once", "deny"],
  });

  const pending = await broker.getPendingServerRequests();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.method, "item/browserTool/requestApproval");

  await broker.replyToServerRequest(pending[0]!.id, {
    result: {
      decision: "allow_once",
    },
  });

  assert.deepEqual(await pendingApproval, { decision: "allow_once" });
  assert.deepEqual(notifications, ["server/request", "server/request/resolved"]);

  unsubscribe();
});
