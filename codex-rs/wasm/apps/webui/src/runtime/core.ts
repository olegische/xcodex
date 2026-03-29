import {
  DEFAULT_CODEX_CONFIG,
  XROUTER_PROVIDER_OPTIONS,
} from "xcodex-embedded-client/config";
import { DEFAULT_DEMO_INSTRUCTIONS } from "./constants";
import { createA2ACodexRuntime } from "./a2a-codex-runtime";
import { createBrowserCodexRuntime } from "./browser-codex-runtime";
import { createResponsesCodexRuntime } from "./responses-codex-runtime";
import { webUiModelTransportAdapter } from "./transport-adapter";
import { buildOutputFromEvents, threadToTranscript } from "./transcript";
import {
  clearStoredAuthState,
  clearStoredA2ATaskBinding,
  clearStoredCodexConfig,
  clearStoredResponsesBinding,
  clearStoredThreadBinding,
  deleteStoredThreadSession,
  loadStoredAuthState,
  loadStoredA2ATaskBinding,
  loadStoredCodexConfig,
  loadStoredDemoInstructions,
  loadStoredProtocolMode,
  loadStoredResponsesBinding,
  loadStoredThreadBinding,
  saveStoredAuthState,
  saveStoredCodexConfig,
  saveStoredProtocolMode,
  saveStoredResponsesBinding,
  saveStoredThreadBinding,
  syncStoredThreadRuntimeRevision,
} from "./storage";
import { activeProviderApiKey, formatError, getActiveProvider, materializeCodexConfig, normalizeCodexConfig, normalizeDemoInstructions } from "./utils";
import type {
  Account,
  AuthState,
  BrowserRuntime,
  CodexCompatibleConfig,
  DemoProtocolMode,
  DemoState,
  JsonValue,
  ModelPreset,
  ProviderDraft,
  RuntimeEvent,
  SendTurnResult,
  WebUiBootstrap,
  XrouterProvider,
} from "./types";

export function createInitialState(): DemoState {
  return {
    status: "Loading WASM runtime…",
    isError: false,
    protocolMode: "app-server",
    runtime: null,
    authState: null,
    codexConfig: structuredClone(DEFAULT_CODEX_CONFIG),
    demoInstructions: structuredClone(DEFAULT_DEMO_INSTRUCTIONS),
    account: null,
    requiresOpenaiAuth: true,
    models: [],
    transcript: [],
    events: [],
    output: "",
  };
}

export async function loadRuntime(protocolMode: DemoProtocolMode): Promise<BrowserRuntime> {
  if (protocolMode === "responses-api") {
    return await createResponsesCodexRuntime();
  }
  if (protocolMode === "a2a") {
    return await createA2ACodexRuntime();
  }
  return await createBrowserCodexRuntime();
}

export async function saveProviderConfig(
  runtime: BrowserRuntime | null,
  codexConfig: CodexCompatibleConfig,
): Promise<{ authState: AuthState | null; codexConfig: CodexCompatibleConfig }> {
  void runtime;
  const normalizedConfig = normalizeCodexConfig(codexConfig);
  const apiKey = activeProviderApiKey(normalizedConfig);
  if (apiKey.length === 0) {
    throw new Error("Enter an API key before saving provider config.");
  }
  await saveStoredAuthState({
    authMode: "apiKey",
    openaiApiKey: apiKey,
    accessToken: null,
    refreshToken: null,
    chatgptAccountId: null,
    chatgptPlanType: null,
    lastRefreshAt: null,
  });
  await saveStoredCodexConfig(normalizedConfig);
  return {
    authState: await loadStoredAuthState(),
    codexConfig: normalizedConfig,
  };
}

export async function clearAuth(runtime: BrowserRuntime | null): Promise<{
  authState: AuthState | null;
  codexConfig: CodexCompatibleConfig;
}> {
  void runtime;
  await clearStoredAuthState();
  await clearStoredCodexConfig();
  return {
    authState: await loadStoredAuthState(),
    codexConfig: structuredClone(DEFAULT_CODEX_CONFIG),
  };
}

