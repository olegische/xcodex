<script lang="ts">
  import type { WorkspaceFileSummary } from "../../types";
  import { readWebSignalSites } from "../../aiAware/workspace";

  export let title = "Web Signals";
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  $: sites = readWebSignalSites(workspaceFiles);
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">AI-readable surface scoring</div>
    </div>
    <div class="pill-row">
      <span class="chip">llms.txt</span>
      <span class="chip ghost">schema.org</span>
    </div>
  </div>

  <div class="card-grid">
    {#each sites as site}
      <article class="signal-card">
        <div class="card-topline">
          <strong>{site.domain}</strong>
          <span class="score-pill">{site.trustScore}</span>
        </div>
        <div class="card-subtitle">{site.intent}</div>
        <div class="pill-row">
          <span class:ghost={!site.llmsTxt} class="chip">{site.llmsTxt ? "llms.txt live" : "llms.txt missing"}</span>
          <span class="chip ghost">schema {site.schemaCoverage}</span>
          <span class="chip ghost">{site.freshness}</span>
        </div>
        <div class="pill-row">
          {#each site.notes as note}
            <span class="chip ghost">{note}</span>
          {/each}
        </div>
      </article>
    {/each}
  </div>
</section>
