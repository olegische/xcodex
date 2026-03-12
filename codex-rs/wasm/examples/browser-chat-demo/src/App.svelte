<script lang="ts">
  import { onMount } from "svelte";

  import {
    clearAuth,
    connectedToolNames,
    createInitialState,
    formatError,
    hydrateState,
    listModels,
    loadWorkspaceDebugSnapshot,
    loadStoredBrowserAuthState,
    loadRuntime,
    readAccount,
    resetWorkspace,
    resetThread,
    runChatTurn,
    saveStoredInstructions,
    saveProviderConfig,
    subscribeRuntimeActivity,
  } from "./runtime";
  import type {
    BrowserRuntime,
    CodexCompatibleConfig,
    DemoInstructions,
    DemoState,
    DemoTransportMode,
    RuntimeActivity,
    WorkspaceDebugFile,
    XrouterProvider,
  } from "./types";

  const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
  const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
  const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
  const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
  const OPENAI_PROVIDER_ID = "openai";
  const XROUTER_BROWSER_PROVIDER_ID = "xrouter-browser";
  const OPENAI_COMPATIBLE_PROVIDER_ID = "external";
  const OPENAI_ENV_KEY = "OPENAI_API_KEY";
  const XROUTER_ENV_KEY = "XROUTER_API_KEY";
  const OPENAI_COMPATIBLE_ENV_KEY = "OPENAI_COMPATIBLE_API_KEY";

  const xrouterProviderOptions: ReadonlyArray<{
    value: XrouterProvider;
    label: string;
    displayName: string;
    baseUrl: string;
  }> = [
    {
      value: "deepseek",
      label: "DeepSeek",
      displayName: "DeepSeek via XRouter Browser",
      baseUrl: DEEPSEEK_API_BASE_URL,
    },
    {
      value: "openai",
      label: "OpenAI",
      displayName: "OpenAI via XRouter Browser",
      baseUrl: OPENAI_API_BASE_URL,
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      displayName: "OpenRouter via XRouter Browser",
      baseUrl: OPENROUTER_API_BASE_URL,
    },
    {
      value: "zai",
      label: "ZAI",
      displayName: "ZAI via XRouter Browser",
      baseUrl: ZAI_API_BASE_URL,
    },
  ];

  let state: DemoState = createInitialState();
  let message = "привет, как дела?";
  let transportMode: DemoTransportMode = "xrouter-browser";
  let providerDisplayName = "DeepSeek via XRouter Browser";
  let providerBaseUrl = DEEPSEEK_API_BASE_URL;
  let apiKey = "";
  let xrouterProvider: XrouterProvider = "deepseek";
  let modelReasoningEffort = "medium";
  let personality = "pragmatic";
  let baseInstructions = "";
  let agentsDirectory = "/workspace";
  let agentsInstructions = "";
  let skillName = "browser-skill";
  let skillPath = "skills/browser/SKILL.md";
  let skillContents = "";
  let turnCounter = 1;
  const connectedTools = connectedToolNames();
  let liveActivities: RuntimeActivity[] = [];
  let liveStreamText = "";
  let workspaceFiles: WorkspaceDebugFile[] = [];
  const REDACTED = "[redacted]";

  function debugInfo(message: string, payload?: unknown) {
    console.info(`[browser-chat-demo] ${message}`, sanitizeDebugPayload(payload) ?? "");
  }

  function debugError(message: string, error: unknown) {
    console.error(`[browser-chat-demo] ${message}`, error);
  }

  function sanitizeDebugPayload(payload: unknown): unknown {
    if (payload === null || payload === undefined) {
      return payload;
    }
    if (Array.isArray(payload)) {
      return payload.map(sanitizeDebugPayload);
    }
    if (typeof payload !== "object") {
      return payload;
    }

    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => {
        if (key === "env" && value !== null && typeof value === "object" && !Array.isArray(value)) {
          return [
            key,
            Object.fromEntries(
              Object.entries(value).map(([envKey, envValue]) => [
                envKey,
                typeof envValue === "string" && envValue.length > 0 ? REDACTED : envValue,
              ]),
            ),
          ];
        }

        if (/(api[-_]?key|token|secret)/i.test(key)) {
          if (value === null) {
            return [key, null];
          }
          if (typeof value === "string") {
            return [key, value.length > 0 ? REDACTED : value];
          }
          return [key, REDACTED];
        }

        return [key, sanitizeDebugPayload(value)];
      }),
    );
  }

  onMount(async () => {
    const unsubscribe = subscribeRuntimeActivity((activity) => {
      liveActivities = [...liveActivities, activity].slice(-40);
      if (activity.type === "turnStart" && !activity.requestId.includes(":")) {
        liveStreamText = "";
      }
      if (activity.type === "delta") {
        liveStreamText += activity.text;
      }
    });
    let runtime: BrowserRuntime;
    try {
      debugInfo("loading wasm runtime");
      runtime = await loadRuntime();
      debugInfo("wasm runtime loaded");
    } catch (error) {
      debugError("failed to load wasm runtime", error);
      state = {
        ...state,
        status: [
          "WASM pkg not found yet.",
          "",
          "Build it from this directory with:",
          "  ./build-demo.sh",
          "",
          `Load error: ${formatError(error)}`,
        ].join("\n"),
        isError: true,
      };
      return;
    }

    try {
      debugInfo("hydrateState:start");
      const hydrated = await hydrateState(runtime);
      debugInfo("hydrateState:done", hydrated);
      state = {
        ...state,
        ...hydrated,
        status: "WASM runtime ready. Load auth or send a message.",
        isError: false,
      };
      syncConfigInputs(hydrated.codexConfig ?? state.codexConfig);
      syncInstructionInputs(hydrated.demoInstructions ?? state.demoInstructions);
      workspaceFiles = await loadWorkspaceDebugSnapshot();
      debugInfo("refreshAccountAndModels:start");
      await refreshAccountAndModels(runtime);
      debugInfo("refreshAccountAndModels:done");
    } catch (error) {
      debugError("browser host initialization failed", error);
      state = {
        ...state,
        runtime,
        status: `WASM runtime loaded, but browser host initialization failed: ${formatError(error)}`,
        isError: true,
      };
    }
    return () => {
      unsubscribe();
    };
  });

  async function handleSaveProviderConfig() {
    const runtime = requireRuntime();
    try {
      debugInfo("saveProviderConfig:start", buildDraftCodexConfig(state.codexConfig.model));
      const saved = await saveProviderConfig(runtime, buildDraftCodexConfig(state.codexConfig.model));
      debugInfo("saveProviderConfig:done", {
        authState: saved.authState,
        codexConfig: saved.codexConfig,
      });
      state = {
        ...state,
        authState: saved.authState,
        codexConfig: saved.codexConfig,
        status: "Provider config saved into browser storage.",
        isError: false,
      };
      syncConfigInputs(saved.codexConfig);
      debugInfo("postSave:refreshAccountAndModels:start");
      await refreshAccountAndModels(runtime);
      debugInfo("postSave:refreshAccountAndModels:done");
    } catch (error) {
      debugError("saveProviderConfig:failed", error);
      fail(`Failed to save provider config: ${formatError(error)}`);
    }
  }

  async function handleClearAuth() {
    const runtime = requireRuntime();
    try {
      const cleared = await clearAuth(runtime);
      syncConfigInputs(cleared.codexConfig);
      state = {
        ...state,
        authState: cleared.authState,
        codexConfig: cleared.codexConfig,
        account: null,
        requiresOpenaiAuth: true,
        models: [],
        status: "Browser auth state cleared.",
        isError: false,
      };
    } catch (error) {
      fail(`Failed to clear auth: ${formatError(error)}`);
    }
  }

  async function handleRefreshAccount() {
    const runtime = requireRuntime();
    try {
      await refreshAccountAndModels(runtime, false);
      state = {
        ...state,
        status: "Account refreshed.",
        isError: false,
      };
    } catch (error) {
      fail(`Failed to read account: ${formatError(error)}`);
    }
  }

  async function handleRefreshModels() {
    const runtime = requireRuntime();
    try {
      const modelsResponse = await listModels(runtime);
      const nextModel = selectModelId(modelsResponse.data, state.codexConfig.model);
      state = {
        ...state,
        models: modelsResponse.data,
        codexConfig: {
          ...state.codexConfig,
          model: nextModel,
        },
        status: "Models refreshed.",
        isError: false,
      };
    } catch (error) {
      fail(`Failed to load models: ${formatError(error)}`);
    }
  }

  async function handleSendMessage() {
    const runtime = requireRuntime();
    if (message.trim().length === 0) {
      fail("Enter a message before sending.");
      return;
    }

    try {
      debugInfo("runTurn:start", {
        model: state.codexConfig.model,
        transportMode,
        message: message.trim(),
      });
      liveActivities = [];
      liveStreamText = "";
      state = {
        ...state,
        status: "Running browser chat turn…",
        isError: false,
      };

      const result = await runChatTurn(
        runtime,
        state.authState,
        state.account,
        state.codexConfig,
        buildDraftInstructions(),
        message.trim(),
        turnCounter,
      );

      debugInfo("runTurn:done", {
        events: result.dispatch.events.length,
        transcript: result.transcript.length,
        outputLength: result.output.length,
      });
      turnCounter = result.nextTurnCounter;
      workspaceFiles = await loadWorkspaceDebugSnapshot();
      state = {
        ...state,
        transcript: result.transcript,
        events: result.dispatch.events,
        output: result.output,
        status: "Browser chat turn completed.",
        isError: false,
      };
    } catch (error) {
      debugError("runTurn:failed", error);
      fail(`Chat turn failed: ${formatError(error)}`);
    }
  }

  async function handleResetThread() {
    try {
      await resetThread();
      turnCounter = 1;
      state = {
        ...state,
        transcript: [],
        events: [],
        output: "",
        status: "Chat thread reset.",
        isError: false,
      };
    } catch (error) {
      fail(`Failed to reset thread: ${formatError(error)}`);
    }
  }

  async function handleResetWorkspace() {
    try {
      await resetWorkspace();
      workspaceFiles = await loadWorkspaceDebugSnapshot();
      state = {
        ...state,
        status: "Workspace reset.",
        isError: false,
      };
    } catch (error) {
      fail(`Failed to reset workspace: ${formatError(error)}`);
    }
  }

  async function handleSaveInstructions() {
    try {
      const saved = await saveStoredInstructions(buildDraftInstructions());
      syncInstructionInputs(saved);
      state = {
        ...state,
        demoInstructions: saved,
        status: "Browser instructions saved.",
        isError: false,
      };
    } catch (error) {
      fail(`Failed to save instructions: ${formatError(error)}`);
    }
  }

  async function refreshAccountAndModels(runtime: BrowserRuntime, refreshModelsToo = true) {
    debugInfo("readAccount:start");
    const accountResponse = await readAccount(runtime);
    debugInfo("readAccount:done", accountResponse);
    debugInfo("browserStorage.loadAuthState:start");
    const authState = await loadStoredBrowserAuthState();
    debugInfo("browserStorage.loadAuthState:done", authState);
    const nextCodexConfig = buildDraftCodexConfig(state.codexConfig.model);
    state = {
      ...state,
      authState,
      codexConfig: nextCodexConfig,
      account: accountResponse.account,
      requiresOpenaiAuth: accountResponse.requiresOpenaiAuth,
    };

    if (refreshModelsToo) {
      debugInfo("listModels:start");
      const modelsResponse = await listModels(runtime);
      debugInfo("listModels:done", modelsResponse);
      state = {
        ...state,
        models: modelsResponse.data,
        codexConfig: {
          ...state.codexConfig,
          model: selectModelId(modelsResponse.data, state.codexConfig.model),
        },
      };
    }
  }

  function requireRuntime(): BrowserRuntime {
    if (state.runtime === null) {
      throw new Error("WASM runtime is not ready yet.");
    }
    return state.runtime;
  }

  function fail(message: string) {
    state = {
      ...state,
      status: message,
      isError: true,
    };
  }

  function syncConfigInputs(config: CodexCompatibleConfig) {
    const activeProvider = config.modelProviders[config.modelProvider];
    const providerKind = activeProvider?.providerKind ?? "openai";
    transportMode =
      providerKind === "xrouter_browser"
        ? "xrouter-browser"
        : providerKind === "openai_compatible"
          ? "openai-compatible"
          : "openai";
    providerDisplayName = activeProvider?.name ?? "OpenAI";
    providerBaseUrl = activeProvider?.baseUrl ?? OPENAI_API_BASE_URL;
    apiKey = activeProvider === undefined ? "" : config.env[activeProvider.envKey] ?? "";
    xrouterProvider = activeProvider?.metadata?.xrouterProvider ?? "deepseek";
    modelReasoningEffort = config.modelReasoningEffort ?? "medium";
    personality = config.personality ?? "pragmatic";
  }

  function syncInstructionInputs(instructions: DemoInstructions) {
    baseInstructions = instructions.baseInstructions;
    agentsDirectory = instructions.agentsDirectory;
    agentsInstructions = instructions.agentsInstructions;
    skillName = instructions.skillName;
    skillPath = instructions.skillPath;
    skillContents = instructions.skillContents;
  }

  function buildDraftInstructions(): DemoInstructions {
    return {
      baseInstructions,
      agentsDirectory,
      agentsInstructions,
      skillName,
      skillPath,
      skillContents,
    };
  }

  function buildDraftCodexConfig(model: string): CodexCompatibleConfig {
    const trimmedBaseUrl = providerBaseUrl.trim().replace(/\/+$/, "");
    if (transportMode === "openai") {
      return {
        model: model.trim(),
        modelProvider: OPENAI_PROVIDER_ID,
        modelReasoningEffort: normalizeOptionalText(modelReasoningEffort),
        personality: normalizeOptionalText(personality),
        modelProviders: {
          [OPENAI_PROVIDER_ID]: {
            name: providerDisplayName.trim() || "OpenAI",
            baseUrl: trimmedBaseUrl || OPENAI_API_BASE_URL,
            envKey: OPENAI_ENV_KEY,
            providerKind: "openai",
            wireApi: "responses",
            metadata: null,
          },
        },
        env: {
          [OPENAI_ENV_KEY]: apiKey.trim(),
        },
      };
    }

    if (transportMode === "xrouter-browser") {
      const preset = xrouterProviderOptions.find((option) => option.value === xrouterProvider);
      return {
        model: model.trim(),
        modelProvider: XROUTER_BROWSER_PROVIDER_ID,
        modelReasoningEffort: normalizeOptionalText(modelReasoningEffort),
        personality: normalizeOptionalText(personality),
        modelProviders: {
          [XROUTER_BROWSER_PROVIDER_ID]: {
            name: providerDisplayName.trim() || preset?.displayName || "XRouter Browser",
            baseUrl: trimmedBaseUrl || preset?.baseUrl || DEEPSEEK_API_BASE_URL,
            envKey: XROUTER_ENV_KEY,
            providerKind: "xrouter_browser",
            wireApi: "responses",
            metadata: {
              xrouterProvider,
            },
          },
        },
        env: {
          [XROUTER_ENV_KEY]: apiKey.trim(),
        },
      };
    }

    return {
      model: model.trim(),
      modelProvider: OPENAI_COMPATIBLE_PROVIDER_ID,
      modelReasoningEffort: normalizeOptionalText(modelReasoningEffort),
      personality: normalizeOptionalText(personality),
      modelProviders: {
        [OPENAI_COMPATIBLE_PROVIDER_ID]: {
          name: providerDisplayName.trim() || "OpenAI-Compatible Server",
          baseUrl: trimmedBaseUrl,
          envKey: OPENAI_COMPATIBLE_ENV_KEY,
          providerKind: "openai_compatible",
          wireApi: "responses",
          metadata: null,
        },
      },
      env: {
        [OPENAI_COMPATIBLE_ENV_KEY]: apiKey.trim(),
      },
    };
  }

  function selectModelId(models: DemoState["models"], currentModel: string): string {
    const trimmedCurrentModel = currentModel.trim();
    if (models.some((model) => model.id === trimmedCurrentModel)) {
      return trimmedCurrentModel;
    }
    return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "";
  }

  function normalizeOptionalText(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  function onModelChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    state = {
      ...state,
      codexConfig: {
        ...state.codexConfig,
        model: target.value,
      },
    };
  }

  function selectModelFromCard(modelId: string) {
    state = {
      ...state,
      codexConfig: {
        ...state.codexConfig,
        model: modelId,
      },
    };
  }

  function onTransportModeChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    transportMode =
      target.value === "xrouter-browser"
        ? "xrouter-browser"
        : target.value === "openai-compatible"
          ? "openai-compatible"
          : "openai";

    if (transportMode === "openai") {
      providerDisplayName = "OpenAI";
      providerBaseUrl = OPENAI_API_BASE_URL;
    } else if (transportMode === "xrouter-browser") {
      applyXrouterProviderPreset(xrouterProvider);
    } else {
      providerDisplayName = "OpenAI-Compatible Server";
      providerBaseUrl = "";
    }

    state = {
      ...state,
      codexConfig: buildDraftCodexConfig(""),
      models: [],
    };
  }

  function onXrouterProviderChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    xrouterProvider = target.value as XrouterProvider;
    applyXrouterProviderPreset(xrouterProvider);
    state = {
      ...state,
      codexConfig: buildDraftCodexConfig(""),
      models: [],
    };
  }

  function applyXrouterProviderPreset(provider: XrouterProvider) {
    const option = xrouterProviderOptions.find((entry) => entry.value === provider);
    if (option === undefined) {
      return;
    }
    providerDisplayName = option.displayName;
    providerBaseUrl = option.baseUrl;
  }

  function formatAuthStateForDisplay(value: unknown): string {
    if (value === null) {
      return "No auth state in browser storage.";
    }
    if (typeof value !== "object") {
      return JSON.stringify(value, null, 2);
    }

    const authState = {
      ...(value as Record<string, unknown>),
      openaiApiKey:
        typeof (value as Record<string, unknown>).openaiApiKey === "string"
          ? redactSecret((value as Record<string, unknown>).openaiApiKey as string)
          : (value as Record<string, unknown>).openaiApiKey,
      accessToken:
        typeof (value as Record<string, unknown>).accessToken === "string"
          ? redactSecret((value as Record<string, unknown>).accessToken as string)
          : (value as Record<string, unknown>).accessToken,
      refreshToken:
        typeof (value as Record<string, unknown>).refreshToken === "string"
          ? redactSecret((value as Record<string, unknown>).refreshToken as string)
          : (value as Record<string, unknown>).refreshToken,
    };

    return JSON.stringify(authState, null, 2);
  }

  function formatCodexConfigForDisplay(config: CodexCompatibleConfig): string {
    return JSON.stringify(
      {
        ...config,
        env: Object.fromEntries(
          Object.entries(config.env).map(([key, value]) => [key, typeof value === "string" ? redactSecret(value) : value]),
        ),
      },
      null,
      2,
    );
  }

  function redactSecret(secret: string): string {
    if (secret.length <= 8) {
      return "********";
    }
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
  }

  function formatWorkspacePreview(file: WorkspaceDebugFile): string {
    return file.content.length === 0 ? "(empty file)" : file.preview;
  }

  $: authText = formatAuthStateForDisplay(state.authState);
  $: codexConfigText = formatCodexConfigForDisplay(state.codexConfig);
  $: accountText = JSON.stringify(
    {
      account: state.account,
      requiresOpenaiAuth: state.requiresOpenaiAuth,
    },
    null,
    2,
  );
  $: modelsText = state.models.length === 0 ? "No models loaded yet." : JSON.stringify(state.models, null, 2);
  $: transcriptText =
    state.transcript.length === 0
      ? "No messages yet."
      : state.transcript.map((entry) => `${entry.role.toUpperCase()}\n${entry.text}`).join("\n\n");
  $: eventsText = state.events.length === 0 ? "No events yet." : JSON.stringify(state.events, null, 2);
  $: instructionSnapshotText = JSON.stringify(buildDraftInstructions(), null, 2);
  $: outputText = state.output.length === 0 ? "No output yet." : state.output;
  $: liveActivityText =
    liveActivities.length === 0
      ? "No live activity yet."
      : liveActivities
          .map((activity) => {
            switch (activity.type) {
              case "turnStart":
                return `[turnStart] ${activity.requestId} model=${activity.model}`;
              case "delta":
                return `[delta] ${activity.requestId} ${activity.text}`;
              case "toolCall":
                return `[toolCall] ${activity.requestId} ${activity.toolName ?? "unknown"} ${typeof activity.arguments === "string" ? activity.arguments : JSON.stringify(activity.arguments)}`;
              case "toolOutput":
                return `[toolOutput] ${activity.requestId} ${activity.callId ?? "unknown"} ${JSON.stringify(activity.output)}`;
              case "assistantMessage":
                return `[assistantMessage] ${activity.requestId} ${JSON.stringify(activity.content)}`;
              case "completed":
                return `[completed] ${activity.requestId} finishReason=${activity.finishReason ?? "none"}`;
              case "error":
                return `[error] ${activity.requestId} ${activity.message}`;
            }
          })
          .join("\n\n");
