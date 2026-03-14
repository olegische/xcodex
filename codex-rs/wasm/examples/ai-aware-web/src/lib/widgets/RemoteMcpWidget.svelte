<script lang="ts">
  import { readManifestExcerpt, readRemoteMcpServers } from "../../aiAware/workspace";
  import { remoteMcpStore } from "../../stores/remote-mcp";
  import type { WorkspaceFileSummary } from "../../types";

  export let title = "Remote MCP";
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  $: manifestExcerpt = readManifestExcerpt(workspaceFiles);
  $: seededServers = readRemoteMcpServers(workspaceFiles);
  $: seededById = new Map(seededServers.map((server) => [server.id, server]));
  $: storeState = $remoteMcpStore;
  $: servers = storeState.servers.map((server) => {
    const seeded = seededById.get(server.serverName);
    return {
      id: server.serverName,
      name: seeded?.name ?? prettifyServerName(server.serverName),
      url: server.serverUrl,
      status: server.authStatus,
      authMode: "oauth",
      login: server.authStatus === "connected" ? "authenticated" : "required",
      latencyMs: seeded?.latencyMs ?? 0,
      scopes: server.scopes,
      tools: server.tools.map((tool) => tool.originalName),
      description:
        seeded?.description ?? `Remote MCP capability lane for ${prettifyServerName(server.serverName)}.`,
      expiresAt: server.expiresAt,
      lastError: server.lastError,
      clientId: server.clientId,
    };
  });
  $: connectedCount = servers.filter((server) => server.status === "connected").length;

  function prettifyServerName(serverName: string) {
    return serverName
      .split(/[_-]+/)
      .filter((segment) => segment.length > 0)
      .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
      .join(" ");
  }

  function formatExpiry(expiresAt: number | null | undefined) {
    if (expiresAt === null || expiresAt === undefined) {
      return "session";
    }
    return new Date(expiresAt * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function isBusy(serverId: string) {
    return storeState.actionServer === serverId;
  }
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">{connectedCount}/{servers.length} bridges online</div>
    </div>
    <div class="pill-row">
      <span class="chip">remote-first</span>
      <span class="chip ghost">oauth tab</span>
      <button class="button ghost mcp-action-button" disabled={storeState.loading} on:click={() => void remoteMcpStore.refresh()}>
        Sync
      </button>
    </div>
  </div>

  <p class="card-copy">{manifestExcerpt}</p>

  {#if storeState.error !== null}
    <article class="signal-card mcp-error-card">
      <div class="card-topline">
        <strong>Remote MCP error</strong>
        <span class="status-tag warning">attention</span>
      </div>
      <p class="card-copy">{storeState.error}</p>
    </article>
  {/if}

  <div class="card-grid">
    {#each servers as server}
      <article class="signal-card">
        <div class="card-topline">
          <strong>{server.name}</strong>
          <span class:warning={server.status !== "connected"} class="status-tag">{server.status}</span>
        </div>
        <div class="card-subtitle">{server.url}</div>
        <p class="card-copy">{server.description}</p>
        <div class="pill-row">
          <span class="chip">{server.authMode}</span>
          <span class="chip ghost">{server.login}</span>
          <span class="chip ghost">{server.tools.length} tools</span>
          <span class="chip ghost">exp {formatExpiry(server.expiresAt)}</span>
        </div>
        {#if server.scopes.length > 0}
          <div class="pill-row">
            {#each server.scopes as scope}
              <span class="chip ghost">{scope}</span>
            {/each}
          </div>
        {/if}
        <div class="card-footnote">
          {#if server.tools.length > 0}
            {server.tools.join(" · ")}
          {:else}
            No tools cached yet. Run sync after login.
          {/if}
        </div>
        {#if server.lastError}
          <div class="mcp-inline-error">{server.lastError}</div>
        {/if}
        <div class="pill-row">
          {#if server.status !== "connected"}
            <button class="button primary mcp-action-button" disabled={isBusy(server.id)} on:click={() => void remoteMcpStore.connect(server.id)}>
              {isBusy(server.id) ? "Authorizing..." : "Connect"}
            </button>
          {:else}
            <button class="button secondary mcp-action-button" disabled={isBusy(server.id)} on:click={() => void remoteMcpStore.refreshServer(server.id)}>
              {isBusy(server.id) ? "Refreshing..." : "Refresh tools"}
            </button>
            <button class="button ghost mcp-action-button" disabled={isBusy(server.id)} on:click={() => void remoteMcpStore.disconnect(server.id)}>
              Disconnect
            </button>
          {/if}
          {#if server.clientId}
            <span class="chip ghost">client {server.clientId}</span>
          {/if}
        </div>
      </article>
    {/each}
  </div>
</section>
