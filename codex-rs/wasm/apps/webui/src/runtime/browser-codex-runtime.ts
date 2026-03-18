import { collaborationStore } from "../stores/collaboration";
import type { ServerNotification } from "../../../../../app-server-protocol/schema/typescript/ServerNotification";
import {
  threadToSessionSnapshot,
} from "@browser-codex/wasm-runtime-core";
import { createBrowserCodexRuntime as createSharedBrowserCodexRuntime } from "../../../../ts/browser-codex-runtime/src";
import {
  configurePageTelemetry,
  createBrowserAwareToolExecutor,
} from "@browser-codex/wasm-browser-tools";
import { emitRuntimeActivity } from "./activity";
import { emitRuntimeEvent } from "./events";
import { installRuntimeActivityBridge } from "./notifications";
import {
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredSession,
  saveStoredAuthState,
  saveStoredSession,
} from "./storage";
import { webUiModelTransportAdapter } from "./transport-adapter";
import { formatError, getActiveProvider, normalizeHostValue } from "./utils";
import type {
  Account,
  AuthState,
  BrowserRuntime,
  JsonValue,
  ModelPreset,
  RuntimeEvent,
  RuntimeModule,
  SessionSnapshot,
} from "./types";

const browserToolExecutor = createBrowserAwareToolExecutor();

export async function createBrowserCodexRuntime(
  runtimeModule: RuntimeModule,
  host: unknown,
): Promise<BrowserRuntime> {
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
  const runtime = await createSharedBrowserCodexRuntime({
    runtimeModule,
    host,
    deps: {
      persistence: {
        loadAuthState: loadStoredAuthState,
        saveAuthState: saveStoredAuthState,
        async clearAuthState() {
          await saveStoredAuthState({
            authMode: "apiKey",
            openaiApiKey: null,
            accessToken: null,
            refreshToken: null,
            chatgptAccountId: null,
            chatgptPlanType: null,
            lastRefreshAt: null,
          });
        },
        loadConfig: loadStoredCodexConfig,
        loadSession: loadStoredSession,
        saveSession: saveStoredSession,
      },
      dynamicTools: browserToolExecutor,
      async readAccount({ authState, config }) {
        const provider = getActiveProvider(config);
        if (authState === null || authState.openaiApiKey === null || authState.openaiApiKey.trim().length === 0) {
          return {
            account: null,
            requiresOpenaiAuth: provider.providerKind === "openai",
          };
        }
        return {
          account: {
            email: null,
            planType: authState.chatgptPlanType,
            chatgptAccountId: authState.chatgptAccountId,
            authMode: authState.authMode,
          } satisfies Account,
          requiresOpenaiAuth: false,
        };
      },
      async discoverModels({ config }) {
        return await webUiModelTransportAdapter.discoverModels(config);
      },
      async refreshAuth(_context) {
        throw new Error("Browser terminal uses API keys only.");
      },
      normalizeThread(thread) {
        return normalizeHostValue(thread) as Record<string, unknown>;
      },
      threadToSnapshot(thread) {
        return threadToSessionSnapshot(thread) as unknown as SessionSnapshot;
      },
      formatError,
      async requestUserInput(request) {
        return await collaborationStore.requestUserInput(request);
      },
    },
  });

  runtime.subscribeToNotifications((notification: ServerNotification) => {
    emitRuntimeEvent({
      method: notification.method,
      params: ("params" in notification ? notification.params : null) as JsonValue,
    } satisfies RuntimeEvent);
  });

  return runtime as unknown as BrowserRuntime;
}
