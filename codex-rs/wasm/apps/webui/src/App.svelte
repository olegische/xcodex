<script lang="ts">
  import { onMount } from "svelte";
  import BootConsole from "./lib/BootConsole.svelte";
  import RuntimeModalsContainer from "./lib/RuntimeModalsContainer.svelte";
  import RuntimeWorkbenchContainer from "./lib/RuntimeWorkbenchContainer.svelte";
  import { bootStore } from "./stores/boot";
  import { collaborationStore } from "./stores/collaboration";
  import { composerStore } from "./stores/composer";
  import { inspectorStore } from "./stores/inspector";
  import { runtimeSessionStore } from "./stores/runtime-session";
  import { runtimeUiStore } from "./stores/runtime-ui";
  import { uiSystemStore } from "./stores/ui-system";
  import { workspaceBrowserStore } from "./stores/workspace-browser";
  import { setupAppLifecycle } from "./app/lifecycle";
  import { createWorkbenchModel } from "./app/workbench-model";
  import {
    activateProfile,
    clearAuth,
    createProfile,
    deleteActiveProfile,
    refreshAccountAndModels,
    resetThread,
    saveProfile,
    saveProviderConfig,
    sendTurn,
    stopTurn,
    toggleInspectorTab,
    toggleApprovals,
  } from "./app/actions";

  $: runtimeSession = $runtimeSessionStore;
  $: state = runtimeSession.state;
  $: providerDraft = runtimeSession.providerDraft;
  $: bootState = $bootStore;
  $: uiSystem = $uiSystemStore;
  $: runtimeUiState = $runtimeUiStore;
  $: workspaceBrowserState = $workspaceBrowserStore;
  $: composerState = $composerStore;
  $: collaborationState = $collaborationStore;
  $: workbenchModel = createWorkbenchModel({
    state,
    providerDraft,
    uiSystem,
    runtimeActivities: runtimeUiState.activities,
    approvals: collaborationState.pendingApprovals,
    running: runtimeUiState.running,
    composerMessage: composerState.message,
    workspaceFiles: workspaceBrowserState.files,
  });

  onMount(() => setupAppLifecycle());

  function openSettings() {
    inspectorStore.openSettings();
  }
</script>

{#if bootState.phase !== "ready"}
  <BootConsole {bootState} />
{/if}

<RuntimeWorkbenchContainer
  approvals={workbenchModel.approvals}
  composerDisabled={workbenchModel.composerDisabled}
  latestPlanExplanation={workbenchModel.latestPlanExplanation}
  metrics={workbenchModel.metrics}
  planSteps={workbenchModel.planSteps}
  routerStatus={workbenchModel.routerStatus}
  codexStatus={workbenchModel.codexStatus}
  sessionStatus={workbenchModel.sessionStatus}
  toolActivities={workbenchModel.toolActivities}
  onComposerSend={() => void sendTurn()}
  onComposerStop={() => void stopTurn()}
  onOpenProfiles={() => inspectorStore.openProfiles()}
  onOpenSettings={openSettings}
  onResetThread={() => void resetThread()}
  onSelectInspector={(event) => toggleInspectorTab(event.detail.id, workbenchModel.renderPlan)}
  onSelectPlan={() => toggleInspectorTab("plan", workbenchModel.renderPlan)}
  onSelectStatus={() => toggleInspectorTab("status", workbenchModel.renderPlan)}
  onSelectMetrics={() => toggleInspectorTab("metrics", workbenchModel.renderPlan)}
  onSelectWorkspace={() => toggleInspectorTab("workspace", workbenchModel.renderPlan)}
  onToggleApprovals={() => toggleApprovals(workbenchModel.renderPlan)}
  {providerDraft}
  providerSummary={workbenchModel.providerSummary}
  renderPlan={workbenchModel.renderPlan}
  {state}
  threads={workbenchModel.threads}
  {uiSystem}
  workspaceFiles={workbenchModel.workspaceFiles}
/>

<RuntimeModalsContainer
  draft={providerDraft}
  disabled={runtimeUiState.running}
  profiles={uiSystem.profiles}
  onSaveConfig={(event) => void saveProviderConfig(event.detail)}
  onRefreshAccountAndModels={(event) => void refreshAccountAndModels(event.detail)}
  onClearAuth={() => void clearAuth()}
  onCreateProfile={() => void createProfile()}
  onSaveProfile={(event) => void saveProfile(event.detail)}
  onActivateProfile={(event) => void activateProfile(event.detail.id)}
  onDeleteProfile={() => void deleteActiveProfile()}
/>
