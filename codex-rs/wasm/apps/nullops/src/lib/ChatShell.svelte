<script lang="ts">
  import WidgetHost from "./WidgetHost.svelte";
  import type { DemoState, RuntimeActivity, TranscriptEntry } from "../runtime";
  import type { PendingApproval, PlanStepItem, SessionStatusItem, WorkspaceFileSummary } from "../types";
  import type { MetricItem, RenderedWidget, UiWidgetsDocument } from "../ui/types";

  export let topWidgets: RenderedWidget[] = [];
  export let bodyWidgets: RenderedWidget[] = [];
  export let bottomWidgets: RenderedWidget[] = [];
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

<div class="chat-shell">
  {#if topWidgets.length > 0}
    <div class="chat-shell-top">
      {#each topWidgets as widget (widget.id + widget.title)}
        <WidgetHost
          {approvals}
          {disabled}
          {latestPlanExplanation}
          {metrics}
          onSend={onSend}
          onSettings={onSettings}
          onStop={onStop}
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
  {/if}

  <main class="chat-shell-body">
    {#each bodyWidgets as widget (widget.id + widget.title)}
      <WidgetHost
        {approvals}
        {disabled}
        {latestPlanExplanation}
        {metrics}
        onSend={onSend}
        onSettings={onSettings}
        onStop={onStop}
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
  </main>

  {#if bottomWidgets.length > 0}
    <div class="chat-shell-bottom">
      {#each bottomWidgets as widget (widget.id + widget.title)}
        <WidgetHost
          {approvals}
          {disabled}
          {latestPlanExplanation}
          {metrics}
          onSend={onSend}
          onSettings={onSettings}
          onStop={onStop}
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
  {/if}
</div>
