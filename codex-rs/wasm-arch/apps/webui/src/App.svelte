<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./lib/AppShell.svelte";
  import ApprovalDrawer from "./lib/ApprovalDrawer.svelte";
  import MessageComposer from "./lib/MessageComposer.svelte";
  import ProviderSettingsModal from "./lib/ProviderSettingsModal.svelte";
  import RuntimeEventsDrawer from "./lib/RuntimeEventsDrawer.svelte";
  import Sidebar from "./lib/Sidebar.svelte";
  import ThreadHeader from "./lib/ThreadHeader.svelte";
  import Transcript from "./lib/Transcript.svelte";
  import {
    bootstrapWebUi,
    clearSavedAuth,
    createInitialState,
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
  import type { PendingApproval, ThreadSummary } from "./types";

  let state: DemoState = createInitialState();
  let providerDraft: ProviderDraft = {
    transportMode: "xrouter-browser",
    providerDisplayName: "DeepSeek via XRouter Browser",
    providerBaseUrl: "https://api.deepseek.com",
    apiKey: "",
    xrouterProvider: "deepseek",
    modelReasoningEffort: "medium",
    personality: "pragmatic",
    model: "",
  };
  let message = "";
  let turnCounter = 1;
  let runtimeActivities: RuntimeActivity[] = [];
  let liveStreamText = "";
  let activeRequestId: string | null = null;
  let showSettings = false;
  let showEvents = false;
  let showApprovals = false;
  let sidebarOpen = true;
  let running = false;
  let stopRequested = false;

  $: providerSummary = transportLabel(providerDraft);
  $: threads = buildThreadList(state);
  $: approvals = deriveApprovals(runtimeActivities);
  $: drawerOpen = showEvents || showApprovals;
  $: composerDisabled = state.runtime === null || message.trim().length === 0;

  onMount(() => {
    const unsubscribe = subscribeRuntimeActivity((activity) => {
      console.info("[webui] runtime-activity", activity);
      runtimeActivities = [...runtimeActivities, activity].slice(-60);
      if (activity.type === "turnStart") {
        activeRequestId = activity.requestId.split(":")[0] ?? activity.requestId;
        running = true;
        if (!activity.requestId.includes(":")) {
          liveStreamText = "";
        }
      } else if (activity.type === "delta") {
        liveStreamText += activity.text;
      }
    });

    void initialize();

    return () => {
      unsubscribe();
    };
  });

  async function initialize() {
    try {
      console.info("[webui] initialize:start");
      const boot = await bootstrapWebUi();
      state = boot.state;
      providerDraft = boot.providerDraft;
      console.info("[webui] initialize:done", {
        modelProvider: state.codexConfig.modelProvider,
        model: state.codexConfig.model,
        modelCount: state.models.length,
      });
    } catch (error) {
      console.error("[webui] initialize:failed", error);
      state = {
        ...state,
        status: `Failed to initialize runtime: ${formatError(error)}`,
        isError: true,
      };
    }
  }

  async function handleSaveConfig() {
    const runtime = requireRuntime();
    try {
      console.info("[webui] ui:save-config", providerDraft);
      const saved = await saveDraftProviderConfig(runtime, state, providerDraft);
      state = saved.state;
      providerDraft = saved.providerDraft;
      showSettings = false;
    } catch (error) {
      console.error("[webui] ui:save-config:failed", error);
      fail(`Failed to save provider config: ${formatError(error)}`);
    }
  }

  async function handleRefreshAccountAndModels() {
    const runtime = requireRuntime();
    try {
      console.info("[webui] ui:refresh-account-and-models", providerDraft);
      const refreshed = await refreshAccountAndModelsFromDraft(runtime, state, providerDraft);
      state = refreshed.state;
      providerDraft = refreshed.providerDraft;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLSelectElement) {
        activeElement.blur();
      }
    } catch (error) {
      console.error("[webui] ui:refresh-account-and-models:failed", error);
      fail(`Failed to refresh account and models: ${formatError(error)}`);
    }
  }

  async function handleClearAuth() {
    const runtime = requireRuntime();
    try {
      console.info("[webui] ui:clear-auth");
      const cleared = await clearSavedAuth(runtime, state);
      state = cleared.state;
      providerDraft = cleared.providerDraft;
    } catch (error) {
      console.error("[webui] ui:clear-auth:failed", error);
      fail(`Failed to clear auth: ${formatError(error)}`);
    }
  }

  async function handleSend() {
    const runtime = requireRuntime();
    if (message.trim().length === 0 || running) {
      return;
    }

    try {
      running = true;
      stopRequested = false;
      liveStreamText = "";
      console.info("[webui] ui:send", {
        message: message.trim(),
        providerDraft,
        turnCounter,
      });
      state = {
        ...state,
        status: "Sending turn...",
        isError: false,
      };
      const outcome = await runTurnFromDraft(runtime, state, providerDraft, message.trim(), turnCounter);
      state = outcome.state;
      providerDraft = outcome.providerDraft;
      turnCounter = outcome.result.nextTurnCounter;
      message = "";
      liveStreamText = "";
      running = false;
      activeRequestId = null;
      console.info("[webui] ui:send:done", {
        nextTurnCounter: turnCounter,
        transcriptEntries: state.transcript.length,
        output: outcome.result.output,
      });
    } catch (error) {
      running = false;
      activeRequestId = null;
      if (stopRequested || isCancellationError(error)) {
        stopRequested = false;
        state = {
          ...state,
          status: "Turn cancelled.",
          isError: false,
        };
        return;
      }
      console.error("[webui] ui:send:failed", error);
      fail(`Turn failed: ${formatError(error)}`);
    }
  }

  async function handleStop() {
    const runtime = requireRuntime();
    if (activeRequestId === null) {
      console.info("[webui] ui:stop:skipped-no-active-request");
      return;
    }
    try {
      console.info("[webui] ui:stop", { activeRequestId });
      stopRequested = true;
      await runtime.cancelModelTurn(activeRequestId);
      running = false;
      activeRequestId = null;
      state = {
        ...state,
        status: "Turn cancelled.",
        isError: false,
      };
    } catch (error) {
      console.error("[webui] ui:stop:failed", error);
      fail(`Failed to stop turn: ${formatError(error)}`);
    }
  }

  async function handleResetThread() {
    const runtime = requireRuntime();
    try {
      console.info("[webui] ui:reset-thread");
      state = await resetCurrentThread(runtime, state);
      runtimeActivities = [];
      liveStreamText = "";
      turnCounter = 1;
    } catch (error) {
      console.error("[webui] ui:reset-thread:failed", error);
      fail(`Failed to reset thread: ${formatError(error)}`);
    }
  }

  function requireRuntime() {
    if (state.runtime === null) {
      console.error("[webui] runtime:not-loaded", {
        status: state.status,
        isError: state.isError,
      });
      throw new Error("Runtime has not loaded yet.");
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

  function isCancellationError(error: unknown): boolean {
    if (error !== null && typeof error === "object") {
      const maybeRecord = error as { code?: unknown; message?: unknown };
      if (maybeRecord.code === "cancelled") {
        return true;
      }
      if (typeof maybeRecord.message === "string") {
        const messageText = maybeRecord.message.toLowerCase();
        return messageText.includes("cancelled") || messageText.includes("canceled");
      }
    }
    return false;
  }

  function buildThreadList(currentState: DemoState): ThreadSummary[] {
    const firstUserMessage = currentState.transcript.find((entry) => entry.role === "user")?.text;
    return [
      {
        id: "current-thread",
        title: firstUserMessage?.slice(0, 36) || "Current thread",
        subtitle:
          currentState.transcript.length === 0
            ? "No messages yet"
            : `${currentState.transcript.length} transcript entries`,
        active: true,
      },
    ];
  }

  function deriveApprovals(activities: RuntimeActivity[]): PendingApproval[] {
    return activities
      .filter((activity) => activity.type === "toolCall")
      .map((activity, index) => ({
        id: `${activity.requestId}-${index}`,
        title: activity.toolName ?? "toolCall",
        detail:
          activity.toolName === "apply_patch"
            ? "Observed apply_patch tool call. Real approve/reject wiring is the next step."
            : "Observed tool call. Approval gating has not been connected yet.",
        status: "observed",
      }));
  }

  function toggleEvents() {
    const nextOpen = !showEvents;
    showEvents = nextOpen;
    if (nextOpen) {
      showApprovals = false;
    }
  }

  function toggleApprovals() {
    const nextOpen = !showApprovals;
    showApprovals = nextOpen;
    if (nextOpen) {
      showEvents = false;
    }
  }

  function handleSelectModel(event: CustomEvent<{ model: string }>) {
    providerDraft = {
      ...providerDraft,
      model: event.detail.model,
    };
  }

  function handleSelectReasoning(event: CustomEvent<{ value: string }>) {
    providerDraft = {
      ...providerDraft,
      modelReasoningEffort: event.detail.value,
    };
  }
</script>

<AppShell {drawerOpen} {sidebarOpen}>
  <Sidebar
    slot="sidebar"
    {threads}
    currentModel={providerDraft.model}
    providerSummary={providerSummary}
    status={state.status}
    {running}
    on:newthread={async () => {
      await handleResetThread();
    }}
    on:settings={() => {
      showSettings = true;
    }}
    on:events={toggleEvents}
    on:approvals={toggleApprovals}
    on:selectthread={() => {}}
  />

  <div slot="main" class="main-column">
    <ThreadHeader
      {sidebarOpen}
      on:togglesidebar={() => (sidebarOpen = !sidebarOpen)}
      on:newthread={handleResetThread}
      on:settings={() => (showSettings = true)}
      on:events={toggleEvents}
    />

    <main class="chat-stage">
      <Transcript
        transcript={state.transcript}
        liveStreamText={liveStreamText}
        status={state.status}
        {running}
      />
    </main>

    <div class="composer-stage">
      <MessageComposer
        bind:message
        currentModel={providerDraft.model}
        currentReasoning={providerDraft.modelReasoningEffort}
        disabled={composerDisabled}
        models={state.models}
        {running}
        on:send={handleSend}
        on:stop={handleStop}
        on:settings={() => (showSettings = true)}
        on:selectmodel={handleSelectModel}
        on:selectreasoning={handleSelectReasoning}
      />
    </div>
  </div>

  <div slot="drawer">
    <RuntimeEventsDrawer open={showEvents} activities={runtimeActivities} on:close={() => (showEvents = false)} />
    <ApprovalDrawer open={showApprovals} approvals={approvals} on:close={() => (showApprovals = false)} />
  </div>
</AppShell>

<ProviderSettingsModal
  bind:draft={providerDraft}
  disabled={state.runtime === null}
  open={showSettings}
  on:close={() => (showSettings = false)}
  on:save={handleSaveConfig}
  on:refreshaccount={handleRefreshAccountAndModels}
  on:refreshmodels={handleRefreshAccountAndModels}
  on:clearauth={handleClearAuth}
/>
