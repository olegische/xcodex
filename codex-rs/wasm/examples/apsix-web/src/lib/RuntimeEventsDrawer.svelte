<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { RuntimeActivity } from "../runtime";

  const dispatch = createEventDispatcher<{ close: void }>();

  export let open = false;
  export let activities: RuntimeActivity[] = [];

  function renderActivity(activity: RuntimeActivity): string {
    switch (activity.type) {
      case "turnStart":
        return `turnStart ${activity.requestId} ${activity.model}`;
      case "delta":
        return `delta ${activity.text}`;
      case "toolCall":
        return `toolCall ${activity.toolName ?? "unknown"}`;
      case "toolOutput":
        return `toolOutput ${activity.callId ?? "no-call-id"}`;
      case "planUpdate":
        return `planUpdate ${activity.explanation ?? "updated"}`;
      case "missionState":
        return `missionState ${activity.phase} ${activity.lane}`;
      case "pageEvent":
        return `pageEvent ${activity.kind} ${activity.summary}`;
      case "apsixZone":
        return `apsixZone ${activity.lifecycleState} ${activity.phase}`;
      case "apsixSpawn":
        return `apsixSpawn ${activity.actorId} ${activity.decision}`;
      case "apsixArtifact":
        return `apsixArtifact ${activity.artifactId} ${activity.status}`;
      case "apsixAnchor":
        return `apsixAnchor ${activity.anchorId} ${activity.decision}`;
      case "apsixFreeze":
        return `apsixFreeze ${activity.zoneId}`;
      case "assistantMessage":
        return "assistantMessage";
      case "completed":
        return `completed ${activity.finishReason ?? "done"}`;
      case "error":
        return `error ${activity.message}`;
      default:
        return activity.type;
    }
  }
</script>

{#if open}
  <aside class="drawer">
    <div class="drawer-header">
      <div>
        <div class="eyebrow">Inspector</div>
        <h3>Runtime Events</h3>
      </div>
      <button class="button ghost" on:click={() => dispatch("close")}>Close</button>
    </div>

    <div class="drawer-content">
      {#if activities.length === 0}
        <p class="drawer-empty">No runtime events yet.</p>
      {/if}

      {#each activities.slice().reverse() as activity}
        <div class="event-card">
          <div class="event-type">{activity.type}</div>
          <pre>{renderActivity(activity)}</pre>
        </div>
      {/each}
    </div>
  </aside>
{/if}
