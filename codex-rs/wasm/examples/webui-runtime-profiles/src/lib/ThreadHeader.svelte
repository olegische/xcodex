<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    settings: void;
    profiles: void;
    events: void;
    togglesidebar: void;
    newthread: void;
  }>();

  export let sidebarOpen = false;
</script>

<header class="thread-header">
  <div class="nav-left">
    <button class="nav-icon-button" on:click={() => dispatch("togglesidebar")} aria-label="Toggle sidebar">
      ≡
    </button>
    {#if !sidebarOpen}
      <button class="header-action-button" on:click={() => dispatch("newthread")}>New Chat</button>
    {/if}
  </div>

  <div class="nav-center"></div>

  <div class="nav-right">
    <button class="nav-icon-button" on:click={() => dispatch("events")} aria-label="Events">=</button>
    <button class="nav-icon-button" on:click={() => dispatch("profiles")} aria-label="Profiles">UI</button>
    <button class="nav-icon-button" on:click={() => dispatch("settings")} aria-label="Settings">..</button>
  </div>
</header>
