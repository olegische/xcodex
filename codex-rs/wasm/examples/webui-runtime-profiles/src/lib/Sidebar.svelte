<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { RuntimeStatusSummary, ThreadSummary } from "../types";
  import type { ShellActionId, ShellActionSpec } from "../ui/types";

  const dispatch = createEventDispatcher<{
    action: ShellActionId;
    selectthread: string;
  }>();

  export let threads: ThreadSummary[] = [];
  export let providerSummary = "";
  export let currentModel = "";
  export let routerStatus: RuntimeStatusSummary;
  export let codexStatus: RuntimeStatusSummary;
  export let primaryAction: ShellActionSpec;
  export let footerActions: ShellActionSpec[] = [];

  function triggerAction(id: ShellActionId) {
    dispatch("action", id);
  }
</script>

<aside class="sidebar">
  <div class="sidebar-brand">
    <div>
      <div class="sidebar-title">XCodex</div>
      <div class="sidebar-caption">WebUI</div>
    </div>
  </div>

  <button class="sidebar-new-chat" on:click={() => triggerAction(primaryAction.id)}>{primaryAction.label}</button>

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
    </div>
    <div class="sidebar-meta">
      <span>{providerSummary || "Provider not configured"}</span>
      <strong>{currentModel || "No model selected"}</strong>
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

  <div class="sidebar-footer">
    {#each footerActions as action (action.id)}
      <button class="sidebar-link" on:click={() => triggerAction(action.id)}>{action.label}</button>
    {/each}
  </div>
</aside>
