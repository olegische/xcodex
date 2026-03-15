<script lang="ts">
  import { onMount } from "svelte";

  import { collaborationStore } from "./stores/collaboration";
  import { XROUTER_PROVIDER_OPTIONS } from "./runtime/constants";
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
    type DemoState,
    type ProviderDraft,
    type RuntimeActivity,
    type TranscriptEntry,
  } from "./runtime";

  type InspectorTab = "router" | "artifacts" | "events";

  const activityLimit = 120;

  let activeTab: InspectorTab | null = null;
  let state: DemoState = createInitialState();
  let providerDraft: ProviderDraft = draftFromConfig(state.codexConfig);
  let booting = true;
  let running = false;
  let turnCounter = 1;
  let prompt = "";
  let liveAssistantText = "";
  let pendingUserText: string | null = null;
  let activeRequestId: string | null = null;
  let runtimeActivities: RuntimeActivity[] = [];
  let approvalAnswers: Record<string, string> = {};

  $: collaborationState = $collaborationStore;
  $: currentApproval = collaborationState.currentRequest;
  $: promptDisabled = state.runtime === null || running;
  $: selectedModelLabel =
    providerDraft.model.trim() ||
    state.codexConfig.model ||
    state.models.find((model) => model.isDefault)?.id ||
    state.models[0]?.id ||
    "no-model";
  $: visibleTranscript =
    pendingUserText === null
      ? state.transcript
      : [...state.transcript, { role: "user" as const, text: pendingUserText }];
  $: eventLines = runtimeActivities.slice(-24).map(formatActivityLine);
  $: artifactEntries = state.transcript.filter((entry) => entry.role === "tool");
  $: toolActivities = runtimeActivities.filter(
    (activity) => activity.type === "toolCall" || activity.type === "toolOutput",
  );
  $: approvalAnswers =
    currentApproval === null
      ? {}
      : currentApproval.questions.reduce<Record<string, string>>((next, question) => {
          next[question.id] = approvalAnswers[question.id] ?? "";
          return next;
        }, {});
  $: runtimeTone = state.isError ? "warning" : running ? "running" : "success";
  $: runtimeLabel = state.runtime === null ? "Offline" : running ? "Running" : "Ready";
  $: routerLabel =
    providerDraft.transportMode === "xrouter-browser"
      ? "XRouter Browser"
      : providerDraft.transportMode === "openai"
        ? "OpenAI"
        : "OpenAI-compatible";

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
        status: "Codex browser demo ready.",
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
      const outcome = await runTurnFromDraft(
        state.runtime,
        state,
        providerDraft,
        message,
        turnCounter,
      );
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
      const refreshed = await refreshAccountAndModelsFromDraft(
        state.runtime,
        state,
        providerDraft,
      );
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
    if (activity.type === "assistantMessage") {
      return "assistant message committed";
    }
    if (activity.type === "completed") {
      return `completed ${activity.finishReason ?? "ok"}`;
    }
    if (activity.type === "error") {
      return `error ${activity.message}`;
    }
    if (activity.type === "pageEvent") {
      return `page ${activity.kind} ${activity.summary}`;
    }
    if (activity.type === "missionState") {
      return `mission ${activity.phase}/${activity.lane}`;
    }
    return "delta";
  }

  function summarizeJson(value: unknown): string {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
    } catch {
      return String(value);
    }
  }

  function paragraphs(text: string): string[] {
    return text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  function roleLabel(entry: TranscriptEntry): string {
    if (entry.role === "user") {
      return "You";
    }
    if (entry.role === "tool") {
      return "Tool";
    }
    return "Codex";
  }

  function updateXrouterProvider(value: string) {
    const selected = XROUTER_PROVIDER_OPTIONS.find((option) => option.value === value);
    if (selected === undefined) {
      return;
    }
    providerDraft = {
      ...providerDraft,
      xrouterProvider: selected.value,
      providerDisplayName: selected.displayName,
      providerBaseUrl: selected.baseUrl,
    };
  }

  function toggleInspector(tab: InspectorTab) {
    activeTab = activeTab === tab ? null : tab;
  }
</script>

<svelte:head>
  <title>Codex Browser Demo</title>
</svelte:head>

{#if booting}
  <main class="boot-console">
    <div class="boot-console-panel">
      <p class="eyebrow">Codex Browser Demo</p>
      <h1>Booting runtime</h1>
      <p>
        Loading browser runtime, app-server protocol bridge, router settings, and workspace tools.
      </p>
    </div>
  </main>
{:else}
  <main class="app-shell sidebar-open">
    <aside class="shell-sidebar">
      <div class="sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-title">Codex Browser Demo</div>
          <div class="sidebar-caption">apsix shell, codex runtime</div>
        </div>

        <button
          type="button"
          class="sidebar-new-chat"
          on:click={handleResetThread}
          disabled={state.runtime === null || running}
        >
          New Thread
        </button>

        <div class="sidebar-group">
          <div class="sidebar-group-title">Threads</div>
          <div class="thread-card active">
            <span class="thread-title">Browser thread</span>
          </div>
        </div>

        <div class="sidebar-footer runtime-plaque">
          <div class="sidebar-group-title">Runtime</div>
          <div class="runtime-status-list">
            <div class="runtime-status-row">
              <span class="runtime-status-label">Codex</span>
              <div class={`runtime-badge ${runtimeTone}`}>
                <span class="runtime-badge-dot"></span>
                <span>{runtimeLabel}</span>
              </div>
            </div>
            <div class="runtime-status-row">
              <span class="runtime-status-label">Router</span>
              <div class="runtime-badge success">
                <span class="runtime-badge-dot"></span>
                <span>{routerLabel}</span>
              </div>
            </div>
            <div class="runtime-status-row">
              <span class="runtime-status-label">Model</span>
              <div class="runtime-badge">
                <span class="runtime-badge-dot"></span>
                <span>{selectedModelLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <section class="shell-main">
      <header class="thread-header">
        <div class="nav-left">
          <p class="eyebrow">Chat + Tools + Runtime</p>
          <h2>Browser Codex</h2>
        </div>
        <div class="nav-right">
          <button type="button" class:active={activeTab === "router"} class="nav-icon-button" on:click={() => toggleInspector("router")}>
            Router
          </button>
          <button type="button" class:active={activeTab === "artifacts"} class="nav-icon-button" on:click={() => toggleInspector("artifacts")}>
            Artifacts
          </button>
          <button type="button" class:active={activeTab === "events"} class="nav-icon-button" on:click={() => toggleInspector("events")}>
            Events
          </button>
          <button type="button" class="nav-icon-button" on:click={handleStopTurn} disabled={!running}>
            Stop
          </button>
          <button
            type="button"
            class="nav-icon-button"
            on:click={handleResetThread}
            disabled={state.runtime === null || running}
          >
            Reset
          </button>
        </div>
      </header>

      <div class="main-workspace">
        <section class="chat-screen full-width">
          <div class="status-strip" class:warning={state.isError}>
            <span>runtime: {runtimeLabel}</span>
            <span>router: {providerDraft.transportMode}</span>
            <span>model: {selectedModelLabel}</span>
          </div>

          <div class="chat-foundation">
            <div class="chat-foundation-transcript-shell">
              <section class="transcript-widget">
                {#if visibleTranscript.length === 0 && liveAssistantText.length === 0}
                  <div class="transcript-empty">
                    <p class="eyebrow">Chat</p>
                    <h3>Strictly the essentials</h3>
                    <p>
                      Streamed chat, tool activity, app-server protocol, router settings, artifacts,
                      and runtime events.
                    </p>
                  </div>
                {/if}

                {#each visibleTranscript as entry}
                  <article
                    class="transcript-entry"
                    class:user={entry.role === "user"}
                    class:tool={entry.role === "tool"}
                  >
                    <div class="transcript-entry-role">{roleLabel(entry)}</div>
                    <div class="transcript-entry-copy">
                      {#each paragraphs(entry.text) as paragraph}
                        <p>{paragraph}</p>
                      {/each}
                    </div>
                  </article>
                {/each}

                {#if liveAssistantText.length > 0}
                  <article class="transcript-entry streaming">
                    <div class="transcript-entry-role">Codex</div>
                    <div class="transcript-entry-copy">
                      {#each paragraphs(liveAssistantText) as paragraph}
                        <p>{paragraph}</p>
                      {/each}
                    </div>
                  </article>
                {/if}
              </section>
            </div>

            <div class="chat-foundation-composer-shell">
              {#if currentApproval !== null}
                <section class="approval-drawer">
                  <div>
                    <p class="eyebrow">Approval</p>
                    <h3>Runtime requests input</h3>
                  </div>
                  {#each currentApproval.questions as question}
                    <label class="approval-question">
                      <span>{question.question}</span>
                      <select
                        value={approvalAnswers[question.id] ?? ""}
                        on:change={(event) => answerApproval(question.id, event.currentTarget.value)}
                      >
                        <option value="">Select…</option>
                        {#each question.options as option}
                          <option value={option.label}>{option.label}</option>
                        {/each}
                      </select>
                    </label>
                  {/each}
                  <button type="button" class="primary-action" on:click={submitApproval}>Submit</button>
                </section>
              {/if}

              <section class="composer-shell">
                <div class="composer">
                  <textarea
                    bind:value={prompt}
                    class="composer-input"
                    rows="1"
                    disabled={promptDisabled}
                    placeholder="What should Codex do in this browser runtime?"
                    on:keydown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSendTurn();
                      }
                    }}
                  ></textarea>

                  <div class="composer-actions">
                    <div class="composer-left-tools">
                      <button type="button" class="composer-menu-trigger" on:click={() => (activeTab = "router")}>
                        Router
                      </button>
                      <button type="button" class="composer-menu-trigger" disabled>
                        {selectedModelLabel}
                      </button>
                      <button type="button" class="composer-menu-trigger" disabled>
                        {providerDraft.modelReasoningEffort}
                      </button>
                    </div>

                    <div class="composer-buttons">
                      {#if running}
                        <button type="button" class="button secondary" on:click={handleStopTurn}>Stop</button>
                      {:else}
                        <button type="button" class="button primary" on:click={handleSendTurn} disabled={promptDisabled}>
                          Send
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>

      {#if activeTab !== null}
        <button type="button" class="drawer-backdrop" aria-label="Close panel" on:click={() => (activeTab = null)}></button>
        <aside class="drawer-panel">
          {#if activeTab === "router"}
            <section class="runtime-surface-card">
              <div class="surface-header">
                <div>
                  <p class="eyebrow">Router</p>
                  <h3>Transport settings</h3>
                </div>
                <button type="button" class="nav-icon-button" on:click={() => (activeTab = null)}>Close</button>
              </div>

              <div class="field-grid">
                <label>
                  <span>Transport</span>
                  <select bind:value={providerDraft.transportMode} disabled={running}>
                    <option value="xrouter-browser">XRouter Browser</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </label>

                {#if providerDraft.transportMode === "xrouter-browser"}
                  <label>
                    <span>Upstream Provider</span>
                    <select
                      bind:value={providerDraft.xrouterProvider}
                      disabled={running}
                      on:change={(event) => updateXrouterProvider(event.currentTarget.value)}
                    >
                      {#each XROUTER_PROVIDER_OPTIONS as option}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </select>
                  </label>
                {/if}

                <label>
                  <span>Provider Name</span>
                  <input bind:value={providerDraft.providerDisplayName} disabled={running} />
                </label>

                <label>
                  <span>Base URL</span>
                  <input bind:value={providerDraft.providerBaseUrl} disabled={running} />
                </label>

                <label class="wide">
                  <span>API Key</span>
                  <input bind:value={providerDraft.apiKey} type="password" disabled={running} />
                </label>

                <label>
                  <span>Model</span>
                  <select bind:value={providerDraft.model} disabled={running}>
                    <option value="">Select a model</option>
                    {#each state.models as model}
                      <option value={model.id}>{model.id}</option>
                    {/each}
                  </select>
                </label>

                <label>
                  <span>Reasoning</span>
                  <select bind:value={providerDraft.modelReasoningEffort} disabled={running}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>

                <label class="wide">
                  <span>Personality</span>
                  <input bind:value={providerDraft.personality} disabled={running} />
                </label>
              </div>

              <div class="surface-actions">
                <button type="button" class="button secondary" on:click={handleRefreshModels} disabled={running}>
                  Refresh Models
                </button>
                <button type="button" class="button secondary" on:click={handleClearAuth} disabled={running}>
                  Clear Auth
                </button>
                <button
                  type="button"
                  class="button primary"
                  on:click={handleSaveConfig}
                  disabled={running || providerDraft.apiKey.trim().length === 0}
                >
                  Save Router Config
                </button>
              </div>
            </section>
          {:else if activeTab === "artifacts"}
            <section class="runtime-surface-card">
              <div class="surface-header">
                <div>
                  <p class="eyebrow">Artifacts</p>
                  <h3>Tool output and results</h3>
                </div>
                <button type="button" class="nav-icon-button" on:click={() => (activeTab = null)}>Close</button>
              </div>

              <div class="artifact-stack">
                <article class="artifact-card">
                  <div class="artifact-label">Latest assistant output</div>
                  <pre>{state.output.trim().length === 0 ? "No committed assistant output yet." : state.output}</pre>
                </article>

                {#if artifactEntries.length === 0 && toolActivities.length === 0}
                  <article class="artifact-card">
                    <div class="artifact-label">No artifacts yet</div>
                    <pre>Tool invocations and outputs will appear here after the first run.</pre>
                  </article>
                {/if}

                {#each artifactEntries as entry}
                  <article class="artifact-card">
                    <div class="artifact-label">Transcript Tool Entry</div>
                    <pre>{entry.text}</pre>
                  </article>
                {/each}

                {#each toolActivities as activity}
                  <article class="artifact-card">
                    <div class="artifact-label">
                      {activity.type === "toolCall" ? `Tool Call ${activity.toolName ?? "unknown"}` : "Tool Output"}
                    </div>
                    <pre>
{activity.type === "toolCall" ? summarizeJson(activity.arguments) : summarizeJson(activity.output)}</pre>
                  </article>
                {/each}
              </div>
            </section>
          {:else}
            <section class="runtime-surface-card">
              <div class="surface-header">
                <div>
                  <p class="eyebrow">Events</p>
                  <h3>Runtime activity</h3>
                </div>
                <button type="button" class="nav-icon-button" on:click={() => (activeTab = null)}>Close</button>
              </div>

              <div class="event-log">
                {#if eventLines.length === 0}
                  <pre>Runtime idle.</pre>
                {:else}
                  {#each eventLines as line}
                    <pre>{line}</pre>
                  {/each}
                {/if}
              </div>
            </section>
          {/if}
        </aside>
      {/if}
    </section>
  </main>
{/if}
