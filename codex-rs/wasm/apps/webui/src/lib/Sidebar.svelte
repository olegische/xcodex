<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { RuntimeStatusSummary, ThreadGroupSummary } from "../types";
  import type { ShellActionId, ShellActionSpec } from "../ui/types";

  const dispatch = createEventDispatcher<{
    action: ShellActionId;
    selectthread: string;
  }>();

  export let threadGroups: ThreadGroupSummary[] = [];
  export let routerStatus: RuntimeStatusSummary;
  export let codexStatus: RuntimeStatusSummary;
  export let primaryAction: ShellActionSpec;
  export let footerActions: ShellActionSpec[] = [];

  function triggerAction(id: ShellActionId) {
    dispatch("action", id);
  }

  $: visibleFooterActions = footerActions.filter(
    (action) => action.id !== "workspace" && action.id !== "settings" && action.id !== "status",
  );
</script>

<aside class="sidebar">
  <div class="sidebar-brand">
    <div>
      <div class="sidebar-title">WASM Codex</div>
    </div>
  </div>

  <button class="sidebar-new-chat" on:click={() => triggerAction(primaryAction.id)}>New Chat</button>

  <div class="sidebar-group">
    <div class="thread-list">
      {#each threadGroups as group}
        <div class="sidebar-group-title">{group.title}</div>
        {#each group.threads as thread}
          <button class:active={thread.active} class="thread-card" on:click={() => dispatch("selectthread", thread.id)}>
            <span class="thread-title">{thread.title}</span>
            <span class="thread-subtitle">{thread.subtitle}</span>
          </button>
        {/each}
      {/each}
    </div>
  </div>

  <div class="sidebar-group runtime-group">
    <div class="runtime-group-header">
      <div class="sidebar-group-title">Runtime</div>
      <button class="runtime-settings-button" on:click={() => triggerAction("settings")}>Settings</button>
    </div>
    <div class="runtime-status-list">
      <div class="runtime-status-row">
        <span class="runtime-status-label">{routerStatus.label}</span>
        <div class:success={routerStatus.tone === "success"} class:warning={routerStatus.tone === "warning"} class="runtime-badge">
          <span class="runtime-badge-dot"></span>
          <span>{routerStatus.value}</span>
        </div>
      </div>
      <div class="runtime-status-row">
        <span class="runtime-status-label">{codexStatus.label}</span>
        <div class:success={codexStatus.tone === "success"} class:warning={codexStatus.tone === "warning"} class="runtime-badge">
          <span class="runtime-badge-dot"></span>
          <span>{codexStatus.value}</span>
        </div>
      </div>
    </div>
  </div>

  {#if visibleFooterActions.length > 0}
    <div class="sidebar-footer">
      <div class="sidebar-group-title">Ops</div>
      {#each visibleFooterActions as action (action.id)}
        <button class="sidebar-link" on:click={() => triggerAction(action.id)}>{action.label}</button>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
    min-height: 0;
    padding: 1rem 0.875rem;
    background: #252525;
    color: #f2f2f2;
  }

  .sidebar-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
  }

  .sidebar-title {
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .sidebar-new-chat {
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    font: inherit;
    font-weight: 700;
    padding: 0.85rem 1rem;
    cursor: pointer;
  }

  .sidebar-group {
    min-height: 0;
  }

  .thread-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-height: 0;
    overflow: auto;
    padding-right: 0.125rem;
  }

  .sidebar-group-title {
    margin: 0.6rem 0 0.2rem;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .thread-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.28rem;
    width: 100%;
    min-width: 0;
    padding: 0.7rem 0.75rem;
    border: 0;
    border-radius: 0.9rem;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .thread-card:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .thread-card.active {
    background: rgba(255, 255, 255, 0.1);
  }

  .thread-title,
  .thread-subtitle {
    display: -webkit-box;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
    -webkit-box-orient: vertical;
  }

  .thread-title {
    color: #f4f4f4;
    font-size: 0.95rem;
    font-weight: 650;
    line-height: 1.2;
    -webkit-line-clamp: 1;
  }

  .thread-subtitle {
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.88rem;
    line-height: 1.25;
    -webkit-line-clamp: 2;
  }

  .runtime-group {
    margin-top: auto;
  }

  .runtime-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .runtime-settings-button,
  .sidebar-link {
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font: inherit;
    cursor: pointer;
    padding: 0;
  }

  .runtime-status-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.55rem;
  }

  .runtime-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .runtime-status-label {
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.84rem;
  }

  .runtime-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: 999px;
    padding: 0.3rem 0.55rem;
    background: rgba(255, 255, 255, 0.08);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .runtime-badge.success {
    color: #c4ffd5;
  }

  .runtime-badge.warning {
    color: #ffe0a6;
  }

  .runtime-badge-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.9;
  }

  .sidebar-footer {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
</style>
