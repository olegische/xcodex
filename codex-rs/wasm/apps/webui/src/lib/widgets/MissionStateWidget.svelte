<script lang="ts">
  import { apsixZoneStore } from "../../stores/apsix-zone";

  export let title = "Zone";

  $: apsix = $apsixZoneStore;
  $: zone = apsix.zone;

  function prettyTime(value: number | null) {
    if (value === null) {
      return "now";
    }
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">{zone.summary}</div>
    </div>
    <div class="pill-row">
      <span class:warning={zone.lifecycleState === "blocked" || zone.lifecycleState === "failed"} class="status-tag">
        {zone.lifecycleState}
      </span>
      <span class="chip ghost">{zone.phase}</span>
      <span class="chip ghost">{prettyTime(zone.updatedAt)}</span>
    </div>
  </div>

  <article class="mission-card">
    <strong>{zone.zoneId ?? "No active zone"}</strong>
    <p>{zone.target?.value ?? "A zone will only be created after the request proves to be a bounded browser task."}</p>
    {#if zone.target && zone.target.normalizedValue !== zone.target.value}
      <div class="card-footnote">normalized: {zone.target.normalizedValue}</div>
    {/if}
    <div class="pill-row">
      <span class="chip ghost">{zone.target?.validation ?? "no target"}</span>
      <span class="chip ghost">{zone.target?.admissionDecision ?? "no admission"}</span>
      <span class="chip ghost">{zone.target?.citations.length ?? 0} target citations</span>
      <span class="chip ghost">{zone.artifactIds.length} artifacts</span>
    </div>
  </article>

  <div class="handoff-list">
    <article class="lane-card">
      <div class="card-topline">
        <strong>Admit</strong>
        <span
          class:warning={zone.target?.admissionDecision === "deny" || zone.lifecycleState === "rejected"}
          class="status-tag"
        >
          {zone.target?.admissionDecision ?? (zone.lifecycleState === "admitting" ? "pending" : "idle")}
        </span>
      </div>
      <p class="card-copy">
        {zone.target?.reasonCode ??
          "Admit has not evaluated the target yet. Zone creation waits for capability, boundary, and resource checks."}
      </p>
    </article>

    <article class="lane-card">
      <div class="card-topline">
        <strong>Spawn</strong>
        <span class:warning={zone.spawnDecision === "deny"} class="status-tag">{zone.spawnDecision ?? "idle"}</span>
      </div>
      <p class="card-copy">
        {zone.spawnReasonCode ?? "Spawn is deferred until the request is admitted as a browser task."}
      </p>
      <div class="card-footnote">
        budget: {zone.spawnBudgetUsed}/{zone.spawnBudgetTotal} · policy: {zone.spawnPolicyVersion ?? "unset"}
      </div>
    </article>

    <article class="lane-card">
      <div class="card-topline">
        <strong>Environment</strong>
        <span class:warning={zone.environmentStatus === "violated"} class="status-tag">{zone.environmentStatus}</span>
      </div>
      <p class="card-copy">{zone.environmentSummary}</p>
      <div class="card-footnote">
        protected: {zone.environmentProtectedRefs.length} · mutable: {zone.environmentMutableRefs.length}
      </div>
    </article>

    <article class="lane-card">
      <div class="card-topline">
        <strong>Authority</strong>
        <span class="status-tag">{zone.authoritativeStateRef ? "set" : "unset"}</span>
      </div>
      <p class="card-copy">{zone.authoritativeStateRef ?? "No anchored artifact is authoritative yet."}</p>
    </article>

    {#if zone.blockers.length > 0}
      {#each zone.blockers as blocker}
        <article class="lane-card">
          <div class="card-topline">
            <strong>Blocker</strong>
            <span class="status-tag warning">attention</span>
          </div>
          <p class="card-copy">{blocker}</p>
        </article>
      {/each}
    {/if}
  </div>
</section>
