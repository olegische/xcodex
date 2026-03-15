<script lang="ts">
  import AppShell from "./AppShell.svelte";
  import ApprovalDrawer from "./ApprovalDrawer.svelte";
  import ChatFoundation from "./ChatFoundation.svelte";
  import RuntimeSurfaceStack from "./RuntimeSurfaceStack.svelte";
  import RuntimeEventsDrawer from "./RuntimeEventsDrawer.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ThreadHeader from "./ThreadHeader.svelte";
  import type { DemoState, ProviderDraft, RuntimeActivity } from "../runtime";
  import type {
    PendingApproval,
    PlanStepItem,
    RuntimeStatusSummary,
    SessionStatusItem,
    ThreadSummary,
    WorkspaceFileSummary,
  } from "../types";
  import type { MetricItem, ShellActionSpec, UiRenderPlan, UiSystemDocument } from "../ui/types";
  import type { InspectorState } from "../stores/inspector";
  import type { RuntimeUiState } from "../stores/runtime-ui";

  export let state: DemoState;
  export let providerDraft: ProviderDraft;
  export let providerSummary = "";
  export let renderPlan: UiRenderPlan;
  export let uiSystem: UiSystemDocument;
  export let threads: ThreadSummary[] = [];
  export let approvals: PendingApproval[] = [];
  export let metrics: MetricItem[] = [];
  export let sessionStatus: SessionStatusItem[] = [];
  export let routerStatus: RuntimeStatusSummary;
  export let codexStatus: RuntimeStatusSummary;
  export let latestPlanExplanation: string | null = null;
  export let planSteps: PlanStepItem[] = [];
  export let toolActivities: RuntimeActivity[] = [];
  export let composerDisabled = false;
  export let workspaceFiles: WorkspaceFileSummary[] = [];
  export let inspectorState: InspectorState;
  export let runtimeUiState: RuntimeUiState;
  export let inlineInspectorVisible = false;
  export let drawerOpen = false;
  export let sidebarPrimaryAction: ShellActionSpec;
  export let sidebarFooterActions: ShellActionSpec[] = [];
  export let headerLeadingActions: ShellActionSpec[] = [];
  export let headerTrailingActions: ShellActionSpec[] = [];
  export let onToggleSidebar: () => void;
  export let onCloseEvents: () => void;
  export let onCloseApprovals: () => void;
  export let onResetThread: () => void;
  export let onSelectStatus: () => void;
  export let onSelectPlan: () => void;
  export let onSelectMetrics: () => void;
  export let onToggleEvents: () => void;
  export let onToggleApprovals: () => void;
  export let onSelectTools: () => void;
  export let onSelectWorkspace: () => void;
  export let onOpenSettings: () => void;
  export let onOpenProfiles: () => void;
  export let onComposerSend: () => void;
  export let onComposerStop: () => void;

  const SHELL_ACTION_HANDLERS = {
    toggle_sidebar: () => onToggleSidebar(),
    new_thread: () => onResetThread(),
    status: () => onSelectStatus(),
    plan: () => onSelectPlan(),
    metrics: () => onSelectMetrics(),
    events: () => onToggleEvents(),
    approvals: () => onToggleApprovals(),
    tools: () => onSelectTools(),
    workspace: () => onSelectWorkspace(),
    profiles: () => onOpenProfiles(),
    settings: () => onOpenSettings(),
  } as const;

  function handleShellAction(actionId: keyof typeof SHELL_ACTION_HANDLERS) {
    SHELL_ACTION_HANDLERS[actionId]();
  }

  function inspectorWidgetVisible(widgetId: string) {
    return (
      (inspectorState.activeTab === "metrics" && widgetId === "metrics") ||
      (inspectorState.activeTab === "status" && widgetId === "session_status") ||
      (inspectorState.activeTab === "plan" && widgetId === "plan_status") ||
      (inspectorState.activeTab === "events" && widgetId === "runtime_events") ||
      (inspectorState.activeTab === "approvals" && widgetId === "approvals") ||
      (inspectorState.activeTab === "tools" && widgetId === "tool_activity") ||
      (inspectorState.activeTab === "workspace" && widgetId === "workspace_files")
    );
  }

  function isFoundationWidget(widgetId: string) {
    return widgetId === "transcript" || widgetId === "composer";
  }

  $: runtimeMainWidgets = [
    ...renderPlan.areas.mainTop,
    ...renderPlan.areas.mainBody,
    ...renderPlan.areas.mainBottom,
  ].filter((widget) => !isFoundationWidget(widget.id));

  $: inspectorWidgets = renderPlan.areas.inspector.filter((widget) => !isFoundationWidget(widget.id));
  $: splitRuntimeSurface = runtimeMainWidgets.length > 0 && renderPlan.chatPlacement !== "center";
