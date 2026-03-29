<script lang="ts">
  import AppShell from "./AppShell.svelte";
  import ApprovalDrawer from "./ApprovalDrawer.svelte";
  import ChatFoundation from "./ChatFoundation.svelte";
  import RuntimeSurfaceStack from "./RuntimeSurfaceStack.svelte";
  import Sidebar from "./Sidebar.svelte";
  import ThreadHeader from "./ThreadHeader.svelte";
  import type { DemoState, RuntimeActivity } from "../runtime";
  import type { InspectorState } from "../stores/inspector";
  import type { RuntimeUiState } from "../stores/runtime-ui";
  import type {
    PendingApproval,
    PlanStepItem,
    RuntimeStatusSummary,
    SessionStatusItem,
    ThreadGroupSummary,
    WorkspaceFileSummary,
  } from "../types";
  import type { InspectorTab, MetricItem, ShellActionSpec, UiRenderPlan, UiSystemDocument } from "../ui/types";

  export let state: DemoState;
  export let renderPlan: UiRenderPlan;
  export let uiSystem: UiSystemDocument;
  export let threadGroups: ThreadGroupSummary[] = [];
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
  export let drawerOpen = false;
  export let sidebarPrimaryAction: ShellActionSpec;
  export let sidebarFooterActions: ShellActionSpec[] = [];
  export let headerLeadingActions: ShellActionSpec[] = [];
  export let headerTrailingActions: ShellActionSpec[] = [];
  export let onToggleSidebar: () => void;
  export let onCloseApprovals: () => void;
  export let onResetThread: () => void;
  export let onSelectInspector: (event: CustomEvent<{ id: InspectorTab }>) => void;
  export let onSelectStatus: () => void;
  export let onSelectPlan: () => void;
  export let onSelectMetrics: () => void;
  export let onToggleApprovals: () => void;
  export let onSelectWorkspace: () => void;
  export let onOpenSettings: () => void;
  export let onComposerSend: () => void;
  export let onComposerStop: () => void;
  export let onSelectThread: (threadId: string) => void;

  const SHELL_ACTION_HANDLERS = {
    toggle_sidebar: () => onToggleSidebar(),
    new_thread: () => onResetThread(),
    status: () => onSelectStatus(),
    plan: () => onSelectPlan(),
    metrics: () => onSelectMetrics(),
    approvals: () => onToggleApprovals(),
    workspace: () => onSelectWorkspace(),
    settings: () => onOpenSettings(),
  } as const;

  function handleShellAction(actionId: keyof typeof SHELL_ACTION_HANDLERS) {
    SHELL_ACTION_HANDLERS[actionId]();
  }

  function isFoundationWidget(widgetId: string) {
    return widgetId === "transcript" || widgetId === "composer";
  }

  function inspectorWidgetVisible(tab: InspectorTab, widgetId: string) {
    switch (tab) {
      case "mission":
        return widgetId === "plan_status";
      case "citations":
        return widgetId === "citations";
      case "page":
        return widgetId === "page_state";
      case "signals":
        return widgetId === "web_signals";
      case "workspace":
        return widgetId === "workspace_files";
      case "status":
        return widgetId === "session_status" || widgetId === "metrics";
      case "plan":
        return widgetId === "plan_status";
      case "metrics":
        return widgetId === "metrics";
      case "approvals":
        return widgetId === "approvals";
      default:
        return false;
    }
  }

  function inspectorHeading(tab: InspectorTab): { eyebrow: string; title: string; copy: string } {
    switch (tab) {
      case "mission":
        return {
          eyebrow: "Chat",
          title: "Chat and execution context",
          copy: "Current chat turn, execution posture, and bounded browser-task context.",
        };
      case "citations":
        return {
          eyebrow: "Citations",
          title: "Artifact provenance",
          copy: "Cited sources, anchor verification, and the evidence chain behind each artifact.",
        };
      case "page":
        return {
          eyebrow: "Page",
          title: "Browser surface",
          copy: "Current page context, selection, and interactive state.",
        };
      case "signals":
        return {
          eyebrow: "Signals",
          title: "AI-readable quality",
          copy: "Metadata quality, llms.txt, schema.org, and trust gaps.",
        };
      case "workspace":
        return {
          eyebrow: "Artifacts",
          title: "Workspace memory",
          copy: "Durable files, notes, and generated outputs.",
        };
      case "status":
        return {
          eyebrow: "Status",
          title: "Runtime pulse",
          copy: "Session status, counters, and model health.",
        };
      case "plan":
        return {
          eyebrow: "Plan",
          title: "Execution plan",
          copy: "Structured steps and latest planning rationale.",
        };
      case "metrics":
        return {
          eyebrow: "Metrics",
          title: "Runtime metrics",
          copy: "Model, tools, workspace, and event counters.",
        };
      case "approvals":
        return {
          eyebrow: "Approvals",
          title: "Human checkpoints",
          copy: "Pending approvals waiting for a decision.",
        };
      default:
        return {
          eyebrow: "Inspector",
          title: "Runtime state",
          copy: "Focused runtime surface.",
        };
    }
  }

  $: mainTopWidgets = renderPlan.areas.mainTop ?? [];
  $: mainBodyWidgets = renderPlan.areas.mainBody ?? [];
  $: mainBottomWidgets = renderPlan.areas.mainBottom ?? [];
  $: inspectorWidgets = renderPlan.areas.inspector ?? [];
  $: runtimeWidgets = [
    ...mainTopWidgets,
    ...mainBodyWidgets,
    ...mainBottomWidgets,
    ...inspectorWidgets,
    { id: "citations", title: "Citations" },
  ].filter(
    (widget, index, widgets) =>
      !isFoundationWidget(widget.id) && widgets.findIndex((entry) => entry.id === widget.id) === index,
  );
  $: rightWidgets = runtimeWidgets.filter((widget) => inspectorWidgetVisible(inspectorState.activeTab, widget.id));
  $: missionMode = inspectorState.activeTab === "mission";
  $: displayTranscript =
    runtimeUiState.transcriptEntries.length > 0
      ? runtimeUiState.transcriptEntries
      : state.transcript;
