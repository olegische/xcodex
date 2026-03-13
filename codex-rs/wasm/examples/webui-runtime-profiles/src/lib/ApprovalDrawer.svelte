<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { PendingApproval } from "../types";

  const dispatch = createEventDispatcher<{ close: void }>();

  export let open = false;
  export let approvals: PendingApproval[] = [];
</script>

{#if open}
  <aside class="drawer">
    <div class="drawer-header">
      <div>
        <div class="eyebrow">Safety</div>
        <h3>Approvals</h3>
      </div>
      <button class="button ghost" on:click={() => dispatch("close")}>Close</button>
    </div>

    <div class="drawer-content">
      {#if approvals.length === 0}
        <p class="drawer-empty">
          No approval requests are waiting right now.
        </p>
      {/if}

      {#each approvals as approval}
        <div class="event-card">
          <div class="event-type">{approval.title}</div>
          <pre>{approval.detail}</pre>
        </div>
      {/each}
    </div>
  </aside>
{/if}
