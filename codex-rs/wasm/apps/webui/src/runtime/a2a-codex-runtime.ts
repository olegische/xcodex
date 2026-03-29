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
import {
  createCodexA2AClient,
  createRpcCodexConnection,
} from "@xcodexai/sdk";
import { emitRuntimeActivity } from "./activity";
import { emitRuntimeEvent } from "./events";
import { installRuntimeActivityBridge } from "./notifications";
import {
  clearStoredA2ATaskBinding,
  loadStoredDemoInstructions,
  saveStoredA2ATaskBinding,
  saveStoredThreadBinding,
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
  TranscriptEntry,
} from "./types";

export async function createA2ACodexRuntime(): Promise<BrowserRuntime> {
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

  const connection = createRpcCodexConnection({
    request: async (request) => {
      switch (request.method) {
        case "thread/start": {
          const response = await client.startThread(request.params);
          await saveStoredThreadBinding(response.thread.id);
          return response;
        }
        case "turn/start":
          return await client.startTurn(request.params);
        case "turn/interrupt":
          return await client.interruptTurn(request.params);
        default:
          throw new Error(`Unsupported app-server request in A2A runtime: ${request.method}`);
      }
    },
    async notify() {},
    async resolveServerRequest() {},
    async rejectServerRequest() {},
    subscribe(listener) {
      const unsubscribe = subscribeToNotifications((notification) => {
        listener({
          type: "notification",
          notification,
        });
      });
      return () => {
        unsubscribe();
      };
    },
    async shutdown() {},
  });

  return {
    protocolMode: "a2a",
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
    async runA2ATurn(request) {
      const a2a = await createCodexA2AClient({
        connection,
        baseUrl: "https://xcodex.local",
        defaultModel: request.model,
      });
      let previousTaskId = request.previousTaskId;
      if (previousTaskId !== null) {
        const existingTask = await a2a.getTask({
          id: previousTaskId,
          historyLength: 1,
        }).catch(() => null);
        if (existingTask === null) {
          previousTaskId = null;
          await clearStoredA2ATaskBinding();
        }
      }
      const stream = a2a.sendMessageStream({
        message: {
          kind: "message",
          messageId: crypto.randomUUID(),
          role: "user",
          taskId: previousTaskId ?? undefined,
          contextId: previousTaskId ?? undefined,
          parts: [
            {
              kind: "text",
              text: request.message,
            },
          ],
        },
      });

      let taskId = request.previousTaskId;
      let output = "";
      for await (const event of stream) {
        if (event.kind === "task") {
          taskId = event.id;
          continue;
        }
        if (event.kind === "artifact-update") {
          if (event.artifact.artifactId.startsWith("assistant:")) {
            for (const part of event.artifact.parts) {
              if (part.kind === "text") {
                output += part.text;
              }
            }
          }
          continue;
        }
        if (event.kind === "status-update" && event.status.state === "completed") {
          const message = event.status.message;
          if (message !== undefined && output.length === 0) {
            output = message.parts
              .flatMap((part) => (part.kind === "text" ? [part.text] : []))
              .join("\n");
          }
        }
      }

      if (taskId === null) {
        throw new Error("A2A runtime did not return a task id.");
      }
      const task = await a2a.getTask({
        id: taskId,
        historyLength: 200,
      });
      await saveStoredA2ATaskBinding(taskId);
      return {
        taskId,
        output,
        transcript: transcriptFromA2ATask(task.history),
      };
    },
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

function transcriptFromA2ATask(
  history: Array<{
    role: "user" | "agent";
    parts: Array<{ kind: string; text?: string }>;
  }> | undefined,
): TranscriptEntry[] {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.flatMap((message) => {
    const text = message.parts
      .flatMap((part) => (part.kind === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("\n")
      .trim();
    if (text.length === 0) {
      return [];
    }
    return [
      {
        role: message.role === "agent" ? "assistant" : "user",
        text,
      } satisfies TranscriptEntry,
    ];
  });
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
