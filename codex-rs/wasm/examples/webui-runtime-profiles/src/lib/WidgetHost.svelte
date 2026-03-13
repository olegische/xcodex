<script lang="ts">
  import type { RuntimeActivity, TranscriptEntry } from "../runtime";
  import type { PendingApproval, PlanStepItem, SessionStatusItem, WorkspaceFileSummary } from "../types";
  import type { MetricItem, RenderedWidget, UiWidgetsDocument } from "../ui/types";
  import { getWidgetRenderer } from "../ui/component-registry";

  export let widget: RenderedWidget;
  export let widgetsDocument: UiWidgetsDocument;
  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  export let disabled = false;
  export let runtimeActivities: RuntimeActivity[] = [];
  export let toolActivities: RuntimeActivity[] = [];
  export let approvals: PendingApproval[] = [];
  export let metrics: MetricItem[] = [];
  export let sessionStatus: SessionStatusItem[] = [];
  export let latestPlanExplanation: string | null = null;
  export let planSteps: PlanStepItem[] = [];
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  export let onSend: () => void;
  export let onStop: () => void;
  export let onSettings: () => void;

  $: renderer = getWidgetRenderer(widget.id);
  $: componentProps = renderer.createProps({
    widget,
    widgetsDocument,
    transcript,
    liveStreamText,
    status,
    running,
    disabled,
    runtimeActivities,
    toolActivities,
    approvals,
    metrics,
    sessionStatus,
    latestPlanExplanation,
    planSteps,
    workspaceFiles,
    onSend,
    onStop,
    onSettings,
  });
</script>

<svelte:component this={renderer.component} {...componentProps} />
