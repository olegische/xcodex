import {
  createBrowserCodexRuntimeContext,
  createLocalStorageWorkspaceAdapter,
} from "xcodex-runtime";
import type {
  BrowserRuntimeContext,
  CreateEmbeddedCodexClientOptions,
  EmbeddedClientNotification,
  EmbeddedCodexClient,
} from "./types.ts";
import { createBrowserToolApprovalBroker } from "./approval-broker.ts";
import {
  listStoredThreadSummaries,
  searchStoredThreadSummaries,
  toStoredThreadReadResponse,
} from "./stored-threads.ts";

type EmbeddedClientDeps = {
  createBrowserCodexRuntimeContext: typeof createBrowserCodexRuntimeContext;
  createLocalStorageWorkspaceAdapter: typeof createLocalStorageWorkspaceAdapter;
  now(): string;
};

export function createEmbeddedCodexClient(
  options: CreateEmbeddedCodexClientOptions,
): EmbeddedCodexClient {
  return createEmbeddedCodexClientWithDeps(options, {
    createBrowserCodexRuntimeContext,
    createLocalStorageWorkspaceAdapter,
    now() {
      return new Date().toISOString();
    },
  });
}

export function createEmbeddedCodexClientWithDeps(
  options: CreateEmbeddedCodexClientOptions,
  deps: EmbeddedClientDeps,
): EmbeddedCodexClient {
  const approvalBroker = options.approvalBroker ?? createBrowserToolApprovalBroker();
  const workspace =
    options.workspace ??
    deps.createLocalStorageWorkspaceAdapter({
      rootPath: options.cwd,
    });

  let runtimeContextPromise: Promise<BrowserRuntimeContext> | null = null;

  async function getContext(): Promise<BrowserRuntimeContext> {
    if (runtimeContextPromise !== null) {
      return await runtimeContextPromise;
    }

    runtimeContextPromise = deps.createBrowserCodexRuntimeContext({
      ...options,
      workspace,
      requestBrowserToolApproval:
        options.requestBrowserToolApproval ?? approvalBroker.requestBrowserToolApproval,
    });

    return await runtimeContextPromise;
  }

  async function subscribe(
    listener: (notification: EmbeddedClientNotification) => void,
  ): Promise<() => void> {
    const context = await getContext();
    const unsubscribeRuntime = context.subscribe((notification) => {
      listener({
        method: notification.method,
        params: notification.params,
        atIso: deps.now(),
      });
    });
    const unsubscribeBroker = approvalBroker.subscribe(listener);
    return () => {
      unsubscribeRuntime();
      unsubscribeBroker();
    };
  }

  return {
    getContext,
    invalidateRuntimeContext() {
      runtimeContextPromise = null;
    },
    subscribe,
    async loadConfig() {
      const context = await getContext();
      return await context.loadConfig();
    },
    async saveConfig(config) {
      const context = await getContext();
      await context.saveConfig(config);
    },
    async loadAuthState() {
      const context = await getContext();
      return await context.runtime.loadAuthState();
    },
    async saveAuthState(authState) {
      const context = await getContext();
      await context.runtime.saveAuthState(authState);
    },
    async clearAuthState() {
      const context = await getContext();
      await context.runtime.clearAuthState();
    },
    async listModels(request = {}) {
      const context = await getContext();
      return await context.runtime.listModels({
        cursor: request.cursor ?? null,
        limit: request.limit ?? 200,
      });
    },
    async getPendingServerRequests() {
      return await approvalBroker.getPendingServerRequests();
    },
    async replyToServerRequest(id, payload) {
      await approvalBroker.replyToServerRequest(id, payload);
    },
    async listThreads(params) {
      const context = await getContext();
      return await context.runtime.threadList(params);
    },
    async readThread(params) {
      const context = await getContext();
      try {
        return await context.runtime.threadRead(params);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("thread/read requires a loaded thread")
        ) {
          const storedSession = await options.storage.loadSession(params.threadId);
          if (storedSession !== null) {
            return toStoredThreadReadResponse(storedSession);
          }
        }
        throw error;
      }
    },
    async startThread(params) {
      const context = await getContext();
      return await context.runtime.threadStart(params);
    },
    async resumeThread(params) {
      const context = await getContext();
      return await context.runtime.threadResume(params);
    },
    async rollbackThread(params) {
      const context = await getContext();
      return await context.runtime.threadRollback(params);
    },
    async startTurn(params) {
      const context = await getContext();
      return await context.runtime.turnStart(params);
    },
    async interruptTurn(params) {
      const context = await getContext();
      return await context.runtime.turnInterrupt(params);
    },
    async listStoredThreadSummaries() {
      return await listStoredThreadSummaries({
        storage: options.storage,
      });
    },
    async searchStoredThreadSummaries(query, limit = 200) {
      return await searchStoredThreadSummaries(
        {
          storage: options.storage,
        },
        query,
        limit,
      );
    },
  };
}
