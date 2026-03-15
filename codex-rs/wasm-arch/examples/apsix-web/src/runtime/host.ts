import { cancelActiveModelRequests, emitRuntimeActivity } from "./activity";
import { emitActivitiesFromNotifications } from "./notifications";
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
    servers: [],
    stateStore: createIndexedDbRemoteMcpStateStore({
      dbName: "codex-apsix-web-mcp",
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
      const serverName = stripped.slice(0, separatorIndex);
      return {
        toolName: stripped.slice(separatorIndex + "__".length),
        toolNamespace: `mcp__${serverName}__`,
      };
    }
  }
  return { toolName: name, toolNamespace: null };
}

function normalizeToolIdentity(params: {
  toolName: string;
  toolNamespace: string | null;
}): { toolName: string; toolNamespace: string | null; qualifiedName: string } {
  const split = splitQualifiedToolName(params.toolName);
  const toolNamespace = split.toolNamespace ?? params.toolNamespace;
  const toolName = split.toolName;
  return {
    toolName,
    toolNamespace,
    qualifiedName: qualifyToolName(toolName, toolNamespace),
  };
}

function qualifyToolName(toolName: string, toolNamespace: string | null): string {
  if (toolNamespace === "browser") {
    return toolName.startsWith("browser__") ? toolName : `browser__${toolName}`;
  }
  if (
    typeof toolNamespace === "string" &&
    toolNamespace.length > 0 &&
    toolNamespace.startsWith("mcp__")
  ) {
    return toolName.startsWith(toolNamespace) ? toolName : `${toolNamespace}${toolName}`;
  }
  return toolName;
}

function normalizeHostToolSpec(tool: Record<string, unknown>): {
  toolName: string;
  toolNamespace: string | null;
  description: string;
  inputSchema: JsonValue;
} {
  if (typeof tool.toolName === "string") {
    return {
      toolName: tool.toolName,
      toolNamespace: typeof tool.toolNamespace === "string" ? tool.toolNamespace : null,
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema: (tool.inputSchema as JsonValue | undefined) ?? null,
    };
  }

  const split = splitQualifiedToolName(typeof tool.name === "string" ? tool.name : "");
  return {
    toolName: split.toolName,
    toolNamespace: split.toolNamespace,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: (tool.inputSchema as JsonValue | undefined) ?? null,
  };
}

function isMcpNamespace(toolNamespace: string | null): boolean {
  return typeof toolNamespace === "string" && toolNamespace.startsWith("mcp__");
}

function resolveRemoteToolByPlainName(
  toolName: string,
  remoteTools: Array<{
    toolName: string;
    toolNamespace: string | null;
    description: string;
    inputSchema: JsonValue;
  }>,
): { toolName: string; toolNamespace: string | null; qualifiedName: string } | null {
  const matches = remoteTools.filter(
    (tool) => tool.toolName === toolName && isMcpNamespace(tool.toolNamespace),
  );
  if (matches.length !== 1) {
    return null;
  }
  return normalizeToolIdentity({
    toolName: matches[0].toolName,
    toolNamespace: matches[0].toolNamespace,
  });
}

function resolveBrowserToolByPlainName(
  toolName: string,
  browserTools: Array<{
    toolName: string;
    toolNamespace: string | null;
    description: string;
    inputSchema: JsonValue;
  }>,
): { toolName: string; toolNamespace: string | null; qualifiedName: string } | null {
  const matches = browserTools.filter(
    (tool) => tool.toolName === toolName && tool.toolNamespace === "browser",
  );
  if (matches.length !== 1) {
    return null;
  }
  return normalizeToolIdentity({
    toolName: matches[0].toolName,
    toolNamespace: matches[0].toolNamespace,
  });
}

