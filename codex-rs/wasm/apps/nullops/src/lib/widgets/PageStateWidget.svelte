<script lang="ts">
  import { pageRuntimeStore } from "../../stores/page-runtime";

  export let title = "Page";

  $: pageRuntime = $pageRuntimeStore;
  $: snapshot = pageRuntime.snapshot;
  $: recentEvents = pageRuntime.events.slice(-4).reverse();
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">{snapshot.title}</div>
    </div>
    <div class="pill-row">
      <span class="chip">{snapshot.capabilityMode}</span>
      <span class="chip ghost">{snapshot.readyState}</span>
      <span class="chip ghost">{snapshot.interactives.length} surfaces</span>
    </div>
  </div>

  <article class="mission-card">
    <strong>{snapshot.url}</strong>
    {#if snapshot.selectionText}
      <p>{snapshot.selectionText}</p>
    {:else}
      <p>No current selection. Use browser tools to inspect or act on the page.</p>
    {/if}
  </article>

  <div class="swarm-grid">
    {#each snapshot.interactives.slice(0, 8) as surface}
      <article class="lane-card">
        <div class="card-topline">
          <strong>{surface.label}</strong>
          <span class="chip ghost">{surface.tagName}</span>
        </div>
        <div class="card-footnote">{surface.selector}</div>
      </article>
    {/each}
  </div>

  <div class="handoff-list">
    {#each recentEvents as event}
      <div class="handoff-line">
        [{event.kind}] {event.summary}{#if event.target} -> {event.target}{/if}
      </div>
    {/each}
  </div>
</section>