export async function runChatTurn(
  runtime: BrowserRuntime,
  authState: AuthState | null,
  account: Account | null,
  codexConfig: CodexCompatibleConfig,
  demoInstructions: DemoState["demoInstructions"],
  message: string,
  turnCounter: number,
): Promise<{
  transcript: DemoState["transcript"];
  output: string;
  nextTurnCounter: number;
  turnId: string;
  events: RuntimeEvent[];
}> {
  if (codexConfig.model.trim().length === 0) {
    throw new Error("Select a model before sending a message.");
  }
  if (runtime.protocolMode === "responses-api") {
    const previousResponseId = await loadStoredResponsesBinding();
    const result = await runtime.runResponsesTurn?.({
      message,
      model: codexConfig.model.trim(),
      previousResponseId,
      reasoningEffort: normalizeResponsesReasoningEffort(codexConfig.modelReasoningEffort),
    });
    if (result === undefined) {
      throw new Error("Responses runtime is not available.");
    }
    await saveStoredResponsesBinding(result.responseId);
    const threadId = await loadStoredThreadBinding();
    const nextTranscript =
      threadId === null
        ? [
            { role: "user" as const, text: message },
            { role: "assistant" as const, text: result.output },
          ]
        : threadToTranscript(
            (
              await runtime.threadRead({
                threadId,
                includeTurns: true,
              })
            ).thread,
          );
    return {
      transcript: nextTranscript,
      output: result.output,
      nextTurnCounter: turnCounter + 1,
      turnId: result.responseId,
      events: [],
    };
  }
  if (runtime.protocolMode === "a2a") {
    const previousTaskId = await loadStoredA2ATaskBinding();
    const result = await runtime.runA2ATurn?.({
      message,
      model: codexConfig.model.trim(),
      previousTaskId,
    });
    if (result === undefined) {
      throw new Error("A2A runtime is not available.");
    }
    await saveStoredThreadBinding(result.taskId);
    return {
      transcript: result.transcript,
      output: result.output,
      nextTurnCounter: turnCounter + 1,
      turnId: result.taskId,
      events: [],
    };
  }
  const threadId = await ensureThread(runtime);
  const turnEvents = await collectTurnNotifications(runtime, async () => {
    const response = await runtime.turnStart({
      threadId,
      input: [
        {
          type: "text",
          text: message,
          text_elements: [],
        },
      ],
      model: codexConfig.model.trim(),
      approvalPolicy: "on-request",
      effort: normalizeReasoningEffort(codexConfig.modelReasoningEffort),
      personality: normalizePersonality(codexConfig.personality),
    });
    return response.turn.id;
  });
  const thread = await runtime.threadRead({
    threadId,
    includeTurns: true,
  });
  await saveStoredThreadBinding(thread.thread.id);
  return {
    transcript: threadToTranscript(thread.thread),
    output: buildOutputFromEvents(turnEvents.events),
    nextTurnCounter: turnCounter + 1,
    turnId: turnEvents.turnId,
    events: turnEvents.events,
  };
}

export async function resetThread(): Promise<void> {
  const threadId = await loadStoredThreadBinding();
  if (threadId !== null) {
    await deleteStoredThreadSession(threadId);
  }
  await Promise.all([
    clearStoredThreadBinding(),
    clearStoredResponsesBinding(),
    clearStoredA2ATaskBinding(),
  ]);
}

export async function bootstrapWebUi(): Promise<WebUiBootstrap> {
  console.info("[webui] bootstrap:start");
  const baseState = createInitialState();
  const hydrated = await hydrateState();
  const state: DemoState = {
    ...baseState,
    ...hydrated,
    status: "Runtime bootstrap ready.",
    isError: false,
  };
  const nextState = await syncBootstrapState(state).catch((error) => ({
    ...state,
    runtime: null,
    models: [],
    status: `Router bootstrap pending: ${formatError(error)}`,
    isError: true,
  }));
  return {
    runtime: nextState.runtime,
    state: nextState,
    providerDraft: draftFromConfig(nextState.codexConfig, nextState.protocolMode),
  };
}

