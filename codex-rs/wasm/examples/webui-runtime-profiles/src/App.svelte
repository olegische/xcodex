<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./lib/AppShell.svelte";
  import ApprovalDrawer from "./lib/ApprovalDrawer.svelte";
  import MessageComposer from "./lib/MessageComposer.svelte";
  import ProviderSettingsModal from "./lib/ProviderSettingsModal.svelte";
  import RuntimeEventsDrawer from "./lib/RuntimeEventsDrawer.svelte";
  import Sidebar from "./lib/Sidebar.svelte";
  import ThreadHeader from "./lib/ThreadHeader.svelte";
  import UiProfilesModal from "./lib/UiProfilesModal.svelte";
  import WidgetHost from "./lib/WidgetHost.svelte";
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
    type ModelPreset,
    type ProviderDraft,
    type RuntimeActivity,
    type TranscriptEntry,
  } from "./runtime";
  import type { PendingApproval, ThreadSummary } from "./types";
  import {
    createUiProfile,
    deleteActiveUiProfile,
    saveUiProfilesDocument,
    setActiveUiProfile,
    updateActiveUiProfile,
    type UiProfile,
  } from "./ui/profiles";
  import { buildMetrics, buildUiRenderPlan } from "./ui/renderer";
  import { applyUiSystem, loadUiSystem, subscribeUiSystem } from "./ui/system";
  import type { InspectorTab, MetricItem, UiSystemDocument } from "./ui/types";
  import { DEFAULT_UI_LAYOUT } from "./ui/layout";
  import { DEFAULT_UI_PROFILES } from "./ui/profiles";
  import { DEFAULT_UI_TOKENS } from "./ui/tokens";
  import { DEFAULT_UI_WIDGETS } from "./ui/widgets";

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
  let showProfiles = false;
  let sidebarOpen = true;
  let running = false;
  let stopRequested = false;
  let uiSystem: UiSystemDocument = {
    tokens: structuredClone(DEFAULT_UI_TOKENS),
    profiles: structuredClone(DEFAULT_UI_PROFILES),
    layout: structuredClone(DEFAULT_UI_LAYOUT),
    widgets: structuredClone(DEFAULT_UI_WIDGETS),
  };
  let activeInspectorTab: InspectorTab = "events";

  $: providerSummary = transportLabel(providerDraft);
  $: threads = buildThreadList(state);
  $: approvals = deriveApprovals(runtimeActivities);
  $: composerDisabled = state.runtime === null || message.trim().length === 0;
  $: syncDraftModel(state.models, providerDraft);
  $: renderPlan = buildUiRenderPlan(uiSystem);
  $: applyUiSystem(uiSystem);
  $: inlineInspectorVisible = renderPlan.inspectorMode === "column";
  $: drawerOpen = renderPlan.inspectorMode === "drawer" && (showEvents || showApprovals);
  $: metrics = buildMetrics(uiSystem.widgets.metrics.items, {
    profile: renderPlan.profile.name,
    theme: renderPlan.profile.theme,
    sidebar: renderPlan.profile.sidebarSide,
    transcript: `${state.transcript.length}`,
    events: `${runtimeActivities.length}`,
    approvals: `${approvals.length}`,
    model: providerDraft.model || "none",
  });

  onMount(() => {
    const unsubscribeRuntimeActivity = subscribeRuntimeActivity((activity) => {
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
    const unsubscribeUiSystem = subscribeUiSystem((nextSystem) => {
      uiSystem = nextSystem;
      activeInspectorTab = nextSystem.layout.defaultInspectorTab;
    });

    void initialize();

    return () => {
      unsubscribeRuntimeActivity();
      unsubscribeUiSystem();
    };
  });

  async function initialize() {
    try {
      console.info("[webui] initialize:start");
      uiSystem = await loadUiSystem();
      activeInspectorTab = uiSystem.layout.defaultInspectorTab;
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
    activeInspectorTab = "events";
    if (renderPlan.inspectorMode !== "drawer") {
      return;
    }
    const nextOpen = !showEvents;
    showEvents = nextOpen;
    if (nextOpen) {
      showApprovals = false;
    }
  }

  function toggleApprovals() {
    activeInspectorTab = "approvals";
    if (renderPlan.inspectorMode !== "drawer") {
      return;
    }
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

  async function handleCreateProfile() {
    const nextDocument = createUiProfile(uiSystem.profiles);
    uiSystem = { ...uiSystem, profiles: nextDocument };
    await saveUiProfilesDocument(nextDocument);
  }

  async function handleSaveProfile(event: CustomEvent<UiProfile>) {
    const nextDocument = updateActiveUiProfile(uiSystem.profiles, event.detail);
    uiSystem = { ...uiSystem, profiles: nextDocument };
    await saveUiProfilesDocument(nextDocument);
  }

  async function handleActivateProfile(event: CustomEvent<{ id: string }>) {
    const nextDocument = setActiveUiProfile(uiSystem.profiles, event.detail.id);
    uiSystem = { ...uiSystem, profiles: nextDocument };
    await saveUiProfilesDocument(nextDocument);
  }

  async function handleDeleteProfile() {
    const nextDocument = deleteActiveUiProfile(uiSystem.profiles);
    uiSystem = { ...uiSystem, profiles: nextDocument };
    await saveUiProfilesDocument(nextDocument);
  }

  function handleComposerSend() {
    void handleSend();
  }

  function handleComposerStop() {
    void handleStop();
  }

  function openSettings() {
    showSettings = true;
  }

  function syncDraftModel(models: ModelPreset[], draft: ProviderDraft) {
    if (models.length === 0 || draft.model.trim().length > 0) {
      return;
    }

    providerDraft = {
      ...draft,
      model: models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "",
    };
  }
</script>

<AppShell {drawerOpen} {sidebarOpen} sidebarSide={renderPlan.sidebarSide}>
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
    on:profiles={() => {
      showProfiles = true;
    }}
    on:events={toggleEvents}
    on:approvals={toggleApprovals}
    on:selectthread={() => {}}
  />

  <div slot="main" class="main-column">
    {#if renderPlan.headerVisible}
      <ThreadHeader
        {sidebarOpen}
        on:togglesidebar={() => (sidebarOpen = !sidebarOpen)}
        on:newthread={handleResetThread}
        on:settings={openSettings}
        on:profiles={() => (showProfiles = true)}
        on:events={toggleEvents}
      />
    {/if}

    <div class:with-inspector={inlineInspectorVisible} class="main-workspace">
      <div class="chat-column">
        {#each renderPlan.areas.mainTop as widget (widget.id + widget.title)}
          <div class:composer-stage={widget.id === "composer"} class:composer-stage-top={widget.id === "composer"}>
            <WidgetHost
              bind:message
              approvals={approvals}
              currentModel={providerDraft.model}
              currentReasoning={providerDraft.modelReasoningEffort}
              disabled={composerDisabled}
              liveStreamText={liveStreamText}
              metrics={metrics}
              models={state.models}
              onSelectModel={handleSelectModel}
              onSelectReasoning={handleSelectReasoning}
              onSend={handleComposerSend}
              onSettings={openSettings}
              onStop={handleComposerStop}
              runtimeActivities={runtimeActivities}
              status={state.status}
              transcript={state.transcript}
              widget={widget}
              widgetsDocument={uiSystem.widgets}
              {running}
            />
          </div>
        {/each}

        <main class="chat-stage">
          {#each renderPlan.areas.mainBody as widget (widget.id + widget.title)}
            <WidgetHost
              bind:message
              approvals={approvals}
              currentModel={providerDraft.model}
              currentReasoning={providerDraft.modelReasoningEffort}
              disabled={composerDisabled}
              liveStreamText={liveStreamText}
              metrics={metrics}
              models={state.models}
              onSelectModel={handleSelectModel}
              onSelectReasoning={handleSelectReasoning}
              onSend={handleComposerSend}
              onSettings={openSettings}
              onStop={handleComposerStop}
              runtimeActivities={runtimeActivities}
              status={state.status}
              transcript={state.transcript}
              widget={widget}
              widgetsDocument={uiSystem.widgets}
              {running}
            />
          {/each}
        </main>

        {#each renderPlan.areas.mainBottom as widget (widget.id + widget.title)}
          <div class:composer-stage={widget.id === "composer"}>
            <WidgetHost
              bind:message
              approvals={approvals}
              currentModel={providerDraft.model}
              currentReasoning={providerDraft.modelReasoningEffort}
              disabled={composerDisabled}
              liveStreamText={liveStreamText}
              metrics={metrics}
              models={state.models}
              onSelectModel={handleSelectModel}
              onSelectReasoning={handleSelectReasoning}
              onSend={handleComposerSend}
              onSettings={openSettings}
              onStop={handleComposerStop}
              runtimeActivities={runtimeActivities}
              status={state.status}
              transcript={state.transcript}
              widget={widget}
              widgetsDocument={uiSystem.widgets}
              {running}
            />
          </div>
        {/each}
      </div>

      {#if inlineInspectorVisible}
        <aside class="inspector-panel">
          {#each renderPlan.areas.inspector as widget (widget.id + widget.title)}
            {#if activeInspectorTab === "events" || widget.id !== "approvals"}
              {#if activeInspectorTab === "approvals" || widget.id !== "runtime_events"}
                <WidgetHost
                  bind:message
                  approvals={approvals}
                  currentModel={providerDraft.model}
                  currentReasoning={providerDraft.modelReasoningEffort}
                  disabled={composerDisabled}
                  liveStreamText={liveStreamText}
                  metrics={metrics}
                  models={state.models}
                  onSelectModel={handleSelectModel}
                  onSelectReasoning={handleSelectReasoning}
                  onSend={handleComposerSend}
                  onSettings={openSettings}
                  onStop={handleComposerStop}
                  runtimeActivities={runtimeActivities}
                  status={state.status}
                  transcript={state.transcript}
                  widget={widget}
                  widgetsDocument={uiSystem.widgets}
                  {running}
                />
              {/if}
            {/if}
          {/each}
        </aside>
      {/if}
    </div>
  </div>

  <div slot="drawer">
    <RuntimeEventsDrawer
      open={renderPlan.inspectorMode === "drawer" && showEvents}
      activities={runtimeActivities}
      on:close={() => (showEvents = false)}
    />
    <ApprovalDrawer
      open={renderPlan.inspectorMode === "drawer" && showApprovals}
      approvals={approvals}
      on:close={() => (showApprovals = false)}
    />
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

<UiProfilesModal
  document={uiSystem.profiles}
  open={showProfiles}
  on:close={() => (showProfiles = false)}
  on:createprofile={handleCreateProfile}
  on:saveprofile={handleSaveProfile}
  on:activateprofile={handleActivateProfile}
  on:deleteprofile={handleDeleteProfile}
/>
