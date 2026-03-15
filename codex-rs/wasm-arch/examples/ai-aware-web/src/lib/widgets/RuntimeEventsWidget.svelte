<script lang="ts">
  import type { RuntimeActivity } from "../../runtime";

  export let title = "Runtime Events";
  export let runtimeActivities: RuntimeActivity[] = [];
  export let compact = false;

  function activitySummary(activity: RuntimeActivity): string {
    if (activity.type === "pageEvent") {
      return `[${activity.kind}] ${activity.summary}${activity.target ? ` -> ${activity.target}` : ""}`;
    }
    if (activity.type === "missionState") {
      return `${activity.phase} / ${activity.lane}: ${activity.summary}`;
    }
    if (activity.type === "toolCall") {
      return `call ${activity.toolName ?? "unknown tool"}`;
    }
    if (activity.type === "toolOutput") {
      return `output ${activity.callId ?? "tool"}`;
    }
    if (activity.type === "turnStart") {
      return `turn ${activity.model}`;
    }
    if (activity.type === "delta") {
      return activity.text;
    }
    if (activity.type === "planUpdate") {
      return activity.explanation ?? "plan updated";
    }
    if (activity.type === "assistantMessage") {
      return "assistant message committed";
    }
    if (activity.type === "completed") {
      return `completed ${activity.requestId}`;
    }
    if (activity.type === "error") {
      return activity.message;
    }
    return activity.type;
  }
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class="drawer-content">
    {#if runtimeActivities.length === 0}
      <p class="drawer-empty">No runtime events yet.</p>
    {/if}
    {#each runtimeActivities.slice().reverse() as activity}
      <div class="event-card">
        <div class="event-type">{activity.type}</div>
        <pre>{compact ? activitySummary(activity) : JSON.stringify(activity, null, 2)}</pre>
      </div>
    {/each}
  </div>
</section>
