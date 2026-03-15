<script lang="ts">
  import RuntimeWorkbench from "./RuntimeWorkbench.svelte";
  import { inspectorStore } from "../stores/inspector";
  import { runtimeUiStore } from "../stores/runtime-ui";
  import type { DemoState, ProviderDraft, RuntimeActivity } from "../runtime";
  import type {
    PendingApproval,
    PlanStepItem,
    RuntimeStatusSummary,
    SessionStatusItem,
    ThreadSummary,
    WorkspaceFileSummary,
  } from "../types";
  import type { MetricItem, UiRenderPlan, UiSystemDocument } from "../ui/types";
  import { buildShellActionSet } from "../ui/shell-actions";

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

  function toggleSidebar() {
    inspectorStore.toggleSidebar();
  }

  function closeEvents() {
    inspectorStore.closeEvents();
  }

  function closeApprovals() {
    inspectorStore.closeApprovals();
  }

  $: runtimeUiState = $runtimeUiStore;
  $: inspectorState = $inspectorStore;
  $: inlineInspectorVisible = renderPlan.inspectorMode === "column";
  $: drawerOpen = renderPlan.inspectorMode === "drawer" && (inspectorState.showEvents || inspectorState.showApprovals);
  $: shellActions = buildShellActionSet(uiSystem.widgets.shell);
</script>

<RuntimeWorkbench
  {approvals}
  {composerDisabled}
  {drawerOpen}
  {inlineInspectorVisible}
  {inspectorState}
  latestPlanExplanation={latestPlanExplanation}
  {metrics}
  planSteps={planSteps}
  {routerStatus}
  {codexStatus}
  sessionStatus={sessionStatus}
  {toolActivities}
  headerLeadingActions={shellActions.headerLeadingActions}
  headerTrailingActions={shellActions.headerTrailingActions}
  onCloseApprovals={closeApprovals}
  onCloseEvents={closeEvents}
  {onComposerSend}
  {onComposerStop}
  {onOpenProfiles}
  {onOpenSettings}
  {onResetThread}
  {onSelectPlan}
  {onSelectStatus}
  {onSelectMetrics}
  {onSelectTools}
  {onSelectWorkspace}
  onToggleSidebar={toggleSidebar}
  {onToggleApprovals}
  {onToggleEvents}
  {providerDraft}
  {providerSummary}
  {renderPlan}
  runtimeUiState={runtimeUiState}
  sidebarFooterActions={shellActions.sidebarFooterActions}
  sidebarPrimaryAction={shellActions.sidebarPrimaryAction}
  {state}
  {threads}
  {uiSystem}
  {workspaceFiles}
/>
