<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { RuntimeStatusSummary, ThreadSummary } from "../types";
  import { remoteMcpStore } from "../stores/remote-mcp";
  import { runtimeUiStore } from "../stores/runtime-ui";
  import type { RuntimeActivity } from "../runtime";
  import type { InspectorTab, ShellActionId, ShellActionSpec } from "../ui/types";

  const dispatch = createEventDispatcher<{
    action: ShellActionId;
    selectthread: string;
  }>();

  export let threads: ThreadSummary[] = [];
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
  $: remoteMcpState = $remoteMcpStore;
  $: runtimeUiState = $runtimeUiStore;
  $: remoteMcpActivity = deriveRemoteMcpActivity(remoteMcpState.servers.map((server) => server.serverName), runtimeUiState.activities);
  $: remoteMcpRows = remoteMcpState.servers.map((server) => {
    const activity = remoteMcpActivity.get(server.serverName) ?? "idle";
    if (activity === "calling") {
      return {
        label: server.serverName,
        value: "Calling",
        tone: "running" as const,
      };
    }
    if (activity === "done") {
      return {
        label: server.serverName,
        value: "Done",
        tone: "success" as const,
      };
    }
    if (activity === "failed") {
      return {
        label: server.serverName,
        value: "Failed",
        tone: "warning" as const,
      };
    }
    return {
      label: server.serverName,
      value:
        server.authStatus === "connected"
          ? "Connected"
          : server.authStatus === "authorizing"
            ? "Authorizing"
            : server.authStatus === "error"
              ? "Error"
              : "Login required",
      tone:
        server.authStatus === "connected"
          ? "success"
          : server.authStatus === "authorizing" || server.authStatus === "error"
            ? "warning"
            : "default",
    };
  });

  function deriveRemoteMcpActivity(serverNames: string[], activities: RuntimeActivity[]) {
    const states = new Map<string, "idle" | "calling" | "done" | "failed">();
    const activeCalls = new Map<string, string>();
    const knownServers = new Set(serverNames);
    const recentActivities = activitiesSinceLastTurnStart(activities);

    for (const activity of recentActivities) {
      if (activity.type === "toolCall") {
        const serverName = resolveMcpServerName(activity.toolName, knownServers);
        if (serverName === null) {
          continue;
        }
        states.set(serverName, "calling");
        if (typeof activity.callId === "string" && activity.callId.length > 0) {
          activeCalls.set(activity.callId, serverName);
        }
        continue;
      }
      if (activity.type === "toolOutput") {
        if (typeof activity.callId !== "string" || activity.callId.length === 0) {
          continue;
        }
        const serverName = activeCalls.get(activity.callId);
        if (serverName === undefined) {
          continue;
        }
        states.set(serverName, "done");
        activeCalls.delete(activity.callId);
        continue;
      }
      if (activity.type === "error") {
        for (const serverName of activeCalls.values()) {
          states.set(serverName, "failed");
        }
        activeCalls.clear();
      }
    }

    return states;
  }

  function activitiesSinceLastTurnStart(activities: RuntimeActivity[]) {
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      if (activities[index]?.type === "turnStart") {
        return activities.slice(index);
      }
    }
    return activities;
  }

  function resolveMcpServerName(toolName: string | null, knownServers: Set<string>): string | null {
    if (typeof toolName !== "string" || toolName.length === 0) {
      return null;
    }
    for (const serverName of knownServers) {
      if (
        toolName.startsWith(`mcp__${serverName}__`) ||
        toolName.startsWith(`mcp__mcp__${serverName}__`) ||
        toolName.startsWith(`${serverName}.`)
      ) {
        return serverName;
      }
    }
    return null;
  }
</script>

<aside class="sidebar">
  <div class="sidebar-brand">
    <div>
      <div class="sidebar-title">AI-Aware Web</div>
      <div class="sidebar-caption">browser agent runtime</div>
    </div>
  </div>

  <button class="sidebar-new-chat" on:click={() => triggerAction(primaryAction.id)}>{primaryAction.label}</button>

  <div class="sidebar-group">
    <div class="sidebar-group-title">Missions</div>
    <div class="thread-list">
      {#each threads as thread}
        <button class:active={thread.active} class="thread-card" on:click={() => dispatch("selectthread", thread.id)}>
          <span class="thread-title">{thread.title}</span>
        </button>
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
      {#if remoteMcpState.loading && remoteMcpRows.length === 0}
        <div class="sidebar-status">Loading bridges…</div>
      {:else if remoteMcpState.error !== null && remoteMcpRows.length === 0}
        <div class="sidebar-status runtime-status-error">{remoteMcpState.error}</div>
      {:else if remoteMcpRows.length === 0}
        <div class="sidebar-status">No MCP servers configured.</div>
      {:else}
        {#each remoteMcpRows as server}
          <div class="runtime-status-row">
            <span class="runtime-status-label runtime-status-server">{server.label}</span>
            <div
              class:success={server.tone === "success"}
              class:warning={server.tone === "warning"}
              class:running={server.tone === "running"}
              class="runtime-badge"
            >
              <span class="runtime-badge-dot"></span>
              <span>{server.value}</span>
            </div>
          </div>
        {/each}
      {/if}
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
