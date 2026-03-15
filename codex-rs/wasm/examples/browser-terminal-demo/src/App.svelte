<script lang="ts">
  import { onMount, tick } from "svelte";

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
  let terminalViewport: HTMLDivElement | null = null;
  let approvalAnswers: Record<string, string> = {};
  let approvalRequestId: string | null = null;

  state = createInitialState();
  providerDraft = draftFromConfig(state.codexConfig);

  $: collaborationState = $collaborationStore;
  $: currentApproval = collaborationState.currentRequest;
  $: promptDisabled = state.runtime === null || running;
  $: setupRequired = !booting && providerDraft.apiKey.trim().length === 0;
  $: visibleTranscript = pendingUserText === null
    ? state.transcript
    : [...state.transcript, { role: "user" as const, text: pendingUserText }];
  $: activityLines = runtimeActivities.slice(-12).map(formatActivityLine);
  $: void scrollTerminal();
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
    if (state.runtime === null) {
      return;
    }
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
    if (state.runtime === null) {
      return;
    }
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
    if (state.runtime === null) {
      return;
    }
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

  async function scrollTerminal() {
    await tick();
    terminalViewport?.scrollTo({
      top: terminalViewport.scrollHeight,
      behavior: "smooth",
    });
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
  <header class="terminal-header">
    <div>
      <p class="eyebrow">Codex WASM</p>
      <h1>Browser Terminal Demo</h1>
    </div>
    <div class="status-cluster">
      <span class:error={state.isError} class="status-pill">
        {booting ? "booting" : running ? "running" : "ready"}
      </span>
      <span class="status-pill dim">{transportLabel(providerDraft)}</span>
      <span class="status-pill dim">{state.codexConfig.model || "no-model"}</span>
    </div>
  </header>

  <div class="terminal-frame">
    {#if setupRequired}
      <div class="setup-screen">
        <div class="terminal-meta">
          <span>router: required</span>
          <span>status: waiting for api key</span>
          <span>models: load after auth</span>
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
            <button type="button" on:click={handleSaveConfig} disabled={state.runtime === null || running || providerDraft.apiKey.trim().length === 0}>
              continue
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="terminal-meta">
        <span>status: {state.status}</span>
        <span>account: {state.account?.authMode ?? "api-key"}</span>
        <span>tools: {CONNECTED_TOOL_NAMES.join(", ")}</span>
      </div>

      <div bind:this={terminalViewport} class="terminal-viewport">
        <div class="terminal-block">
          <div class="terminal-line system">
            <span class="prompt-mark">::</span>
            <span>Codex browser runtime booted from `ai-aware-web` wrapper.</span>
          </div>

          {#each visibleTranscript as entry}
            <div class={`terminal-line ${entry.role}`}>
              <span class="prompt-mark">{entry.role === "user" ? "$" : entry.role === "assistant" ? ">" : "@"}</span>
              <pre>{entry.text}</pre>
            </div>
          {/each}

          {#if running && liveAssistantText.length > 0}
            <div class="terminal-line assistant live">
              <span class="prompt-mark">&gt;</span>
              <pre>{liveAssistantText}</pre>
            </div>
          {/if}

          {#if activityLines.length > 0}
            <div class="terminal-section-label">runtime activity</div>
            {#each activityLines as line}
              <div class="terminal-line activity">
                <span class="prompt-mark">#</span>
                <pre>{line}</pre>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <div class="terminal-composer">
        <label class="composer-label" for="prompt">prompt</label>
        <textarea
          id="prompt"
          bind:value={prompt}
          class="prompt-input"
          disabled={promptDisabled}
          rows="4"
          placeholder={booting ? "Booting runtime…" : "Ask Codex to inspect, patch, plan, or read workspace files."}
          on:keydown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void handleSendTurn();
            }
          }}
        />
        <div class="composer-actions">
          <button class="ghost" type="button" on:click={handleResetThread} disabled={state.runtime === null || running}>
            reset
          </button>
          <button class="ghost" type="button" on:click={handleRefreshModels} disabled={state.runtime === null || running}>
            refresh
          </button>
          <button class="ghost" type="button" on:click={handleStopTurn} disabled={!running || activeRequestId === null}>
            stop
          </button>
          <button type="button" on:click={handleSendTurn} disabled={promptDisabled || prompt.trim().length === 0}>
            send
          </button>
        </div>
      </div>
    {/if}
  </div>

  <section class="terminal-panels">
    {#if !setupRequired}
    <details class="terminal-panel" open>
      <summary>runtime config</summary>
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
          <input bind:value={providerDraft.model} disabled={running} list="model-options" />
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

      <datalist id="model-options">
        {#each state.models as model}
          <option value={model.id}>{model.displayName}</option>
        {/each}
      </datalist>

      <div class="panel-actions">
        <button class="ghost" type="button" on:click={handleClearAuth} disabled={state.runtime === null || running}>
          clear auth
        </button>
        <button type="button" on:click={handleSaveConfig} disabled={state.runtime === null || running}>
          save config
        </button>
      </div>
    </details>
    {/if}

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
  </section>
</div>