export async function refreshAccountAndModels(
  runtime: BrowserRuntime | null,
  state: DemoState,
): Promise<DemoState> {
  void runtime;
  const nextState = await syncBootstrapState(state);
  return {
    ...nextState,
    status: "Account and models refreshed.",
    isError: false,
  };
}

export async function refreshAccountAndModelsFromDraft(
  runtime: BrowserRuntime | null,
  state: DemoState,
  draft: ProviderDraft,
): Promise<{ state: DemoState; providerDraft: ProviderDraft }> {
  await saveStoredProtocolMode(draft.protocolMode);
  const saved = await saveProviderConfig(runtime, buildCodexConfig(state.codexConfig, draft));
  const refreshed = await refreshAccountAndModels(runtime, {
    ...state,
    protocolMode: draft.protocolMode,
    authState: saved.authState,
    codexConfig: saved.codexConfig,
    status: "Provider config applied.",
    isError: false,
  });
  return {
    state: refreshed,
    providerDraft: draftFromConfig(refreshed.codexConfig, refreshed.protocolMode),
  };
}

export async function saveDraftProviderConfig(
  runtime: BrowserRuntime | null,
  state: DemoState,
  draft: ProviderDraft,
): Promise<{ state: DemoState; providerDraft: ProviderDraft }> {
  await saveStoredProtocolMode(draft.protocolMode);
  const saved = await saveProviderConfig(runtime, buildCodexConfig(state.codexConfig, draft));
  const refreshed = await refreshAccountAndModels(runtime, {
    ...state,
    protocolMode: draft.protocolMode,
    authState: saved.authState,
    codexConfig: saved.codexConfig,
    status: "Provider config saved.",
    isError: false,
  });
  return {
    state: refreshed,
    providerDraft: draftFromConfig(refreshed.codexConfig, refreshed.protocolMode),
  };
}

export async function clearSavedAuth(
  runtime: BrowserRuntime | null,
  state: DemoState,
): Promise<{ state: DemoState; providerDraft: ProviderDraft }> {
  const cleared = await clearAuth(runtime);
  return {
    state: {
      ...state,
      runtime: null,
      authState: cleared.authState,
      codexConfig: cleared.codexConfig,
      account: null,
      requiresOpenaiAuth: true,
      models: [],
      transcript: [],
      output: "",
      status: "Browser auth cleared.",
      isError: false,
    },
    providerDraft: draftFromConfig(cleared.codexConfig, state.protocolMode),
  };
}

export async function runTurnFromDraft(
  runtime: BrowserRuntime,
  state: DemoState,
  draft: ProviderDraft,
  message: string,
  turnCounter: number,
): Promise<{ state: DemoState; providerDraft: ProviderDraft; result: SendTurnResult }> {
  const codexConfig = buildCodexConfig(state.codexConfig, draft);
  const result = await runChatTurn(
    runtime,
    state.authState,
    state.account,
    codexConfig,
    state.demoInstructions,
    message,
    turnCounter,
  );
  return {
    state: {
      ...state,
      codexConfig,
      transcript: result.transcript,
      output: result.output,
      status: "Turn completed.",
      isError: false,
    },
    providerDraft: draftFromConfig(codexConfig, state.protocolMode),
    result,
  };
}

export async function resetCurrentThread(runtime: BrowserRuntime, state: DemoState): Promise<DemoState> {
  void runtime;
  await resetThread();
  return {
    ...state,
    transcript: [],
    output: "",
    status: "Current thread reset.",
    isError: false,
  };
}