</script>

<AppShell {drawerOpen} sidebarOpen={inspectorState.sidebarOpen} sidebarSide={renderPlan.sidebarSide}>
  <Sidebar
    slot="sidebar"
    footerActions={sidebarFooterActions}
    primaryAction={sidebarPrimaryAction}
    {threads}
    currentModel={providerDraft.model}
    {routerStatus}
    {codexStatus}
    {providerSummary}
    on:action={(event) => handleShellAction(event.detail)}
    on:selectthread={() => {}}
  />

  <div slot="main" class="main-column">
        {#if renderPlan.headerVisible}
      <ThreadHeader
        {headerLeadingActions}
        {headerTrailingActions}
        sidebarOpen={inspectorState.sidebarOpen}
        on:action={(event) => handleShellAction(event.detail)}
      />
    {/if}

    <div class:with-inspector={inlineInspectorVisible} class="main-workspace">
      <div
        class:chat-left={splitRuntimeSurface && renderPlan.chatPlacement === "left"}
        class:chat-right={splitRuntimeSurface && renderPlan.chatPlacement === "right"}
        class:split-runtime-surface={splitRuntimeSurface}
        class="main-chat-surface"
      >
        {#if splitRuntimeSurface}
          <div class="runtime-pane">
            <RuntimeSurfaceStack
              widgets={runtimeMainWidgets}
              {approvals}
              disabled={composerDisabled}
              {latestPlanExplanation}
              liveStreamText={runtimeUiState.liveStreamText}
              {metrics}
              onSend={onComposerSend}
              onSettings={onOpenSettings}
              onStop={onComposerStop}
              {planSteps}
              running={runtimeUiState.running}
              runtimeActivities={runtimeUiState.activities}
              sessionStatus={sessionStatus}
              status={state.status}
              toolActivities={toolActivities}
              transcript={state.transcript}
              widgetsDocument={uiSystem.widgets}
              {workspaceFiles}
            />
          </div>
        {:else if runtimeMainWidgets.length > 0}
          <RuntimeSurfaceStack
            widgets={runtimeMainWidgets}
            {approvals}
            disabled={composerDisabled}
            {latestPlanExplanation}
            liveStreamText={runtimeUiState.liveStreamText}
            {metrics}
            onSend={onComposerSend}
            onSettings={onOpenSettings}
            onStop={onComposerStop}
            {planSteps}
            running={runtimeUiState.running}
            runtimeActivities={runtimeUiState.activities}
            sessionStatus={sessionStatus}
            status={state.status}
            toolActivities={toolActivities}
            transcript={state.transcript}
            widgetsDocument={uiSystem.widgets}
            {workspaceFiles}
          />
        {/if}

        <div class="chat-foundation-pane">
          <ChatFoundation
            disabled={composerDisabled}
            liveStreamText={runtimeUiState.liveStreamText}
            onSend={onComposerSend}
            onSettings={onOpenSettings}
            onStop={onComposerStop}
            running={runtimeUiState.running}
            runtimeActivities={runtimeUiState.activities}
            status={state.status}
            transcript={state.transcript}
          />
        </div>
      </div>

      {#if inlineInspectorVisible}
        <aside class="inspector-panel">
          {#each inspectorWidgets as widget (widget.id + widget.title)}
            {#if inspectorWidgetVisible(widget.id)}
              <RuntimeSurfaceStack
                widgets={[widget]}
                {approvals}
                disabled={composerDisabled}
                {latestPlanExplanation}
                liveStreamText={runtimeUiState.liveStreamText}
                {metrics}
                onSend={onComposerSend}
                onSettings={onOpenSettings}
                onStop={onComposerStop}
                {planSteps}
                running={runtimeUiState.running}
                runtimeActivities={runtimeUiState.activities}
                sessionStatus={sessionStatus}
                status={state.status}
                toolActivities={toolActivities}
                transcript={state.transcript}
                widgetsDocument={uiSystem.widgets}
                {workspaceFiles}
              />
            {/if}
          {/each}
        </aside>
      {/if}
    </div>
  </div>

  <div slot="drawer">
    <RuntimeEventsDrawer
      open={renderPlan.inspectorMode === "drawer" && inspectorState.showEvents}
      activities={runtimeUiState.activities}
      on:close={onCloseEvents}
    />
    <ApprovalDrawer
      open={renderPlan.inspectorMode === "drawer" && inspectorState.showApprovals}
      {approvals}
      on:close={onCloseApprovals}
    />
  </div>
</AppShell>
