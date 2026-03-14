import { cancelActiveModelRequests, emitRuntimeActivity } from "./activity";
import { loadStoredAuthState, loadStoredCodexConfig, loadStoredInstructionSnapshot, loadStoredSession, saveStoredAuthState, saveStoredSession } from "./storage";
import { applyWorkspacePatch, listWorkspaceDir, readWorkspaceFile, searchWorkspace, writeWorkspaceFile } from "./workspace";
import { activeProviderApiKey, createHostError, getActiveProvider, normalizeHostValue } from "./utils";
import { discoverProviderModels, discoverRouterModels, runResponsesApiTurn, runXrouterTurn } from "./transports";
import type { BrowserRuntimeHost, JsonValue } from "./types";
import { clearStoredAuthState } from "./storage";
import { collaborationStore } from "../stores/collaboration";
import { createBrowserAwareToolExecutor } from "./browser-tools";
import {
  createIndexedDbRemoteMcpStateStore,
  createRemoteMcpToolExecutor,
  type RemoteMcpController,
} from "../../../../ts/host-runtime/src/mcp";

declare global {
  interface Window {
    __aiAwareMcp?: RemoteMcpController;
  }
}

let remoteMcpRuntime: ReturnType<typeof createRemoteMcpToolExecutor> | null = null;
const browserToolExecutor = createBrowserAwareToolExecutor();

function getRemoteMcpRuntime() {
  if (remoteMcpRuntime !== null) {
    return remoteMcpRuntime;
  }
  remoteMcpRuntime = createRemoteMcpToolExecutor({
    servers: [
      {
        serverName: "notion",
        serverUrl: "https://mcp.notion.com/mcp",
      },
    ],
    stateStore: createIndexedDbRemoteMcpStateStore({
      dbName: "codex-ai-aware-web-mcp",
    }),
  });
  window.__aiAwareMcp = remoteMcpRuntime.controller;
  return remoteMcpRuntime;
}

function splitQualifiedToolName(name: string): { toolName: string; toolNamespace: string | null } {
  if (name.startsWith("browser__")) {
    return {
      toolName: name.slice("browser__".length),
      toolNamespace: "browser",
    };
  }
  if (name.startsWith("mcp__")) {
    const stripped = name.slice("mcp__".length);
    const separatorIndex = stripped.indexOf("__");
    if (separatorIndex !== -1) {
      return {
        toolName: stripped.slice(separatorIndex + "__".length),
        toolNamespace: stripped.slice(0, separatorIndex),
      };
    }
  }
  return { toolName: name, toolNamespace: null };
}

function qualifyToolName(toolName: string, toolNamespace: string | null): string {
  if (toolNamespace === "browser") {
    return toolName.startsWith("browser__") ? toolName : `browser__${toolName}`;
  }
  if (typeof toolNamespace === "string" && toolNamespace.length > 0) {
    return toolName.startsWith("mcp__") ? toolName : `mcp__${toolNamespace}__${toolName}`;
  }
  return toolName;
}

export function createBrowserRuntimeHost(): BrowserRuntimeHost {
  const mcpRuntime = getRemoteMcpRuntime();

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
      return collaborationStore.requestUserInput({
        questions: questions.map((question) => ({
          header: typeof question.header === "string" ? question.header : "Input",
          id: typeof question.id === "string" ? question.id : "answer",
          question:
            typeof question.question === "string" ? question.question : "Provide the requested input.",
          options: Array.isArray(question.options)
            ? question.options.flatMap((option) => {
                if (option === null || typeof option !== "object" || Array.isArray(option)) {
                  return [];
                }
                const record = option as Record<string, unknown>;
                if (typeof record.label !== "string" || typeof record.description !== "string") {
                  return [];
                }
                return [{ label: record.label, description: record.description }];
              })
            : [],
        })),
      });
    },
    async listTools() {
      const [browserTools, remoteTools] = await Promise.all([
        browserToolExecutor.list(),
        mcpRuntime.toolExecutor.list(),
      ]);
      console.info("[webui] host.list-tools", {
        browserTools: browserTools.tools.map((tool) => splitQualifiedToolName(tool.name)),
        remoteTools: remoteTools.tools.map((tool) => splitQualifiedToolName(tool.name)),
      });
      return [...browserTools.tools, ...remoteTools.tools].map((tool) => {
        const split = splitQualifiedToolName(tool.name);
        return {
          toolName: split.toolName,
          toolNamespace: split.toolNamespace,
          description: tool.description,
          inputSchema: tool.inputSchema,
        };
      });
    },
    async invokeTool(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (typeof normalizedRequest.callId !== "string" || typeof normalizedRequest.toolName !== "string") {
        throw createHostError("invalidInput", "invokeTool expected callId and toolName");
      }
      const toolNamespace =
        typeof normalizedRequest.toolNamespace === "string" ? normalizedRequest.toolNamespace : null;
      const qualifiedToolName = qualifyToolName(normalizedRequest.toolName, toolNamespace);
      if (toolNamespace === "browser" || qualifiedToolName.startsWith("browser__")) {
        return browserToolExecutor.invoke({
          callId: normalizedRequest.callId,
          toolName: qualifiedToolName,
          input: (normalizedRequest.input as JsonValue | undefined) ?? null,
        });
      }
      return mcpRuntime.toolExecutor.invoke({
        callId: normalizedRequest.callId,
        toolName: qualifiedToolName,
        input: (normalizedRequest.input as JsonValue | undefined) ?? null,
      });
    },
    async cancelTool(callId) {
      await Promise.all([browserToolExecutor.cancel({ callId }), mcpRuntime.toolExecutor.cancel(callId)]);
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
      console.info("[webui] wasm.transport-request", {
        requestId,
        model: selectedModel,
        tools:
          Array.isArray(transportRequest.tools)
            ? transportRequest.tools.map((tool) => summarizeTransportTool(tool as JsonValue))
            : null,
        toolChoice: transportRequest.tool_choice ?? null,
        responseInputItemTypes:
          responseInputItems?.flatMap((item) =>
            item !== null && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).type === "string"
              ? [(item as Record<string, unknown>).type as string]
              : [],
          ) ?? null,
      });

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

function summarizeTransportTool(tool: JsonValue): Record<string, unknown> | null {
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
    return null;
  }
  const record = tool as Record<string, unknown>;
  return {
    type: typeof record.type === "string" ? record.type : null,
    name: typeof record.name === "string" ? record.name : null,
    description:
      typeof record.description === "string" ? record.description.slice(0, 120) : null,
    execution: typeof record.execution === "string" ? record.execution : null,
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
