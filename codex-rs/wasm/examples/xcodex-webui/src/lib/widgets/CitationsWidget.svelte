<script lang="ts">
  import type {
    ApsixArtifactSummary,
    ApsixAnchorSummary,
    ApsixCitationSourceSummary,
    WorkspaceFileSummary,
  } from "../../types";
  import {
    readApsixAnchors,
    readApsixArtifacts,
    readApsixSources,
    readApsixZoneState,
  } from "../../apsix/workspace";

  export let title = "Citations";
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  let selectedArtifactId = "";

  $: zone = readApsixZoneState(workspaceFiles);
  $: artifacts = readApsixArtifacts(workspaceFiles).slice().reverse();
  $: anchors = readApsixAnchors(workspaceFiles);
  $: sources = readApsixSources(workspaceFiles);
  $: sourceByKey = new Map(sources.map((source) => [source.citationKey, source]));
  $: artifactIds = new Set(artifacts.map((artifact) => artifact.artifactId));
  $: if (!artifactIds.has(selectedArtifactId)) {
    selectedArtifactId = artifacts[0]?.artifactId ?? "";
  }
  $: selectedArtifact = artifacts.find((artifact) => artifact.artifactId === selectedArtifactId) ?? null;
  $: selectedAnchor =
    selectedArtifact === null ? null : anchors.find((anchor) => anchor.artifactId === selectedArtifact.artifactId) ?? null;
  $: citedSources =
    selectedArtifact === null
      ? []
      : selectedArtifact.citations.flatMap((reference) =>
          sources.filter((source) => sourceMatchesReference(source, reference)),
        );
  $: admissionSourceKeys = new Set(
    (zone.target?.citations ?? []).flatMap((reference) =>
      sources
        .filter((source) => sourceMatchesReference(source, reference))
        .map((source) => source.citationKey),
    ),
  );
  $: admissionSources = sources.filter((source) => admissionSourceKeys.has(source.citationKey));

  function artifactLabel(artifact: ApsixArtifactSummary): string {
    return `${artifact.artifactType} ${artifact.artifactId}`;
  }

  function anchorTone(anchor: ApsixAnchorSummary | null): string {
    if (anchor === null) {
      return "pending";
    }
    return anchor.decision === "allow" ? "verified" : "missing";
  }

  function formatTime(value: number | null): string {
    if (value === null) {
      return "not recorded";
    }
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function sourceMatchesReference(source: ApsixCitationSourceSummary, reference: string): boolean {
    if (source.citationKey === reference) {
      return true;
    }
    if (source.locator === reference || source.sourceRef === reference) {
      return true;
    }
    if (reference.startsWith("tool:")) {
      const locator = reference.slice(5);
      return source.locator === locator || source.sourceRef === locator;
    }
    if (reference.startsWith("input:")) {
      return source.kind === "user_input" && source.requestId === reference.slice(6);
    }
    if (reference.startsWith("event:")) {
      return source.kind === "runtime_event" && source.sourceRef === reference.slice(6);
    }
    return false;
  }
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">Artifact provenance, cited sources, and anchor verification.</div>
    </div>
    <div class="pill-row">
      <span class="chip">{artifacts.length} artifacts</span>
      <span class="chip ghost">{sources.length} sources</span>
      <span class="chip ghost">{anchors.length} anchors</span>
    </div>
  </div>

  <div class="drawer-content">
    {#if artifacts.length === 0}
      {#if zone.target !== null}
        <div class="citation-detail">
          <article class="lane-card citation-detail-card">
            <div class="card-topline">
              <strong>Admission</strong>
              <span class={`status-tag ${zone.target.admissionDecision === "deny" ? "missing" : "pending"}`}>
                {zone.target.admissionDecision ?? "pending"}
              </span>
            </div>
            <div class="card-subtitle">{zone.summary}</div>
            <div class="citation-facts">
              <div class="citation-fact">
                <span>target</span>
                <strong>{zone.target.value}</strong>
              </div>
              <div class="citation-fact">
                <span>validation</span>
                <strong>{zone.target.validation}</strong>
              </div>
              <div class="citation-fact">
                <span>reason</span>
                <strong>{zone.target.reasonCode ?? "not recorded"}</strong>
              </div>
              <div class="citation-fact">
                <span>phase</span>
                <strong>{zone.phase}</strong>
              </div>
            </div>
          </article>

          <div class="citation-source-list">
            {#if admissionSources.length === 0}
              <div class="handoff-line">No admission evidence was recorded.</div>
            {/if}
            {#each admissionSources as source}
              <article class="event-card citation-source-card">
                <div class="event-type">{source.kind}</div>
                <strong class="citation-source-key">{source.citationKey}</strong>
                <div class="citation-source-meta">{source.sourceRef}{#if source.locator} · {source.locator}{/if}</div>
                <pre>{source.excerpt}</pre>
              </article>
            {/each}
          </div>
        </div>
      {:else}
        <p class="drawer-empty">No APSIX artifacts have been captured yet.</p>
      {/if}
    {:else}
      <div class="citation-browser">
        <div class="citation-artifact-list">
          {#each artifacts as artifact}
            {@const anchor = anchors.find((entry) => entry.artifactId === artifact.artifactId) ?? null}
            <button class:active={artifact.artifactId === selectedArtifactId} class="thread-card" on:click={() => (selectedArtifactId = artifact.artifactId)}>
              <span class="thread-title">{artifactLabel(artifact)}</span>
              <span class="thread-subtitle">{artifact.citations.length} citations · {anchor?.decision ?? artifact.status}</span>
            </button>
          {/each}
        </div>

        {#if selectedArtifact}
          <div class="citation-detail">
            <article class="lane-card citation-detail-card">
              <div class="card-topline">
                <strong>{artifactLabel(selectedArtifact)}</strong>
                <span class={`status-tag ${anchorTone(selectedAnchor)}`}>{selectedAnchor?.decision ?? selectedArtifact.status}</span>
              </div>
              <div class="card-subtitle">{selectedArtifact.summary}</div>
              <div class="citation-facts">
                <div class="citation-fact">
                  <span>path</span>
                  <strong>{selectedArtifact.path}</strong>
                </div>
                <div class="citation-fact">
                  <span>provenance</span>
                  <strong>{selectedArtifact.provenance.source}</strong>
                </div>
                <div class="citation-fact">
                  <span>request</span>
                  <strong>{selectedArtifact.provenance.requestId ?? "none"}</strong>
                </div>
                <div class="citation-fact">
                  <span>run</span>
                  <strong>{selectedArtifact.provenance.runId ?? "none"}</strong>
                </div>
                <div class="citation-fact">
                  <span>updated</span>
                  <strong>{formatTime(selectedArtifact.updatedAt)}</strong>
                </div>
              </div>
            </article>

            {#if selectedAnchor}
              <article class="lane-card citation-detail-card">
                <div class="card-topline">
                  <strong>Anchor</strong>
                  <span class={`status-tag ${anchorTone(selectedAnchor)}`}>{selectedAnchor.citationStatus}</span>
                </div>
                <div class="citation-facts">
                  <div class="citation-fact">
                    <span>policy</span>
                    <strong>{selectedAnchor.policyVersion}</strong>
                  </div>
                  <div class="citation-fact">
                    <span>decision</span>
                    <strong>{selectedAnchor.decision}</strong>
                  </div>
                  <div class="citation-fact">
                    <span>reason</span>
                    <strong>{selectedAnchor.reasonCode}</strong>
                  </div>
                  <div class="citation-fact">
                    <span>timestamp</span>
                    <strong>{formatTime(selectedAnchor.timestamp)}</strong>
                  </div>
                </div>
                {#if selectedAnchor.missingKeys.length > 0}
                  <div class="handoff-line">missing: {selectedAnchor.missingKeys.join(", ")}</div>
                {/if}
              </article>
            {/if}

            <div class="citation-source-list">
              {#if citedSources.length === 0}
                <div class="handoff-line">No cited sources were attached to this artifact.</div>
              {/if}
              {#each citedSources as source}
                <article class="event-card citation-source-card">
                  <div class="event-type">{source.kind}</div>
                  <strong class="citation-source-key">{source.citationKey}</strong>
                  <div class="citation-source-meta">{source.sourceRef}{#if source.locator} · {source.locator}{/if}</div>
                  <pre>{source.excerpt}</pre>
                </article>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>
