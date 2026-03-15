<script lang="ts">
  import type { PlanStepItem } from "../../types";

  export let title = "Plan Status";
  export let explanation: string | null = null;
  export let steps: PlanStepItem[] = [];
  export let showExplanation = true;
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class="drawer-content">
    {#if showExplanation && explanation}
      <div class="event-card">
        <div class="event-type">Explanation</div>
        <pre>{explanation}</pre>
      </div>
    {/if}
    {#if steps.length === 0}
      <p class="drawer-empty">No plan updates yet.</p>
    {/if}
    {#each steps as step}
      <div class="event-card">
        <div class="event-type">{step.status}</div>
        <pre>{step.step}</pre>
      </div>
    {/each}
  </div>
</section>
