<script lang="ts">
  import type { MetricItem } from "../../ui/types";

  export let title = "Metrics";
  export let metrics: MetricItem[] = [];
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class="metrics-grid">
    {#each metrics as metric}
      <div class="metric-card">
        <div class="event-type">{metric.label}</div>
        <strong>{metric.value}</strong>
      </div>
    {/each}
  </div>
</section>
