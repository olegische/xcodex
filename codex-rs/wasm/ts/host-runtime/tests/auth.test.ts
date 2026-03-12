import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrowserAuthAdapter,
  createInMemoryAuthStateStore,
} from "../src/auth.ts";

test("browser auth adapter loads and persists auth state", async () => {
  const store = createInMemoryAuthStateStore();
  const adapter = createBrowserAuthAdapter({
    store,
    provider: {
      async readAccount() {
        return { account: null, requiresOpenaiAuth: true };
      },
      async listModels() {
        return { data: [], nextCursor: null };
      },
      async refreshAuth() {
        return {
          accessToken: "refreshed-token",
          chatgptAccountId: "workspace-123",
          chatgptPlanType: "pro",
        };
      },
    },
  });

  await adapter.saveAuthState({
    authState: {
      authMode: "chatgptAuthTokens",
      openaiApiKey: null,
      accessToken: "token-1",
      refreshToken: null,
      chatgptAccountId: "workspace-123",
      chatgptPlanType: "plus",
      lastRefreshAt: 100,
    },
  });

  assert.deepEqual(await adapter.loadAuthState(), {
    authState: {
      authMode: "chatgptAuthTokens",
      openaiApiKey: null,
      accessToken: "token-1",
      refreshToken: null,
      chatgptAccountId: "workspace-123",
      chatgptPlanType: "plus",
      lastRefreshAt: 100,
    },
  });
});

test("browser auth adapter refreshes tokens and updates persisted state", async () => {
  const store = createInMemoryAuthStateStore({
    authMode: "chatgptAuthTokens",
    openaiApiKey: null,
    accessToken: "stale-token",
    refreshToken: null,
    chatgptAccountId: "workspace-123",
    chatgptPlanType: "plus",
    lastRefreshAt: 100,
  });
  const adapter = createBrowserAuthAdapter({
    store,
    provider: {
      async readAccount() {
        return { account: null, requiresOpenaiAuth: true };
      },
      async listModels() {
        return { data: [], nextCursor: null };
      },
      async refreshAuth(params) {
        assert.equal(params.authState?.accessToken, "stale-token");
        assert.equal(params.previousAccountId, "workspace-123");
        return {
          accessToken: "fresh-token",
          chatgptAccountId: "workspace-123",
          chatgptPlanType: "pro",
        };
      },
    },
  });

  const refreshed = await adapter.refreshAuth({
    reason: "unauthorized",
    previousAccountId: "workspace-123",
  });

  assert.deepEqual(refreshed, {
    accessToken: "fresh-token",
    chatgptAccountId: "workspace-123",
    chatgptPlanType: "pro",
  });
  assert.equal((await store.load())?.accessToken, "fresh-token");
  assert.equal((await store.load())?.chatgptPlanType, "pro");
});
