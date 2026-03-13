import { cancelActiveModelRequests, emitRuntimeActivity } from "./activity";
import { loadStoredAuthState, loadStoredCodexConfig, loadStoredInstructionSnapshot, loadStoredSession, saveStoredAuthState, saveStoredSession } from "./storage";
import { applyWorkspacePatch, listWorkspaceDir, readWorkspaceFile, searchWorkspace, writeWorkspaceFile } from "./workspace";
import { activeProviderApiKey, createHostError, getActiveProvider, normalizeHostValue } from "./utils";
import { discoverProviderModels, discoverRouterModels, runResponsesApiTurn, runXrouterTurn } from "./transports";
import type { BrowserRuntimeHost, JsonValue } from "./types";
import { clearStoredAuthState } from "./storage";

export function createBrowserRuntimeHost(): BrowserRuntimeHost {
  return {
    async loadSession(threadId) {
      return loadStoredSession(threadId);
    },
    async loadInstructions(threadId) {
      return loadStoredInstructionSnapshot(threadId);
    },
    async saveSession(snapshot) {
      await saveStoredSession(snapshot);
    },
    async loadAuthState() {
      return loadStoredAuthState();
    },
    async saveAuthState(authState) {
      await saveStoredAuthState(authState);
    },
    async clearAuthState() {
      await clearStoredAuthState();
    },
    async readAccount() {
      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const authState = await loadStoredAuthState();
      if (authState === null) {
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
        },
        requiresOpenaiAuth: provider.providerKind === "openai" && authState.openaiApiKey === null,
      };
    },
    async listModels() {
      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const apiKey = activeProviderApiKey(codexConfig);
      if (apiKey.length === 0) {
        return { data: [], nextCursor: null };
      }
      return provider.providerKind === "xrouter_browser"
        ? discoverRouterModels(codexConfig)
        : discoverProviderModels(codexConfig);
    },
    async refreshAuth(context) {
      const authState = await loadStoredAuthState();
      if (authState === null || authState.authMode !== "chatgptAuthTokens" || authState.chatgptAccountId === null) {
        throw createHostError("unavailable", "auth refresh is only available for external ChatGPT auth");
      }
      return {
        accessToken: `${authState.accessToken ?? "webui-access-token"}:refreshed`,
        chatgptAccountId: authState.chatgptAccountId,
        chatgptPlanType: authState.chatgptPlanType,
        context,
      };
    },
    readFile: readWorkspaceFile,
    listDir: listWorkspaceDir,
    search: searchWorkspace,
    writeFile: writeWorkspaceFile,
    applyPatch: applyWorkspacePatch,
    async updatePlan(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      const explanation = typeof normalizedRequest.explanation === "string" ? normalizedRequest.explanation : null;
      const plan = Array.isArray(normalizedRequest.plan)
        ? normalizedRequest.plan.flatMap((entry) => {
            if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
              return [];
            }
            const record = entry as Record<string, unknown>;
            if (typeof record.step !== "string" || typeof record.status !== "string") {
              return [];
            }
            return [{ step: record.step, status: record.status }];
          })
        : [];
      emitRuntimeActivity({
        type: "planUpdate",
        explanation,
        plan,
      });
    },
    async requestUserInput(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      const questions = Array.isArray(normalizedRequest.questions)
        ? (normalizedRequest.questions as Array<Record<string, unknown>>)
        : null;
      if (questions === null) {
        throw createHostError("invalidInput", "requestUserInput expected questions");
      }
      return {
        answers: questions.map((question) => ({
          id: typeof question.id === "string" ? question.id : "answer",
          value: window.prompt(typeof question.question === "string" ? question.question : "Provide input") ?? "",
        })),
      };
    },
    async startModelTurn(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      const requestId = typeof normalizedRequest.requestId === "string" ? normalizedRequest.requestId : null;
      const payload =
        normalizedRequest.payload !== null && typeof normalizedRequest.payload === "object"
          ? (normalizedRequest.payload as Record<string, unknown>)
          : null;

      if (requestId === null) {
        throw createHostError("invalidInput", "startModelTurn expected requestId");
      }
      if (payload === null) {
        throw createHostError("invalidInput", "startModelTurn expected payload object");
      }

      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const apiKey = activeProviderApiKey(codexConfig);
      if (apiKey.length === 0) {
        throw createHostError("permissionDenied", "webui requires provider config before starting a model turn");
      }

      const transportRequest = extractTransportRequest(payload);
      const selectedModel = typeof transportRequest.model === "string" ? transportRequest.model : "unknown-model";
      const responseInputItems = Array.isArray(payload.responseInputItems) ? (payload.responseInputItems as JsonValue[]) : null;

      emitRuntimeActivity({ type: "turnStart", requestId, model: selectedModel });
      if (responseInputItems !== null) {
        for (const item of responseInputItems) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) {
            continue;
          }
          const record = item as Record<string, unknown>;
          if (record.type === "function_call_output") {
            emitRuntimeActivity({
              type: "toolOutput",
              requestId,
              callId: typeof record.call_id === "string" ? record.call_id : null,
              output: (record.output as JsonValue | undefined) ?? null,
            });
          }
        }
      }

      return provider.providerKind === "xrouter_browser"
        ? runXrouterTurn({
            requestId,
            codexConfig,
            requestBody: transportRequest,
            responseInputItems,
          })
        : runResponsesApiTurn({
            requestId,
            baseUrl: provider.baseUrl,
            apiKey,
            requestBody: transportRequest,
          });
    },
    async cancelModelTurn(requestId) {
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw createHostError("invalidInput", "cancelModelTurn expected requestId");
      }
      cancelActiveModelRequests(requestId);
    },
  };
}

function extractTransportRequest(payload: Record<string, unknown>): Record<string, unknown> {
  const transportPayload =
    payload.transportPayload !== null && typeof payload.transportPayload === "object" && !Array.isArray(payload.transportPayload)
      ? (payload.transportPayload as Record<string, unknown>)
      : null;
  if (transportPayload === null) {
    throw createHostError("invalidInput", "startModelTurn expected payload.transportPayload");
  }
  return transportPayload;
}
