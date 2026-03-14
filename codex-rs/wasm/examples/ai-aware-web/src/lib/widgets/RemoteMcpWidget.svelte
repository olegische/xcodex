<script lang="ts">
  import { readRemoteMcpServers } from "../../aiAware/workspace";
  import { remoteMcpStore } from "../../stores/remote-mcp";
  import type { WorkspaceFileSummary } from "../../types";

  export let title = "Remote MCP";
  export let workspaceFiles: WorkspaceFileSummary[] = [];
  let serverUrl = "";

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
      latencyMs: seeded?.latencyMs ?? 0,
      scopes: server.scopes,
      tools: server.tools.map((tool) => tool.originalName),
      description:
        seeded?.description ?? `Remote MCP capability lane for ${prettifyServerName(server.serverName)}.`,
      expiresAt: server.expiresAt,
      lastError: server.lastError,
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
  function isBusy(serverId: string) {
    return storeState.actionServer === serverId;
  }

  function isAddingServer() {
    return storeState.actionServer === "__add__";
  }

  async function addServer() {
    const normalizedUrl = serverUrl.trim();
    if (normalizedUrl.length === 0) {
      return;
    }
    await remoteMcpStore.addServer(normalizedUrl);
    if ($remoteMcpStore.error === null) {
      serverUrl = "";
    }
  }

</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">{connectedCount}/{servers.length} bridges online</div>
    </div>
    <button class="button ghost mcp-action-button" disabled={storeState.loading} on:click={() => void remoteMcpStore.refresh()}>
      Sync
    </button>
  </div>

  <article class="signal-card">
    <div class="card-topline">
      <strong>Add remote MCP</strong>
    </div>
    <div class="card-subtitle">Paste an MCP server URL.</div>
    <div class="mcp-add-row">
      <input
        class="settings-input"
        type="text"
        bind:value={serverUrl}
        placeholder="https://your-mcp-server.example/mcp"
        autocomplete="new-password"
        name="remote-mcp-url"
        inputmode="url"
        autocapitalize="off"
        spellcheck={false}
      />
      <button class="button primary mcp-action-button" disabled={isAddingServer() || serverUrl.trim().length === 0} on:click={() => void addServer()}>
        {isAddingServer() ? "Adding..." : "Add"}
      </button>
    </div>
  </article>

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
    {#if servers.length === 0}
      <article class="signal-card">
        <div class="card-topline">
          <strong>No remote MCP servers</strong>
          <span class="status-tag warning">empty</span>
        </div>
        <p class="card-copy">Add a server URL to create a new remote MCP entry. Login is available after creation.</p>
      </article>
    {/if}
    {#each servers as server}
      <article class="signal-card">
        <div class="card-topline">
          <strong>{server.name}</strong>
          <span class:warning={server.status !== "connected"} class="status-tag">{server.status}</span>
        </div>
        <div class="card-subtitle">{server.url}</div>
        <details class="mcp-tools-disclosure">
          <summary class="mcp-tools-toggle">
            <span>{server.tools.length} tools</span>
            <span class="mcp-tools-caret" aria-hidden="true">▾</span>
          </summary>
          <div class="mcp-tools-list">
            {#if server.tools.length > 0}
              {#each server.tools as tool}
                <div class="mcp-tool-row">{tool}</div>
              {/each}
            {:else}
              <div class="card-footnote">No tools cached yet. Run sync after login.</div>
            {/if}
          </div>
        </details>
        {#if server.scopes.length > 0}
          <div class="pill-row">
            {#each server.scopes as scope}
              <span class="chip ghost">{scope}</span>
            {/each}
          </div>
        {/if}
        {#if server.lastError}
          <div class="mcp-inline-error">{server.lastError}</div>
        {/if}
        <div class="mcp-server-actions">
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
          <button class="button ghost mcp-action-button" disabled={isBusy(server.id)} on:click={() => void remoteMcpStore.removeServer(server.id)}>
            Remove
          </button>
        </div>
      </article>
    {/each}
  </div>
</section>