export function draftFromConfig(config: CodexCompatibleConfig, protocolMode: DemoProtocolMode): ProviderDraft {
  const activeProvider = config.modelProviders[config.modelProvider];
  const providerKind = activeProvider?.providerKind ?? "openai";
  return {
    protocolMode,
    transportMode:
      providerKind === "xrouter_browser"
        ? "xrouter-browser"
        : providerKind === "openai_compatible"
          ? "openai-compatible"
          : "openai",
    providerDisplayName: activeProvider?.name ?? "OpenAI",
    providerBaseUrl: activeProvider?.baseUrl ?? "https://api.openai.com/v1",
    apiKey: activeProvider === undefined ? "" : config.env[activeProvider.envKey] ?? "",
    xrouterProvider: activeProvider?.metadata?.xrouterProvider ?? "deepseek",
    modelReasoningEffort: config.modelReasoningEffort ?? "medium",
    personality: config.personality ?? "pragmatic",
    model: config.model,
  };
}

export function buildCodexConfig(base: CodexCompatibleConfig, draft: ProviderDraft): CodexCompatibleConfig {
  return materializeCodexConfig({
    transportMode: draft.transportMode,
    model: draft.model.trim(),
    runtimeMode: base.runtime_mode,
    runtimeArchitecture: base.runtime_architecture,
    modelReasoningEffort: normalizeOptionalText(draft.modelReasoningEffort),
    personality: normalizeOptionalText(draft.personality),
    displayName: draft.providerDisplayName,
    baseUrl: draft.providerBaseUrl,
    apiKey: draft.apiKey,
    xrouterProvider: draft.xrouterProvider,
  });
}

export function transportLabel(draft: ProviderDraft): string {
  const protocolLabel =
    draft.protocolMode === "responses-api"
      ? "Responses API"
      : draft.protocolMode === "a2a"
        ? "Google A2A"
        : "App Server";
  if (draft.transportMode === "xrouter-browser") {
    return `${protocolLabel} / XRouter Browser / ${providerPresetLabel(draft.xrouterProvider)}`;
  }
  if (draft.transportMode === "openai-compatible") {
    return `${protocolLabel} / OpenAI-compatible`;
  }
  return `${protocolLabel} / OpenAI`;
}

