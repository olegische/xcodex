<script lang="ts">
  import { onMount } from "svelte";
  import XtermTerminal from "./lib/XtermTerminal.svelte";

  import { collaborationStore } from "./stores/collaboration";
  import {
    CONNECTED_TOOL_NAMES,
    XROUTER_PROVIDER_OPTIONS,
  } from "./runtime/constants";
  import {
    bootstrapWebUi,
    clearSavedAuth,
    createInitialState,
    draftFromConfig,
    formatError,
    refreshAccountAndModelsFromDraft,
    resetCurrentThread,
    runTurnFromDraft,
    saveDraftProviderConfig,
    subscribeRuntimeActivity,
    transportLabel,
    type DemoState,
    type ProviderDraft,
    type RuntimeActivity,
  } from "./runtime";
  import { buildStatusLines } from "./runtime/status-board";

  const activityLimit = 80;

  let state: DemoState;
  let providerDraft: ProviderDraft;
  let booting = true;
  let running = false;
  let turnCounter = 1;
  let prompt = "";
  let liveAssistantText = "";
  let pendingUserText: string | null = null;
  let activeRequestId: string | null = null;
  let runtimeActivities: RuntimeActivity[] = [];
  let approvalAnswers: Record<string, string> = {};
  let approvalRequestId: string | null = null;
  let settingsOpen = false;

  state = createInitialState();
  providerDraft = draftFromConfig(state.codexConfig);

  $: collaborationState = $collaborationStore;
  $: currentApproval = collaborationState.currentRequest;
  $: promptDisabled = state.runtime === null || running;
  $: setupRequired = !booting && (providerDraft.apiKey.trim().length === 0 || state.runtime === null);
  $: selectedModelLabel =
    providerDraft.model.trim() ||
    state.codexConfig.model ||
    state.models.find((model) => model.isDefault)?.id ||
    state.models[0]?.id ||
    "no-model";
  $: if (setupRequired) {
    settingsOpen = true;
  }
  $: visibleTranscript = pendingUserText === null
    ? state.transcript
    : [...state.transcript, { role: "user" as const, text: pendingUserText }];
  $: activityLines = runtimeActivities.slice(-12).map(formatActivityLine);
  $: statusLines = buildStatusLines({
    state,
    runtimeActivities,
    running,
    activeRequestId,
    pendingPrompt: prompt,
    approvalCount: currentApproval === null ? 0 : 1,
  });
  $: if (currentApproval?.id !== approvalRequestId) {
    approvalRequestId = currentApproval?.id ?? null;
    approvalAnswers = {};
  }

  onMount(() => {
    const unsubscribe = subscribeRuntimeActivity((activity) => {
      runtimeActivities = [...runtimeActivities, activity].slice(-activityLimit);
      if (activity.type === "turnStart" && !activity.requestId.includes(":")) {
        activeRequestId = activity.requestId;
        liveAssistantText = "";
      }
      if (activity.type === "delta") {
        liveAssistantText += activity.text;
      }
      if (activity.type === "completed" || activity.type === "error") {
        activeRequestId = null;
      }
    });

    void initialize();

    return () => {
      unsubscribe();
    };
  });

  async function initialize() {
    booting = true;
    try {
      const boot = await bootstrapWebUi();
      state = boot.state;
      providerDraft = boot.providerDraft;
      state = {
        ...state,
        status: "Codex browser terminal ready.",
        isError: false,
      };
    } catch (error) {
      state = {
        ...state,
        status: formatBootError(error),
        isError: true,
      };
    } finally {
      booting = false;
    }
  }

  async function handleSendTurn() {
    if (state.runtime === null || running) {
      return;
    }

    const message = prompt.trim();
    if (message.length === 0) {
      return;
    }

    running = true;
    pendingUserText = message;
    liveAssistantText = "";
    prompt = "";
    state = {
      ...state,
      status: "Running turn…",
      isError: false,
    };

    try {
      const outcome = await runTurnFromDraft(state.runtime, state, providerDraft, message, turnCounter);
      state = outcome.state;
      providerDraft = outcome.providerDraft;
      turnCounter = outcome.result.nextTurnCounter;
    } catch (error) {
      state = {
        ...state,
        status: `Turn failed: ${formatError(error)}`,
        isError: true,
      };
    } finally {
      running = false;
      pendingUserText = null;
      liveAssistantText = "";
    }
  }

  async function handleStopTurn() {
    if (state.runtime === null || activeRequestId === null) {
      return;
    }
    try {
      await state.runtime.cancelModelTurn(activeRequestId);
      state = {
        ...state,
        status: "Cancellation requested.",
        isError: false,
      };
    } catch (error) {
      state = {
        ...state,
        status: `Failed to cancel turn: ${formatError(error)}`,
        isError: true,
      };
    }
  }

  async function handleSaveConfig() {
    try {
      const saved = await saveDraftProviderConfig(state.runtime, state, providerDraft);
      state = saved.state;
      providerDraft = saved.providerDraft;
    } catch (error) {
      state = {
        ...state,
        status: `Failed to save provider config: ${formatError(error)}`,
        isError: true,
      };
    }
  }

  async function handleRefreshModels() {
    try {
      const refreshed = await refreshAccountAndModelsFromDraft(state.runtime, state, providerDraft);
      state = refreshed.state;
      providerDraft = refreshed.providerDraft;
    } catch (error) {
      state = {
        ...state,
        status: `Failed to refresh account and models: ${formatError(error)}`,
        isError: true,
      };
    }
  }

  async function handleClearAuth() {
    try {
      const cleared = await clearSavedAuth(state.runtime, state);
      state = cleared.state;
      providerDraft = cleared.providerDraft;
    } catch (error) {
      state = {
        ...state,
        status: `Failed to clear auth: ${formatError(error)}`,
        isError: true,
      };
    }
  }

  async function handleResetThread() {
    if (state.runtime === null) {
      return;
    }
    try {
      state = await resetCurrentThread(state.runtime, state);
      runtimeActivities = [];
      liveAssistantText = "";
      pendingUserText = null;
      activeRequestId = null;
    } catch (error) {
      state = {
        ...state,
        status: `Failed to reset thread: ${formatError(error)}`,
        isError: true,
      };
    }
  }

  function answerApproval(questionId: string, value: string) {
    approvalAnswers = {
      ...approvalAnswers,
      [questionId]: value,
    };
  }

  function submitApproval() {
    if (currentApproval === null) {
      return;
    }

    const answers = currentApproval.questions.map((question) => ({
      id: question.id,
      value: approvalAnswers[question.id] ?? "",
    }));
    collaborationStore.submitCurrentAnswer(answers);
  }

  function formatBootError(error: unknown): string {
    return [
      "WASM runtime failed to boot.",
      "",
      "Build the demo package first, then reload this page.",
      "",
      `Error: ${formatError(error)}`,
    ].join("\n");
  }

  function formatActivityLine(activity: RuntimeActivity): string {
    if (activity.type === "turnStart") {
      return `run ${activity.model}`;
    }
    if (activity.type === "toolCall") {
      return `tool ${activity.toolName ?? "unknown"} ${summarizeJson(activity.arguments)}`;
    }
    if (activity.type === "toolOutput") {
      return `tool-output ${summarizeJson(activity.output)}`;
    }
    if (activity.type === "planUpdate") {
      return `plan ${activity.plan.map((step) => `[${step.status}] ${step.step}`).join(" | ")}`;
    }
    if (activity.type === "missionState") {
      return `mission ${activity.phase}/${activity.lane} ${activity.summary}`;
    }
    if (activity.type === "pageEvent") {
      return `page ${activity.kind} ${activity.summary}`;
    }
    if (activity.type === "assistantMessage") {
      return "assistant message committed";
    }
    if (activity.type === "completed") {
      return `completed ${activity.finishReason ?? "ok"}`;
    }
    if (activity.type === "error") {
      return `error ${activity.message}`;
    }
    return "delta";
  }

  function summarizeJson(value: unknown): string {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 88 ? `${serialized.slice(0, 85)}...` : serialized;
    } catch {
      return String(value);
    }
  }
