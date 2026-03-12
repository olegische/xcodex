import { cancelActiveModelRequests, emitRuntimeActivity } from "./activity";
import { loadStoredAuthState, loadStoredCodexConfig, loadStoredInstructionSnapshot, loadStoredSession, saveStoredAuthState, saveStoredSession } from "./storage";
import { applyWorkspacePatch, listWorkspaceDir, readWorkspaceFile, searchWorkspace, writeWorkspaceFile } from "./workspace";
import { activeProviderApiKey, createHostError, getActiveProvider, normalizeHostValue } from "./utils";
import { discoverProviderModels, discoverRouterModels, runResponsesApiTurn, runXrouterTurn } from "./transports";
import type { BrowserRuntimeHost, HostToolSpec, JsonValue } from "./types";
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
    async updatePlan() {},
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

      const selectedModel = typeof payload.model === "string" ? payload.model : "unknown-model";
      const baseInstructions = typeof payload.baseInstructions === "string" ? payload.baseInstructions.trim() : "";
      const userMessage = typeof payload.userMessage === "string" ? payload.userMessage : "";
      const responseInputItems = Array.isArray(payload.responseInputItems) ? (payload.responseInputItems as JsonValue[]) : null;
      const toolSpecs = Array.isArray(payload.tools) ? (payload.tools as HostToolSpec[]) : [];
      const instructionMessages = extractContextualInstructionMessages(payload);
      const instructionsText = [baseInstructions, ...instructionMessages].filter(Boolean).join("\n\n");

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
            model: selectedModel,
            instructionsText,
            userMessage,
            responseInputItems,
            toolSpecs,
          })
        : runResponsesApiTurn({
            requestId,
            baseUrl: provider.baseUrl,
            model: selectedModel,
            apiKey,
            instructionsText,
            userMessage,
            responseInputItems,
            toolSpecs,
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

function extractContextualInstructionMessages(payload: Record<string, unknown>): string[] {
  const codexInstructions =
    payload.codexInstructions !== null && typeof payload.codexInstructions === "object"
      ? (payload.codexInstructions as Record<string, unknown>)
      : null;
  const contextualUserMessages = codexInstructions?.contextualUserMessages;
  if (!Array.isArray(contextualUserMessages)) {
    return [];
  }
  return contextualUserMessages.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}
