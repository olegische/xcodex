<script lang="ts">
  import { missionControlStore } from "../../stores/mission-control";

  export let title = "Mission";

  $: mission = $missionControlStore;

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
      <div class="widget-lead">{mission.summary}</div>
    </div>
    <div class="pill-row">
      <span class:warning={mission.phase === "blocked" || mission.phase === "failed"} class="status-tag">{mission.phase}</span>
      <span class="chip ghost">{mission.lane}</span>
      <span class="chip ghost">{prettyTime(mission.updatedAt)}</span>
    </div>
  </div>

  <article class="mission-card">
    <strong>{mission.goal}</strong>
    {#if mission.blockers.length > 0}
      <div class="pill-row">
        {#each mission.blockers as blocker}
          <span class="chip ghost">{blocker}</span>
        {/each}
      </div>
    {/if}
  </article>

  <div class="handoff-list">
    {#each mission.steps as step}
      <article class="lane-card">
        <div class="card-topline">
          <strong>{step.title}</strong>
          <span class:warning={step.status === "blocked"} class="status-tag">{step.status}</span>
        </div>
        <p class="card-copy">{step.detail}</p>
      </article>
    {/each}
  </div>
</section>
