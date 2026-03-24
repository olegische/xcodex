import { collaborationStore } from "../stores/collaboration";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import {
  activeProviderApiKey,
  getActiveProvider,
} from "xcodex-embedded-client/config";
import {
  createBrowserToolApprovalBroker,
  createEmbeddedCodexClient,
} from "xcodex-embedded-client";
import {
  configurePageTelemetry,
} from "@browser-codex/wasm-browser-tools";
import { emitRuntimeActivity } from "./activity";
import { emitRuntimeEvent } from "./events";
import { installRuntimeActivityBridge } from "./notifications";
import {
  loadStoredDemoInstructions,
  webUiRuntimeStorage,
} from "./storage";
import {
  applyWorkspacePatch,
  listWorkspaceDir,
  readWorkspaceFile,
  searchWorkspace,
} from "./workspace";
import type {
  Account,
  BrowserRuntime,
  JsonValue,
  RuntimeEvent,
} from "./types";

export async function createBrowserCodexRuntime(): Promise<BrowserRuntime> {
  configurePageTelemetry({
    emitActivity(activity) {
      emitRuntimeActivity({
        type: "pageEvent",
        kind: activity.kind,
        summary: activity.summary,
        detail: activity.detail,
        target: activity.target,
        timestamp: activity.timestamp,
        data: activity.data,
      });
    },
  });
  installRuntimeActivityBridge();
  const demoInstructions = await loadStoredDemoInstructions();
  const approvalBroker = createBrowserToolApprovalBroker();
  const client = createEmbeddedCodexClient({
    cwd: "/workspace",
    storage: webUiRuntimeStorage,
    workspace: {
      readFile: readWorkspaceFile,
      listDir: listWorkspaceDir,
      search: searchWorkspace,
      applyPatch: applyWorkspacePatch,
    },
    bootstrap: {
      baseInstructions: demoInstructions.baseInstructions,
      developerInstructions:
        demoInstructions.agentsInstructions.trim().length > 0
          ? demoInstructions.agentsInstructions
          : null,
      userInstructions: buildSkillInstructions(demoInstructions),
      ephemeral: false,
    },
    readAccount: async ({ authState, config }) => {
      const provider = getActiveProvider(config);
      const apiKey =
        authState?.authMode === "apiKey" && authState.openaiApiKey !== null
          ? authState.openaiApiKey
          : activeProviderApiKey(config);
      if (apiKey.trim().length === 0) {
        return {
          account: null,
          requiresOpenaiAuth: provider.providerKind === "openai",
        };
      }
      return {
        account: {
          email: null,
          planType: authState?.chatgptPlanType ?? null,
          chatgptAccountId: authState?.chatgptAccountId ?? null,
          authMode: authState?.authMode ?? null,
        } satisfies Account,
        requiresOpenaiAuth: false,
      };
    },
    requestBrowserToolApproval: async (request) => {
      const responsePromise = approvalBroker.requestBrowserToolApproval(request);
      const pendingRequests = await approvalBroker.getPendingServerRequests();
      const pendingRequest = pendingRequests.at(-1);
      if (pendingRequest === undefined) {
        throw new Error("embedded approval broker did not enqueue a pending request");
      }
      const response = await collaborationStore.requestBrowserToolApproval(request);
      await approvalBroker.replyToServerRequest(pendingRequest.id, {
        result: response,
      });
      return await responsePromise;
    },
    async requestUserInput(request) {
      return await collaborationStore.requestUserInput(request);
    },
  });
  const context = await client.getContext();
  const runtimeClient = context.runtime;

  const subscribeToNotifications = (listener: (notification: ServerNotification) => void) => {
    const unsubscribeRuntime = context.subscribe((notification) => {
      listener({
        method: notification.method,
        params: notification.params,
      } as ServerNotification);
    });
    const unsubscribeApproval = approvalBroker.subscribe((notification) => {
      listener({
        method: notification.method,
        params: notification.params,
      } as ServerNotification);
    });
    return () => {
      unsubscribeRuntime();
      unsubscribeApproval();
    };
  };

  subscribeToNotifications((notification: ServerNotification) => {
    emitRuntimeEvent({
      method: notification.method,
      params: ("params" in notification ? notification.params : null) as JsonValue,
    } satisfies RuntimeEvent);
  });

  return {
    async readAccount() {
      const [authState, config] = await Promise.all([
        runtimeClient.loadAuthState(),
        context.loadConfig(),
      ]);
      const provider = getActiveProvider(config);
      const apiKey =
        authState?.authMode === "apiKey" && authState.openaiApiKey !== null
          ? authState.openaiApiKey
          : activeProviderApiKey(config);
      if (apiKey.trim().length === 0) {
        return {
          account: null,
          requiresOpenaiAuth: provider.providerKind === "openai",
        };
      }
      return {
        account: {
          email: null,
          planType: authState?.chatgptPlanType ?? null,
          chatgptAccountId: authState?.chatgptAccountId ?? null,
          authMode: authState?.authMode ?? null,
        } satisfies Account,
        requiresOpenaiAuth: false,
      };
    },
    async threadStart(params) {
      return await client.startThread(params);
    },
    async threadResume(params) {
      return await client.resumeThread(params);
    },
    async threadRead(params) {
      return await client.readThread(params);
    },
    async turnStart(params) {
      return await client.startTurn(params);
    },
    async turnInterrupt(params) {
      return await client.interruptTurn(params);
    },
    subscribeToNotifications,
    async loadAuthState() {
      return await client.loadAuthState();
    },
    async saveAuthState(authState) {
      await client.saveAuthState(authState);
    },
    async clearAuthState() {
      await client.clearAuthState();
    },
    async listModels(request) {
      return await client.listModels(request);
    },
  } as BrowserRuntime;
}

function buildSkillInstructions(
  demoInstructions: Awaited<ReturnType<typeof loadStoredDemoInstructions>>,
): string | null {
  const skillContents = demoInstructions.skillContents.trim();
  if (skillContents.length === 0) {
    return null;
  }
  return [
    `Skill: ${demoInstructions.skillName}`,
    `Path: ${demoInstructions.skillPath}`,
    "",
    skillContents,
  ].join("\n");
}
