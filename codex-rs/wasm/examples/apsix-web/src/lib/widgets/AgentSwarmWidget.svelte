<script lang="ts">
  import type { WorkspaceFileSummary } from "../../types";
  import {
    readApsixActors,
    readApsixAnchors,
    readApsixArtifacts,
    readApsixSources,
    readApsixZoneState,
    readManifestExcerpt,
  } from "../../apsix/workspace";

  export let title = "Actors";
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  $: zone = readApsixZoneState(workspaceFiles);
  $: actors = readApsixActors(workspaceFiles);
  $: artifacts = readApsixArtifacts(workspaceFiles);
  $: anchors = readApsixAnchors(workspaceFiles);
  $: sources = readApsixSources(workspaceFiles);
  $: manifestExcerpt = readManifestExcerpt(workspaceFiles);
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">{manifestExcerpt}</div>
    </div>
    <div class="pill-row">
      <span class="chip">{actors.length} actors</span>
      <span class="chip ghost">{artifacts.length} artifacts</span>
      <span class="chip ghost">{anchors.length} anchors</span>
      <span class="chip ghost">{sources.length} sources</span>
    </div>
  </div>

  <div class="mission-card">
    <strong>{zone.zoneId ?? "No active zone"}</strong>
    <p>{zone.target?.value ?? "Start a run to materialize a zone from the target."}</p>
    {#if zone.target}
      <div class="card-footnote">
        target: {zone.target.validation} / {zone.target.admissionDecision ?? "no admission"} / {zone.target.citations.length} citations
      </div>
    {/if}
    {#if zone.authoritativeStateRef}
      <div class="card-footnote">authoritative: {zone.authoritativeStateRef}</div>
    {/if}
  </div>

  <div class="swarm-grid">
    {#each actors as actor}
      <article class="lane-card">
        <div class="card-topline">
          <strong>{actor.actorId}</strong>
          <span class:warning={actor.status !== "running" && actor.status !== "completed"} class="status-tag">
            {actor.status}
          </span>
        </div>
        <div class="card-subtitle">{actor.intent}</div>
        <p class="card-copy">
          capabilities: {actor.capabilityMask.join(", ")}
        </p>
        <div class="pill-row">
          {#each actor.admittedPartitions as partition}
            <span class="chip ghost">{partition}</span>
          {/each}
        </div>
      </article>
    {/each}
  </div>

  <div class="handoff-list">
    {#if artifacts.length === 0}
      <div class="handoff-line">No anchored artifacts yet.</div>
    {/if}
    {#each artifacts.slice().reverse() as artifact}
      <div class="handoff-line">
        [{artifact.status}] {artifact.artifactType} {artifact.artifactId} -> {artifact.path} ({artifact.citations.length} citations)
      </div>
    {/each}
    {#each anchors.slice().reverse() as anchor}
      <div class="handoff-line">
        [{anchor.decision}] {anchor.anchorId} -> {anchor.citationStatus} ({anchor.citedKeys.length} cited / {anchor.missingKeys.length} missing)
      </div>
    {/each}
  </div>
</section>