</script>

<main class="shell">
  <section class="hero">
    <p class="eyebrow">Codex WASM</p>
    <h1>Browser Chat Demo</h1>
    <p class="lede">
      Browser-hosted auth state, codex-compatible provider config, and a minimal chat turn loop on top of
      the WASM runtime.
    </p>
    <p class:status={true} class:error={state.isError}>{state.status}</p>
  </section>

  <section class="grid">
    <article class="panel">
      <div class="panel-head">
        <h2>Auth State</h2>
        <span class="badge">browser host</span>
      </div>
      <div class="stack">
        <label class="field">
          <span>Transport</span>
          <select value={transportMode} on:change={onTransportModeChange}>
            <option value="openai">OpenAI</option>
            <option value="xrouter-browser">XRouter Browser</option>
            <option value="openai-compatible">OpenAI-compatible server</option>
          </select>
        </label>
        {#if transportMode === "xrouter-browser"}
          <label class="field">
            <span>XRouter provider</span>
            <select value={xrouterProvider} on:change={onXrouterProviderChange}>
              {#each xrouterProviderOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="field">
          <span>Provider name</span>
          <input bind:value={providerDisplayName} />
        </label>
        <label class="field">
          <span>{transportMode === "xrouter-browser" ? "Upstream Base URL" : "Base URL"}</span>
          <input bind:value={providerBaseUrl} placeholder="https://api.openai.com/v1 or http://localhost:8900/api/v1" />
        </label>
        <label class="field">
          <span>API key</span>
          <input bind:value={apiKey} type="password" placeholder="sk-..." autocomplete="off" />
        </label>
        <label class="field">
          <span>Reasoning effort</span>
          <input bind:value={modelReasoningEffort} placeholder="medium" />
        </label>
        <label class="field">
          <span>Personality</span>
          <input bind:value={personality} placeholder="pragmatic" />
        </label>
        <p class="hint">
          {#if transportMode === "xrouter-browser"}
            The saved config stays codex-compatible, but browser runtime routes the request through embedded `xrouter-browser`.
          {:else if transportMode === "openai-compatible"}
            Use this for any external `/models` + `/responses` server, including a real XRouter HTTP endpoint.
          {:else}
            Direct OpenAI path for baseline validation.
          {/if}
        </p>
        <div class="actions">
          <button on:click={handleSaveProviderConfig} disabled={state.runtime === null}>Save Provider Config</button>
          <button class="ghost" on:click={handleClearAuth} disabled={state.runtime === null}>Clear Auth</button>
        </div>
      </div>
      <pre class="code">{authText}</pre>
    </article>

    <article class="panel">
      <div class="panel-head">
        <h2>Codex Config</h2>
        <span class="badge">browser host</span>
      </div>
      <pre class="code">{codexConfigText}</pre>
    </article>

    <article class="panel wide">
      <div class="panel-head">
        <h2>Instructions</h2>
        <span class="badge">browser storage</span>
      </div>
      <div class="instruction-grid">
        <label class="field">
          <span>Base Instructions</span>
          <textarea bind:value={baseInstructions} rows="4" placeholder="Shared base instructions for the turn"></textarea>
        </label>
        <label class="field">
          <span>AGENTS.md</span>
          <textarea bind:value={agentsInstructions} rows="6" placeholder="Repository instructions"></textarea>
        </label>
        <label class="field">
          <span>SKILL.md</span>
          <textarea bind:value={skillContents} rows="6" placeholder="Skill contents"></textarea>
        </label>
      </div>
      <div class="actions">
        <button on:click={handleSaveInstructions}>Save Instructions</button>
        <button class="ghost" on:click={handleResetWorkspace}>Reset Workspace</button>
      </div>
      <pre class="code small">{instructionSnapshotText}</pre>
    </article>

    <article class="panel wide">
      <div class="panel-head">
        <h2>Live Turn</h2>
        <span class="badge">realtime</span>
      </div>
      <div class="live-grid">
        <div class="live-card">
          <h3>Streaming Output</h3>
          <pre class="code live">{liveStreamText.length === 0 ? "No streamed text yet." : liveStreamText}</pre>
        </div>
        <div class="live-card">
          <h3>Tool Activity</h3>
          <pre class="code live">{liveActivityText}</pre>
        </div>
      </div>
    </article>

    <article class="panel">
      <div class="panel-head">
        <h2>Connected Tools</h2>
        <span class="badge">runtime</span>
      </div>
      <p class="hint">These are the tools currently exposed by the WASM runtime to the model.</p>
      <ul class="tool-list">
        {#each connectedTools as tool}
          <li>{tool}</li>
        {/each}
      </ul>
    </article>

    <article class="panel">
      <div class="panel-head">
        <h2>Workspace Files</h2>
        <span class="badge">{workspaceFiles.length} files</span>
      </div>
      {#if workspaceFiles.length === 0}
        <p class="hint">Workspace is empty.</p>
      {:else}
        <div class="workspace-grid">
          {#each workspaceFiles as file}
            <article class="workspace-card">
              <div class="workspace-head">
                <strong>{file.path}</strong>
                <span>{file.bytes} bytes</span>
              </div>
              <pre class="code small">{formatWorkspacePreview(file)}</pre>
            </article>
          {/each}
        </div>
      {/if}
    </article>

    <article class="panel">
      <div class="panel-head">
        <h2>Account</h2>
        <span class="badge">readAccount</span>
      </div>
      <div class="actions">
        <button on:click={handleRefreshAccount} disabled={state.runtime === null}>Refresh Account</button>
      </div>
      <pre class="code">{accountText}</pre>
    </article>

    <article class="panel">
      <div class="panel-head">
        <h2>Model Picker</h2>
        <span class="badge">listModels</span>
      </div>
      <div class="stack">
        <div class="actions">
          <button on:click={handleRefreshModels} disabled={state.runtime === null}>Refresh Models</button>
        </div>
        <label class="field">
          <span>Selected model</span>
          <select value={state.codexConfig.model} on:change={onModelChange}>
            {#if state.models.length === 0}
              <option value="">No models available</option>
            {:else}
              {#each state.models as model}
                <option value={model.id}>
                  {model.isDefault ? `${model.displayName} (default)` : model.displayName}
                </option>
              {/each}
            {/if}
          </select>
        </label>
      </div>
      {#if state.models.length > 0}
        <ul class="model-list">
          {#each state.models as model}
            <li class:selected={model.id === state.codexConfig.model}>
              <button type="button" class="model-card" on:click={() => selectModelFromCard(model.id)}>
                <strong>{model.displayName}</strong>
                <span>{model.id}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <pre class="code small">{modelsText}</pre>
      {/if}
    </article>

    <article class="panel wide">
      <div class="panel-head">
        <h2>Chat</h2>
        <span class="badge">runTurn</span>
      </div>
      <div class="composer">
        <label class="field grow">
          <span>Message</span>
          <textarea bind:value={message} rows="4"></textarea>
        </label>
        <div class="actions composer-actions">
          <button on:click={handleSendMessage} disabled={state.runtime === null || state.codexConfig.model.length === 0}>
            Send Message
          </button>
          <button class="ghost" on:click={handleResetThread} disabled={state.runtime === null}>Reset Thread</button>
        </div>
      </div>
      <pre class="code tall">{transcriptText}</pre>
    </article>

    <article class="panel wide">
      <div class="panel-head">
        <h2>Turn Events</h2>
        <span class="badge">WASM runtime</span>
      </div>
      <pre class="code tall">{eventsText}</pre>
    </article>

    <article class="panel wide">
      <div class="panel-head">
        <h2>Model Output</h2>
        <span class="badge">streaming</span>
      </div>
      <pre class="code tall">{outputText}</pre>
    </article>
  </section>
</main>
