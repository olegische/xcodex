<script lang="ts">
  import MessageComposer from "./MessageComposer.svelte";
  import Transcript from "./Transcript.svelte";
  import type { ModelPreset, RuntimeActivity, TranscriptEntry } from "../runtime";
  import type { PendingApproval } from "../types";
  import type { MetricItem, RenderedWidget, UiWidgetsDocument } from "../ui/types";

  export let widget: RenderedWidget;
  export let widgetsDocument: UiWidgetsDocument;
  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  export let message = "";
  export let disabled = false;
  export let models: ModelPreset[] = [];
  export let currentModel = "";
  export let currentReasoning = "medium";
  export let runtimeActivities: RuntimeActivity[] = [];
  export let approvals: PendingApproval[] = [];
  export let metrics: MetricItem[] = [];

  export let onSend: () => void;
  export let onStop: () => void;
  export let onSettings: () => void;
  export let onSelectModel: (event: CustomEvent<{ model: string }>) => void;
  export let onSelectReasoning: (event: CustomEvent<{ value: string }>) => void;
</script>

{#if widget.id === "transcript"}
  <section class:transcript-flat={widgetsDocument.transcript.variant === "flat"} class="widget-surface">
    <Transcript {transcript} {liveStreamText} {status} {running} />
  </section>
{:else if widget.id === "composer"}
  <div class="widget-surface">
    <MessageComposer
      bind:message
      {currentModel}
      currentReasoning={currentReasoning}
      {disabled}
      {models}
      {running}
      on:send={onSend}
      on:stop={onStop}
      on:settings={onSettings}
      on:selectmodel={onSelectModel}
      on:selectreasoning={onSelectReasoning}
    />
  </div>
{:else if widget.id === "metrics"}
  <section class="widget-panel inspector-section">
    <div class="eyebrow">{widget.title}</div>
    <div class="metrics-grid">
      {#each metrics as metric}
        <div class="metric-card">
          <div class="event-type">{metric.label}</div>
          <strong>{metric.value}</strong>
        </div>
      {/each}
    </div>
  </section>
{:else if widget.id === "runtime_events"}
  <section class="widget-panel inspector-section">
    <div class="eyebrow">{widget.title}</div>
    <div class="drawer-content">
      {#if runtimeActivities.length === 0}
        <p class="drawer-empty">No runtime events yet.</p>
      {/if}
      {#each runtimeActivities.slice().reverse() as activity}
        <div class="event-card">
          <div class="event-type">{activity.type}</div>
          <pre>{widgetsDocument.runtimeEvents.compact ? activity.type : JSON.stringify(activity, null, 2)}</pre>
        </div>
      {/each}
    </div>
  </section>
{:else if widget.id === "approvals"}
  <section class="widget-panel inspector-section">
    <div class="eyebrow">{widget.title}</div>
    <div class="drawer-content">
      {#if approvals.length === 0}
        <p class="drawer-empty">No approval-gated actions surfaced yet.</p>
      {/if}
      {#each approvals as approval}
        <div class="event-card">
          <div class="event-type">{approval.title}</div>
          <pre>{widgetsDocument.approvals.compact ? approval.title : approval.detail}</pre>
        </div>
      {/each}
    </div>
  </section>
{/if}
