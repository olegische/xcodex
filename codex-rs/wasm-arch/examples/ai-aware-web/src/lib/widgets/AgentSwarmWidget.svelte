<script lang="ts">
  import type { WorkspaceFileSummary } from "../../types";
  import { readManifestExcerpt, readSwarmDocument } from "../../aiAware/workspace";

  export let title = "Agent Swarm";
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  $: swarm = readSwarmDocument(workspaceFiles);
  $: manifestExcerpt = readManifestExcerpt(workspaceFiles);
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">{swarm.mission.operatingMode}</div>
    </div>
    <div class="pill-row">
      <span class="chip">multi-lane</span>
      <span class="chip ghost">artifact-first</span>
    </div>
  </div>

  <div class="mission-card">
    <strong>{swarm.mission.objective}</strong>
    <p>{swarm.mission.promise}</p>
    <div class="card-footnote">{manifestExcerpt}</div>
  </div>

  <div class="swarm-grid">
    {#each swarm.agents as agent}
      <article class="lane-card">
        <div class="card-topline">
          <strong>{agent.name}</strong>
          <span class:warning={agent.status !== "running" && agent.status !== "ready"} class="status-tag">{agent.status}</span>
        </div>
        <div class="card-subtitle">{agent.role}</div>
        <p class="card-copy">{agent.focus}</p>
        <div class="pill-row">
          <span class="chip">{agent.route}</span>
          <span class="chip ghost">{agent.artifact}</span>
        </div>
      </article>
    {/each}
  </div>

  <div class="handoff-list">
    {#each swarm.handoffs as handoff}
      <div class="handoff-line">{handoff}</div>
    {/each}
  </div>
</section>
