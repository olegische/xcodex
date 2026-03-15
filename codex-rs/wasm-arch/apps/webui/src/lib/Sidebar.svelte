<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ThreadSummary } from "../types";

  const dispatch = createEventDispatcher<{
    newthread: void;
    settings: void;
    events: void;
    approvals: void;
    selectthread: string;
  }>();

  export let threads: ThreadSummary[] = [];
  export let providerSummary = "";
  export let currentModel = "";
  export let status = "";
  export let running = false;

  $: runtimeStateLabel = running ? "Running" : "Ready";
  $: runtimeToneClass = running ? "running" : "ready";
</script>

<aside class="sidebar">
  <div class="sidebar-brand">
    <div>
      <div class="sidebar-title">XCodex</div>
      <div class="sidebar-caption">WebUI</div>
    </div>
  </div>

  <button class="sidebar-new-chat" on:click={() => dispatch("newthread")}>New Chat</button>

  <div class="sidebar-group">
    <div class="sidebar-group-title">Chats</div>
    <div class="thread-list">
      {#each threads as thread}
        <button class:active={thread.active} class="thread-card" on:click={() => dispatch("selectthread", thread.id)}>
          <span class="thread-title">{thread.title}</span>
          <span class="thread-subtitle">{thread.subtitle}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="sidebar-group runtime-group">
    <div class="runtime-group-header">
      <div class="sidebar-group-title">Runtime</div>
      <div class:running={running} class:ready={!running} class="runtime-badge">
        <span class="runtime-badge-dot"></span>
        <span>{runtimeStateLabel}</span>
      </div>
    </div>
    <div class="sidebar-meta">
      <span>{providerSummary || "Provider not configured"}</span>
      <strong>{currentModel || "No model selected"}</strong>
    </div>
    {#if status.length > 0 && running}
      <div class:running={running} class:ready={!running} class="sidebar-status">{status}</div>
    {/if}
  </div>

  <div class="sidebar-footer">
    <button class="sidebar-link" on:click={() => dispatch("settings")}>Settings</button>
    <button class="sidebar-link" on:click={() => dispatch("events")}>Events</button>
    <button class="sidebar-link" on:click={() => dispatch("approvals")}>Approvals</button>
  </div>
</aside>
