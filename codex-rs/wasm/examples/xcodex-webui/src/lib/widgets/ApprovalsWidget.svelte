<script lang="ts">
  import type { PendingApproval } from "../../types";

  export let title = "Approvals";
  export let approvals: PendingApproval[] = [];
  export let compact = false;
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class="drawer-content">
    {#if approvals.length === 0}
      <p class="drawer-empty">No approval requests are waiting right now.</p>
    {/if}
    {#each approvals as approval}
      <div class="event-card">
        <div class="event-type">{approval.title}</div>
        <pre>{compact ? approval.title : approval.detail}</pre>
      </div>
    {/each}
  </div>
</section>