function providerPresetLabel(provider: XrouterProvider): string {
  return XROUTER_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function selectModelId(models: ModelPreset[], currentModel: string): string {
  const trimmedCurrentModel = currentModel.trim();
  if (models.some((model) => model.id === trimmedCurrentModel)) {
    return trimmedCurrentModel;
  }
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "";
}

async function ensureThread(runtime: BrowserRuntime): Promise<string> {
  const existingThreadId = await loadStoredThreadBinding();
  if (existingThreadId !== null) {
    const existing = await runtime.threadResume({
      threadId: existingThreadId,
      persistExtendedHistory: true,
    }).catch(() => null);
    if (existing !== null) {
      await saveStoredThreadBinding(existing.thread.id);
      return existing.thread.id;
    }
    await Promise.all([
      deleteStoredThreadSession(existingThreadId).catch(() => undefined),
      clearStoredThreadBinding(),
    ]);
  }
  const response = await runtime.threadStart({
    cwd: "/workspace",
    approvalPolicy: "on-request",
    ephemeral: false,
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  await saveStoredThreadBinding(response.thread.id);
  return response.thread.id;
}

async function hydrateState(): Promise<Partial<DemoState>> {
  const [authState, codexConfig, demoInstructions, protocolMode, revisionChanged, threadId] = await Promise.all([
    loadStoredAuthState(),
    loadStoredCodexConfig(),
    loadStoredDemoInstructions(),
    loadStoredProtocolMode(),
    syncStoredThreadRuntimeRevision(),
    loadStoredThreadBinding(),
  ]);
  if (revisionChanged && threadId !== null) {
    await Promise.all([
      deleteStoredThreadSession(threadId).catch(() => undefined),
      clearStoredThreadBinding(),
    ]);
  }
  return {
    authState,
    codexConfig,
    demoInstructions,
    protocolMode,
    transcript: [],
    runtime: null,
  };
}

async function syncBootstrapState(state: DemoState): Promise<DemoState> {
  const provider = getActiveProvider(state.codexConfig);
  const apiKey = activeProviderApiKey(state.codexConfig);
  const requiresOpenaiAuth = provider.providerKind === "openai" && apiKey.length === 0;
  const account =
    state.authState === null
      ? null
      : {
          email: null,
          planType: state.authState.chatgptPlanType,
          chatgptAccountId: state.authState.chatgptAccountId,
          authMode: state.authState.authMode,
        };
  const modelResult =
    apiKey.length === 0
      ? { data: [], nextCursor: null as string | null }
      : await webUiModelTransportAdapter.discoverModels(state.codexConfig);
  const codexConfig = {
    ...state.codexConfig,
    model: selectModelId(modelResult.data, state.codexConfig.model),
  };
  const runtime = codexConfig.model.length > 0 ? await loadRuntime(state.protocolMode) : null;
  let transcript = state.transcript;
  const activeThreadId = await loadStoredThreadBinding();
  if (runtime !== null && runtime.protocolMode === "app-server" && activeThreadId !== null) {
    const resumed = await runtime.threadResume({
      threadId: activeThreadId,
      persistExtendedHistory: true,
    }).catch(() => null);
    if (resumed === null) {
      await Promise.all([
        deleteStoredThreadSession(activeThreadId).catch(() => undefined),
        clearStoredThreadBinding(),
      ]);
      transcript = [];
    } else {
      const thread = await runtime.threadRead({
        threadId: resumed.thread.id,
        includeTurns: true,
      });
      await saveStoredThreadBinding(thread.thread.id);
      transcript = threadToTranscript(thread.thread);
    }
  }
  return {
    ...state,
    runtime,
    account,
    requiresOpenaiAuth,
    models: modelResult.data,
    codexConfig,
    transcript,
    status:
      apiKey.length === 0
        ? "Waiting for router API key."
        : runtime === null
          ? "Select a model to enter the terminal."
          : "Runtime ready.",
  };
}

function normalizeResponsesReasoningEffort(value: string | null): "low" | "medium" | "high" | null {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return null;
  }
}

export { formatError };

async function collectTurnNotifications(
  runtime: BrowserRuntime,
  start: () => Promise<string>,
): Promise<{ turnId: string; events: RuntimeEvent[] }> {
  return await new Promise(async (resolve, reject) => {
    let activeTurnId: string | null = null;
    const events: RuntimeEvent[] = [];
    const bufferedEvents: RuntimeEvent[] = [];
    const unsubscribe = runtime.subscribeToNotifications((notification) => {
      const event = {
        method: notification.method,
        params: ("params" in notification ? notification.params : null) as JsonValue,
      } satisfies RuntimeEvent;
      const turnId = readTurnId(event);
      if (turnId !== null) {
        bufferedEvents.push(event);
      }
      if (activeTurnId !== null && turnId === activeTurnId) {
        events.push(event);
      }
      if (activeTurnId !== null && event.method === "turn/completed" && turnId === activeTurnId) {
        unsubscribe();
        resolve({ turnId: activeTurnId, events });
      }
    });

    try {
      activeTurnId = await start();
      events.length = 0;
      events.push(...bufferedEvents.filter((event) => readTurnId(event) === activeTurnId));
    } catch (error) {
      unsubscribe();
      reject(error);
    }
  });
}

function readTurnId(event: RuntimeEvent): string | null {
  const params =
    event.params !== null && typeof event.params === "object" && !Array.isArray(event.params)
      ? (event.params as Record<string, unknown>)
      : null;
  if (params === null) {
    return null;
  }
  if (typeof params.turnId === "string") {
    return params.turnId;
  }
  const turn =
    params.turn !== null && typeof params.turn === "object" && !Array.isArray(params.turn)
      ? (params.turn as Record<string, unknown>)
      : null;
  return typeof turn?.id === "string" ? turn.id : null;
}

function normalizeReasoningEffort(value: string | null): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  switch (value) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return null;
  }
}

function normalizePersonality(value: string | null): "none" | "friendly" | "pragmatic" | null {
  switch (value) {
    case "none":
    case "friendly":
    case "pragmatic":
      return value;
    default:
      return null;
  }
}