</script>

<svelte:head>
  <title>Codex Browser Terminal Demo</title>
</svelte:head>

<div class="terminal-app">
  {#if setupRequired}
    <div class="terminal-frame">
      <div class="setup-screen">
        <div class="terminal-meta">
          <span>router: required</span>
          <span>status: {state.status}</span>
          <span>models: {state.models.length === 0 ? "load after auth" : state.models.length}</span>
        </div>

        <div class="setup-panel">
          <p class="setup-kicker">Router Bootstrap</p>
          <h2>Connect XRouter before entering the terminal.</h2>
          <p class="setup-copy">
            This mirrors the TUI startup shape: first configure the router key, then open the main
            terminal and load models from the runtime.
          </p>

          <div class="panel-grid">
            <label>
              <span>xrouter provider</span>
              <select
                bind:value={providerDraft.xrouterProvider}
                disabled={running}
                on:change={() => {
                  const selected = XROUTER_PROVIDER_OPTIONS.find(
                    (option) => option.value === providerDraft.xrouterProvider,
                  );
                  if (selected !== undefined) {
                    providerDraft = {
                      ...providerDraft,
                      providerDisplayName: selected.displayName,
                      providerBaseUrl: selected.baseUrl,
                    };
                  }
                }}
              >
                {#each XROUTER_PROVIDER_OPTIONS as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>

            <label>
              <span>display name</span>
              <input bind:value={providerDraft.providerDisplayName} disabled={running} />
            </label>

            <label>
              <span>base url</span>
              <input bind:value={providerDraft.providerBaseUrl} disabled={running} />
            </label>

            <label class="wide">
              <span>router api key</span>
              <input bind:value={providerDraft.apiKey} disabled={running} type="password" />
            </label>
          </div>

          <div class="panel-actions">
            <button type="button" on:click={handleSaveConfig} disabled={running || providerDraft.apiKey.trim().length === 0}>
              continue
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="workspace-shell">
      <button
        type="button"
        class="floating-settings-button"
        on:click={() => {
          settingsOpen = !settingsOpen;
        }}
      >
        settings
      </button>

      <aside class="terminal-sidebar">
        <div class="sidebar-panel-header">
          <div>
            <p class="app-kicker">Browser Runtime</p>
            <h2>Codex Browser Terminal</h2>
          </div>
          <button
            type="button"
            class="header-button"
            on:click={() => {
              settingsOpen = !settingsOpen;
            }}
          >
            settings
          </button>
        </div>

        <div class="sidebar-header">runtime</div>
        {#each statusLines as line}
          <div class="terminal-line status">
            <span class="prompt-mark">%</span>
            <pre>{line}</pre>
          </div>
        {/each}

        <div class="sidebar-header">activity</div>
        {#if activityLines.length === 0}
          <div class="terminal-line activity">
            <span class="prompt-mark">#</span>
            <pre>idle</pre>
          </div>
        {:else}
          {#each activityLines as line}
            <div class="terminal-line activity">
              <span class="prompt-mark">#</span>
              <pre>{line}</pre>
            </div>
          {/each}
        {/if}

        <div class="sidebar-header">session</div>
        <div class="terminal-line status">
          <span class="prompt-mark">%</span>
          <pre>status       {state.status}</pre>
        </div>
        <div class="terminal-line status">
          <span class="prompt-mark">%</span>
          <pre>account      {state.account?.authMode ?? "api-key"}</pre>
        </div>
        <div class="terminal-line status">
          <span class="prompt-mark">%</span>
          <pre>tools        {CONNECTED_TOOL_NAMES.length}</pre>
        </div>
      </aside>

      <section class="terminal-surface">
        <div class="terminal-viewport">
          <div class="terminal-block">
            <XtermTerminal
              transcript={visibleTranscript}
              liveAssistantText={liveAssistantText}
              {running}
              disabled={promptDisabled}
              model={selectedModelLabel}
              cwd="~/workspace"
              on:draftchange={(event) => {
                prompt = event.detail.value;
              }}
              on:submit={(event) => {
                prompt = event.detail.value;
                void handleSendTurn();
              }}
              on:cancel={() => {
                void handleStopTurn();
              }}
            />
          </div>
        </div>
      </section>
    </div>
  {/if}

  {#if settingsOpen}
    <aside class="settings-drawer">
      <div class="settings-drawer-header">
        <div>
          <p class="app-kicker">Runtime Config</p>
          <h2>Router and model settings</h2>
        </div>
        <button
          type="button"
          class="header-button"
          on:click={() => {
            settingsOpen = false;
          }}
        >
          close
        </button>
      </div>

      <div class="terminal-panel settings-panel">
      <div class="panel-grid">
        <label>
          <span>xrouter provider</span>
          <select
            bind:value={providerDraft.xrouterProvider}
            disabled={running}
            on:change={() => {
              const selected = XROUTER_PROVIDER_OPTIONS.find(
                (option) => option.value === providerDraft.xrouterProvider,
              );
              if (selected !== undefined) {
                providerDraft = {
                  ...providerDraft,
                  providerDisplayName: selected.displayName,
                  providerBaseUrl: selected.baseUrl,
                };
              }
            }}
          >
            {#each XROUTER_PROVIDER_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>display name</span>
          <input bind:value={providerDraft.providerDisplayName} disabled={running} />
        </label>

        <label>
          <span>base url</span>
          <input bind:value={providerDraft.providerBaseUrl} disabled={running} />
        </label>

        <label>
          <span>model</span>
          <select bind:value={providerDraft.model} disabled={running}>
            {#if state.models.length === 0}
              <option value="">No models loaded</option>
            {:else}
              {#each state.models as model}
                <option value={model.id}>{model.displayName}</option>
              {/each}
            {/if}
          </select>
        </label>

        <label>
          <span>reasoning</span>
          <select bind:value={providerDraft.modelReasoningEffort} disabled={running}>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>

        <label>
          <span>personality</span>
          <input bind:value={providerDraft.personality} disabled={running} />
        </label>

        <label class="wide">
          <span>api key</span>
          <input bind:value={providerDraft.apiKey} disabled={running} type="password" />
        </label>
      </div>

      <div class="panel-actions">
        <button class="ghost" type="button" on:click={handleClearAuth} disabled={running}>
          clear auth
        </button>
        <button type="button" on:click={handleSaveConfig} disabled={running}>
          save config
        </button>
      </div>
      </div>

      {#if currentApproval !== null}
        <details class="terminal-panel approval-panel" open>
          <summary>approval required</summary>
        {#each currentApproval.questions as question}
          <div class="approval-question">
            <p>{question.question}</p>
            <div class="approval-options">
              {#each question.options as option}
                <button
                  type="button"
                  class="ghost"
                  class:selected={approvalAnswers[question.id] === option.label}
                  on:click={() => answerApproval(question.id, option.label)}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          </div>
        {/each}
        <div class="panel-actions">
          <button class="ghost" type="button" on:click={() => collaborationStore.cancelCurrentRequest()}>
            dismiss
          </button>
          <button
            type="button"
            on:click={submitApproval}
            disabled={currentApproval.questions.some((question) => (approvalAnswers[question.id] ?? "").length === 0)}
          >
            submit answers
          </button>
        </div>
        </details>
      {/if}
    </aside>
  {/if}
</div>
