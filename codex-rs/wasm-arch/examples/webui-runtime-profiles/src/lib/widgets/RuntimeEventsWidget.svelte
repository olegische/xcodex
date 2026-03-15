<script lang="ts">
  import type { RuntimeActivity } from "../../runtime";

  export let title = "Runtime Events";
  export let runtimeActivities: RuntimeActivity[] = [];
  export let compact = false;
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
        <pre>{compact ? activity.type : JSON.stringify(activity, null, 2)}</pre>
      </div>
    {/each}
  </div>
</section>
