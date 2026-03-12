<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    settings: void;
    events: void;
  }>();
  export let currentModel = "";
</script>

<header class="thread-header">
  <div class="nav-left"></div>

  <div class="nav-center">
    <button class="model-pill" on:click={() => dispatch("settings")}>
      <span class="model-pill-label">{currentModel || "Select model"}</span>
      <span class="model-pill-caret">v</span>
    </button>
  </div>

  <div class="nav-right">
    <button class="nav-icon-button" on:click={() => dispatch("events")} aria-label="Events">=</button>
    <button class="nav-icon-button" on:click={() => dispatch("settings")} aria-label="Settings">..</button>
  </div>
</header>
