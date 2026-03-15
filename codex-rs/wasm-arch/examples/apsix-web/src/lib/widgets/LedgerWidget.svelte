<script lang="ts">
  import { readApsixEventLog } from "../../apsix/workspace";
  import type { ApsixLedgerEventSummary, WorkspaceFileSummary } from "../../types";

  export let title = "Ledger";
  export let workspaceFiles: WorkspaceFileSummary[] = [];

  type LedgerRelation = {
    label: string;
    value: string;
  };

  type LedgerEventView = {
    event: ApsixLedgerEventSummary;
    lane: "actor" | "artifact" | "decision" | "lifecycle" | "system";
    laneLabel: string;
    typeLabel: string;
    relations: LedgerRelation[];
  };

  $: events = readApsixEventLog(workspaceFiles)
    .slice()
    .reverse()
    .map((event) => toLedgerEventView(event));

  function toLedgerEventView(event: ApsixLedgerEventSummary): LedgerEventView {
    const lane = classifyLane(event);
    const subjectLabel = event.subjectKind;
    const relations: LedgerRelation[] = [];

    if (!(subjectLabel === "subject" && event.subjectRef === event.zoneId)) {
      relations.push({
        label: subjectLabel,
        value: event.subjectRef,
      });
    }
    if (event.requestId !== null) {
      relations.push({
        label: event.requestKind === "spawn" ? "spawn request" : event.requestKind === "anchor" ? "anchor request" : "request",
        value: event.requestId,
      });
    }
    if (event.runId !== null) {
      relations.push({
        label: "run",
        value: event.runId,
      });
    }
    if (event.decision !== null) {
      relations.push({
        label: "decision",
        value: event.decision,
      });
    }
    if (event.reasonCode !== null) {
      relations.push({
        label: "reason",
        value: event.reasonCode,
      });
    }
    if (shouldShowZone(event) && !(event.subjectKind === "zone" && event.subjectRef === event.zoneId)) {
      relations.push({
        label: "zone",
        value: event.zoneId,
      });
    }
    return {
      event,
      lane,
      laneLabel: lane.toUpperCase(),
      typeLabel: event.type.replaceAll("_", " ").toUpperCase(),
      relations,
    };
  }

  function classifyLane(event: ApsixLedgerEventSummary): LedgerEventView["lane"] {
    if (
      event.type === "admit_decision" ||
      event.type === "execution_verified" ||
      event.type === "anchor_decision" ||
      event.type === "spawn_decision"
    ) {
      return "decision";
    }
    if (event.type === "artifact_generated") {
      return "artifact";
    }
    if (event.type === "actor_started") {
      return "actor";
    }
    if (
      event.type === "zone_created" ||
      event.type === "zone_frozen" ||
      event.type === "zone_failed" ||
      event.type === "zone_blocked" ||
      event.type === "admit_started" ||
      event.type === "spawn_requested" ||
      event.type === "environment_prepared"
    ) {
      return "lifecycle";
    }
    if (event.type === "execution_started" || event.type === "execution_completed") {
      return "actor";
    }
    return "system";
  }

  function shouldShowZone(event: ApsixLedgerEventSummary): boolean {
    return (
      event.type === "zone_created" ||
      event.type === "zone_failed" ||
      event.type === "zone_blocked" ||
      event.type === "admit_decision"
    );
  }

</script>

<section class="widget-panel inspector-section">
  <div class="widget-header">
    <div>
      <div class="eyebrow">{title}</div>
      <div class="widget-lead">Authoritative APSIX trace</div>
    </div>
    <div class="pill-row">
      <span class="chip">{events.length} records</span>
    </div>
  </div>

  <div class="drawer-content ledger-trace">
    {#if events.length === 0}
      <p class="drawer-empty">No ledger records yet.</p>
    {/if}

    {#each events as item}
      <article class={`ledger-event ledger-event-${item.lane}`}>
        <div class="ledger-event-rail">
          <span class="ledger-event-dot" aria-hidden="true"></span>
        </div>
        <div class="ledger-event-body">
          <header class="ledger-event-header">
            <div class="ledger-event-heading">
              <span class="ledger-event-seq">#{item.event.seqNo}</span>
              <strong class="ledger-event-type">{item.typeLabel}</strong>
            </div>
            <span class={`ledger-event-kind ledger-event-kind-${item.lane}`}>{item.laneLabel}</span>
          </header>

          <p class="ledger-event-summary">{item.event.summary}</p>

          <dl class="ledger-event-facts">
            {#each item.relations as relation}
              <div class="ledger-event-fact">
                <dt>{relation.label}</dt>
                <dd>{relation.value}</dd>
              </div>
            {/each}
          </dl>
        </div>
      </article>
    {/each}
  </div>
</section>