</script>

<AppShell {drawerOpen} sidebarOpen={inspectorState.sidebarOpen} sidebarSide={renderPlan.sidebarSide}>
  <Sidebar
    slot="sidebar"
    footerActions={sidebarFooterActions}
    primaryAction={sidebarPrimaryAction}
    {threadGroups}
    {routerStatus}
    {codexStatus}
    on:action={(event) => handleShellAction(event.detail)}
    on:selectthread={(event) => onSelectThread(event.detail)}
  />

  <div slot="main" class="main-column">
    {#if renderPlan.headerVisible}
      <ThreadHeader
        activeInspectorTab={inspectorState.activeTab}
        {headerLeadingActions}
        {headerTrailingActions}
        sidebarOpen={inspectorState.sidebarOpen}
        on:action={(event) => handleShellAction(event.detail)}
        on:selectinspector={onSelectInspector}
      />
    {/if}

    <div class="main-workspace">
      {#if missionMode}
        <section class="chat-screen">
          <div class="chat-screen-body">
            <ChatFoundation
              disabled={composerDisabled}
              onSend={onComposerSend}
              onSettings={onOpenSettings}
              onStop={onComposerStop}
              running={runtimeUiState.running}
              runtimeActivities={runtimeUiState.activities}
              status={state.status}
              transcript={displayTranscript}
            />
          </div>
        </section>
      {:else}
        <section class="inspector-screen">
          {#if rightWidgets.length > 0}
            <RuntimeSurfaceStack
              widgets={rightWidgets}
              {approvals}
              disabled={composerDisabled}
              {latestPlanExplanation}
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
              transcript={displayTranscript}
              widgetsDocument={uiSystem.widgets}
              {workspaceFiles}
            />
          {:else}
            {@const inspectorMeta = inspectorHeading(inspectorState.activeTab)}
            <div class="inspector-screen-header">
              <div class="eyebrow">{inspectorMeta.eyebrow}</div>
              <strong>{inspectorMeta.title}</strong>
              <p>{inspectorMeta.copy}</p>
            </div>
            <div class="drawer-empty">No data in this inspector yet.</div>
          {/if}
        </section>
      {/if}
    </div>
  </div>

  <div slot="drawer">
    <ApprovalDrawer
      open={renderPlan.inspectorMode === "drawer" && inspectorState.showApprovals}
      {approvals}
      on:close={onCloseApprovals}
    />
  </div>
</AppShell>