function summarizeToolExecutionError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function buildToolErrorOutput(params: {
  toolName: string;
  toolNamespace: string | null;
  input: JsonValue;
  error: unknown;
}): JsonValue {
  const message = summarizeToolExecutionError(params.error);
  const output: Record<string, JsonValue> = {
    ok: false,
    error: {
      message,
      toolName: params.toolName,
      toolNamespace: params.toolNamespace,
    },
  };

  if (
    params.toolName === "notion-search" &&
    (message.includes("path") && message.includes("query") || message.includes("query too short"))
  ) {
    output.suggested_retry = {
      query: "workspace",
      query_type: "internal",
      page_size: 10,
    };
    output.hint =
      "Retry notion-search with a non-empty query of at least 3 characters, or use a specific title fragment from the workspace.";
  }

  output.input = params.input;
  return output;
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
    async emitNotification(notification) {
      const normalizedNotification = normalizeHostValue(notification);
      if (
        normalizedNotification !== null &&
        typeof normalizedNotification === "object" &&
        !Array.isArray(normalizedNotification) &&
        typeof (normalizedNotification as Record<string, unknown>).method === "string"
      ) {
        emitActivitiesFromNotifications([normalizedNotification as never]);
      }
    },
    async listTools() {
      const [browserTools, remoteTools] = await Promise.all([
        browserToolExecutor.list(),
        mcpRuntime.toolExecutor.list(),
      ]);
      const normalizedBrowserTools = browserTools.tools.map((tool) =>
        normalizeHostToolSpec(tool as Record<string, unknown>),
      );
      const normalizedRemoteTools = remoteTools.tools.map((tool) =>
        normalizeHostToolSpec(tool as Record<string, unknown>),
      );
      console.info("[webui] host.list-tools", {
        browserTools: normalizedBrowserTools,
        remoteTools: normalizedRemoteTools,
        remoteQualifiedNames: normalizedRemoteTools.map((tool) =>
          qualifyToolName(tool.toolName, tool.toolNamespace),
        ),
      });
      return [...normalizedBrowserTools, ...normalizedRemoteTools];
    },
    async invokeTool(request) {
      const normalizedRequest = normalizeHostValue(request) as Record<string, unknown>;
      if (typeof normalizedRequest.callId !== "string" || typeof normalizedRequest.toolName !== "string") {
        throw createHostError("invalidInput", "invokeTool expected callId and toolName");
      }
      const requestedToolNamespace =
        typeof normalizedRequest.toolNamespace === "string" ? normalizedRequest.toolNamespace : null;
      const normalizedTool = normalizeToolIdentity({
        toolName: normalizedRequest.toolName,
        toolNamespace: requestedToolNamespace,
      });
      let resolvedBrowserTool = normalizedTool;
      if (resolvedBrowserTool.toolNamespace !== "browser") {
        const browserTools = (await browserToolExecutor.list()).tools.map((tool) =>
          normalizeHostToolSpec(tool as Record<string, unknown>),
        );
        const matchedBrowserTool = resolveBrowserToolByPlainName(
          normalizedRequest.toolName,
          browserTools,
        );
        if (matchedBrowserTool !== null) {
          console.info("[webui] host.invoke-tool:fallback-browser-name", {
            requestToolName: normalizedRequest.toolName,
            resolvedQualifiedName: matchedBrowserTool.qualifiedName,
          });
          resolvedBrowserTool = matchedBrowserTool;
        }
      }
      if (
        resolvedBrowserTool.toolNamespace === "browser" ||
        resolvedBrowserTool.qualifiedName.startsWith("browser__")
      ) {
        const input = (normalizedRequest.input as JsonValue | undefined) ?? null;
        try {
          return await browserToolExecutor.invoke({
            callId: normalizedRequest.callId,
            toolName: resolvedBrowserTool.toolName,
            toolNamespace: "browser",
            input,
          });
        } catch (error) {
          return {
            callId: normalizedRequest.callId,
            output: buildToolErrorOutput({
              toolName: resolvedBrowserTool.toolName,
              toolNamespace: "browser",
              input,
              error,
            }),
          };
        }
      }
      let resolvedMcpTool = normalizedTool;
      if (!isMcpNamespace(resolvedMcpTool.toolNamespace)) {
        const remoteTools = (await mcpRuntime.toolExecutor.list()).tools.map((tool) =>
          normalizeHostToolSpec(tool as Record<string, unknown>),
        );
        const matchedRemoteTool = resolveRemoteToolByPlainName(
          normalizedRequest.toolName,
          remoteTools,
        );
        if (matchedRemoteTool !== null) {
          console.info("[webui] host.invoke-tool:fallback-mcp-name", {
            requestToolName: normalizedRequest.toolName,
            resolvedQualifiedName: matchedRemoteTool.qualifiedName,
            resolvedNamespace: matchedRemoteTool.toolNamespace,
          });
          resolvedMcpTool = matchedRemoteTool;
        }
      }
      if (!isMcpNamespace(resolvedMcpTool.toolNamespace)) {
        throw createHostError(
          "invalidInput",
          `invokeTool expected a browser or MCP tool, got ${normalizedRequest.toolName}`,
        );
      }
      const input = (normalizedRequest.input as JsonValue | undefined) ?? null;
      try {
        return await mcpRuntime.toolExecutor.invoke({
          callId: normalizedRequest.callId,
          toolName: resolvedMcpTool.toolName,
          toolNamespace: resolvedMcpTool.toolNamespace,
          input,
        });
      } catch (error) {
        return {
          callId: normalizedRequest.callId,
          output: buildToolErrorOutput({
            toolName: resolvedMcpTool.toolName,
            toolNamespace: resolvedMcpTool.toolNamespace,
            input,
            error,
          }),
        };
      }
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
        toolNames:
          Array.isArray(transportRequest.tools)
            ? transportRequest.tools.flatMap((tool) => {
                const summary = summarizeTransportTool(tool as JsonValue);
                return summary?.name === null || summary?.name === undefined ? [] : [summary.name];
              })
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
