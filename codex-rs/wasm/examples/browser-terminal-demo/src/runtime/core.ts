import { DEFAULT_CODEX_CONFIG, DEFAULT_DEMO_INSTRUCTIONS, THREAD_ID, TURN_PREFIX, XROUTER_PROVIDER_OPTIONS } from "./constants";
import { loadRuntimeModule } from "./assets";
import { createBrowserRuntimeHost } from "./host";
import { buildOutputFromDispatch, assertRuntimeDispatch, snapshotToTranscript } from "./transcript";
import {
  clearStoredAuthState,
  clearStoredCodexConfig,
  deleteStoredSession,
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredDemoInstructions,
  saveStoredAuthState,
  saveStoredCodexConfig,
} from "./storage";
import { activeProviderApiKey, formatError, getActiveProvider, materializeCodexConfig, normalizeCodexConfig, normalizeDemoInstructions, normalizeHostValue } from "./utils";
import type {
  Account,
  AuthState,
  BrowserRuntime,
  CodexCompatibleConfig,
  DemoState,
  ModelPreset,
  ProviderDraft,
  RuntimeDispatch,
  SendTurnResult,
  WebUiBootstrap,
  XrouterProvider,
} from "./types";

export function createInitialState(): DemoState {
  return {
    status: "Loading WASM runtime…",
    isError: false,
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

export async function loadRuntime(): Promise<BrowserRuntime> {
  const wasm = await loadRuntimeModule();
  return new wasm.WasmBrowserRuntime(createBrowserRuntimeHost());
}

export async function hydrateState(runtime: BrowserRuntime): Promise<Partial<DemoState>> {
  const authState = normalizeHostValue(await runtime.loadAuthState()) as AuthState | null;
  const codexConfig = await loadStoredCodexConfig();
  const demoInstructions = await loadStoredDemoInstructions();
  await deleteStoredSession(THREAD_ID);
  return {
    authState,
    codexConfig,
    demoInstructions,
    transcript: [],
    runtime,
  };
}

export async function saveProviderConfig(
  runtime: BrowserRuntime,
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

export async function clearAuth(runtime: BrowserRuntime): Promise<{
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

export async function readAccount(
  runtime: BrowserRuntime,
): Promise<{ account: Account | null; requiresOpenaiAuth: boolean }> {
  return normalizeHostValue(await runtime.readAccount({ refreshToken: false })) as {
    account: Account | null;
    requiresOpenaiAuth: boolean;
  };
}

export async function listModels(
  runtime: BrowserRuntime,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  return normalizeHostValue(await runtime.listModels({ cursor: null, limit: 20 })) as {
    data: ModelPreset[];
    nextCursor: string | null;
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
  dispatch: RuntimeDispatch;
  transcript: DemoState["transcript"];
  output: string;
  nextTurnCounter: number;
}> {
  if (codexConfig.model.trim().length === 0) {
    throw new Error("Select a model before sending a message.");
  }
  await ensureThread(runtime);
  const turnId = `${TURN_PREFIX}-${turnCounter}`;
  const dispatch = normalizeHostValue(
    await runtime.runTurn({
      threadId: THREAD_ID,
      turnId,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: message }],
        },
      ],
      modelPayload: {
        mode: "chat",
        model: codexConfig.model.trim(),
        authState,
        account,
        baseInstructions: demoInstructions.baseInstructions,
      },
    }),
  ) as RuntimeDispatch;

  assertRuntimeDispatch(dispatch);
  return {
    dispatch,
    transcript: snapshotToTranscript(dispatch.value),
    output: buildOutputFromDispatch(dispatch),
    nextTurnCounter: turnCounter + 1,
  };
}

export async function resetThread(): Promise<void> {
  await deleteStoredSession(THREAD_ID);
}

export async function bootstrapWebUi(): Promise<WebUiBootstrap> {
  console.info("[webui] bootstrap:start");
  const baseState = createInitialState();
  const runtime = await loadRuntime();
  const hydrated = await hydrateState(runtime);
  const state: DemoState = {
    ...baseState,
    ...hydrated,
    runtime,
    status: "Runtime ready.",
    isError: false,
  };
  const accountResult = await readAccount(runtime);
  const modelResult = await listModels(runtime);
  const nextState: DemoState = {
    ...state,
    account: accountResult.account,
    requiresOpenaiAuth: accountResult.requiresOpenaiAuth,
    models: modelResult.data,
    codexConfig: {
      ...state.codexConfig,
      model: selectModelId(modelResult.data, state.codexConfig.model),
    },
  };
  return {
    runtime,
    state: nextState,
    providerDraft: draftFromConfig(nextState.codexConfig),
  };
}

export async function refreshAccountAndModels(runtime: BrowserRuntime, state: DemoState): Promise<DemoState> {
  const [accountResult, modelResult] = await Promise.all([readAccount(runtime), listModels(runtime)]);
  return {
    ...state,
    account: accountResult.account,
    requiresOpenaiAuth: accountResult.requiresOpenaiAuth,
    models: modelResult.data,
    codexConfig: {
      ...state.codexConfig,
      model: selectModelId(modelResult.data, state.codexConfig.model),
    },
    status: "Account and models refreshed.",
    isError: false,
  };
}

export async function refreshAccountAndModelsFromDraft(
  runtime: BrowserRuntime,
  state: DemoState,
  draft: ProviderDraft,
): Promise<{ state: DemoState; providerDraft: ProviderDraft }> {
  const saved = await saveProviderConfig(runtime, buildCodexConfig(state.codexConfig, draft));
  const refreshed = await refreshAccountAndModels(runtime, {
    ...state,
    authState: saved.authState,
    codexConfig: saved.codexConfig,
    status: "Provider config applied.",
    isError: false,
  });
  return {
    state: refreshed,
    providerDraft: draftFromConfig(refreshed.codexConfig),
  };
}

export async function saveDraftProviderConfig(
  runtime: BrowserRuntime,
  state: DemoState,
  draft: ProviderDraft,
): Promise<{ state: DemoState; providerDraft: ProviderDraft }> {
  const saved = await saveProviderConfig(runtime, buildCodexConfig(state.codexConfig, draft));
  const refreshed = await refreshAccountAndModels(runtime, {
    ...state,
    authState: saved.authState,
    codexConfig: saved.codexConfig,
    status: "Provider config saved.",
    isError: false,
  });
  return {
    state: refreshed,
    providerDraft: draftFromConfig(refreshed.codexConfig),
  };
}

export async function clearSavedAuth(
  runtime: BrowserRuntime,
  state: DemoState,
): Promise<{ state: DemoState; providerDraft: ProviderDraft }> {
  const cleared = await clearAuth(runtime);
  return {
    state: {
      ...state,
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
    providerDraft: draftFromConfig(cleared.codexConfig),
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
    providerDraft: draftFromConfig(codexConfig),
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

export function draftFromConfig(config: CodexCompatibleConfig): ProviderDraft {
  const activeProvider = config.modelProviders[config.modelProvider];
  const providerKind = activeProvider?.providerKind ?? "openai";
  return {
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
    modelReasoningEffort: normalizeOptionalText(draft.modelReasoningEffort),
    personality: normalizeOptionalText(draft.personality),
    displayName: draft.providerDisplayName,
    baseUrl: draft.providerBaseUrl,
    apiKey: draft.apiKey,
    xrouterProvider: draft.xrouterProvider,
  });
}

export function transportLabel(draft: ProviderDraft): string {
  if (draft.transportMode === "xrouter-browser") {
    return `XRouter Browser / ${providerPresetLabel(draft.xrouterProvider)}`;
  }
  if (draft.transportMode === "openai-compatible") {
    return "OpenAI-compatible";
  }
  return "OpenAI";
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

async function ensureThread(runtime: BrowserRuntime): Promise<void> {
  const existing = await runtime.resumeThread({ threadId: THREAD_ID }).then(normalizeHostValue).catch(() => null);
  if (existing !== null) {
    return;
  }
  await runtime.startThread({
    threadId: THREAD_ID,
    metadata: {
      workspaceRoot: "/browser-terminal",
      terminal: true,
    },
  });
}

export { formatError };
