import { collaborationStore } from "../stores/collaboration";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import {
  activeProviderApiKey,
  createBrowserCodexRuntimeContext,
  getActiveProvider,
} from "xcodex-runtime";
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
  const context = await createBrowserCodexRuntimeContext({
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
    requestBrowserToolApproval: async (request) =>
      await collaborationStore.requestBrowserToolApproval(request),
    async requestUserInput(request) {
      return await collaborationStore.requestUserInput(request);
    },
  });
  const runtime = context.runtime as BrowserRuntime;

  runtime.subscribeToNotifications((notification: ServerNotification) => {
    emitRuntimeEvent({
      method: notification.method,
      params: ("params" in notification ? notification.params : null) as JsonValue,
    } satisfies RuntimeEvent);
  });

  return runtime as unknown as BrowserRuntime;
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
