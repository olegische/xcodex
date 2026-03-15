<script lang="ts">
  import type { SessionStatusItem } from "../../types";

  export let title = "Session Status";
  export let items: SessionStatusItem[] = [];
  export let dense = false;
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class:dense class="status-grid">
    {#each items as item}
      <div class="metric-card">
        <div class="event-type">{item.label}</div>
        <strong>{item.value}</strong>
      </div>
    {/each}
  </div>
</section>
