<script lang="ts">
  import WidgetHost from "./WidgetHost.svelte";
  import type { RuntimeActivity, TranscriptEntry } from "../runtime";
  import type { PendingApproval, PlanStepItem, SessionStatusItem, WorkspaceFileSummary } from "../types";
  import type { MetricItem, RenderedWidget, UiWidgetsDocument } from "../ui/types";

  export let widgets: RenderedWidget[] = [];
  export let widgetsDocument: UiWidgetsDocument;
  export let transcript: TranscriptEntry[] = [];
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
</script>

<div class="runtime-surface-stack">
  {#each widgets as widget (widget.id + widget.title)}
    <WidgetHost
      {approvals}
      {disabled}
      {latestPlanExplanation}
      {metrics}
      {onSend}
      {onSettings}
      {onStop}
      {planSteps}
      {running}
      {runtimeActivities}
      {sessionStatus}
      {status}
      {toolActivities}
      {transcript}
      {widget}
      {widgetsDocument}
      {workspaceFiles}
    />
  {/each}
</div>
