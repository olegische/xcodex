<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ShellActionId, ShellActionSpec } from "../ui/types";

  const dispatch = createEventDispatcher<{
    action: ShellActionId;
  }>();

  export let sidebarOpen = false;
  export let leadingActions: ShellActionSpec[] = [];
  export let trailingActions: ShellActionSpec[] = [];

  function triggerAction(id: ShellActionId) {
    dispatch("action", id);
  }
</script>

<header class="thread-header">
  <div class="nav-left">
    {#each leadingActions as action (action.id)}
      {#if action.id === "new_thread"}
        {#if !sidebarOpen}
          <button class="header-action-button" on:click={() => triggerAction(action.id)}>{action.label}</button>
        {/if}
      {:else}
        <button class="nav-icon-button" on:click={() => triggerAction(action.id)} aria-label={action.ariaLabel}>
          {action.shortLabel}
        </button>
      {/if}
    {/each}
  </div>

  <div class="nav-center"></div>

  <div class="nav-right">
    {#each trailingActions as action (action.id)}
      <button class="nav-icon-button" on:click={() => triggerAction(action.id)} aria-label={action.ariaLabel}>
        {action.shortLabel}
      </button>
    {/each}
  </div>
</header>
