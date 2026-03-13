<script lang="ts">
  import type { RuntimeActivity } from "../runtime";
  import type { PendingApproval } from "../types";
  import type { InspectorTab } from "../uiLayout";

  export let visible = false;
  export let activeTab: InspectorTab = "events";
  export let showMetrics = true;
  export let showEvents = true;
  export let showApprovals = true;
  export let runtimeActivities: RuntimeActivity[] = [];
  export let approvals: PendingApproval[] = [];
  export let metrics: Array<{ label: string; value: string }> = [];
</script>

{#if visible}
  <aside class="inspector-panel">
    {#if showMetrics}
      <section class="inspector-section">
        <div class="eyebrow">Metrics</div>
        <div class="metrics-grid">
          {#each metrics as metric}
            <div class="metric-card">
              <div class="event-type">{metric.label}</div>
              <strong>{metric.value}</strong>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if activeTab === "events" && showEvents}
      <section class="inspector-section">
        <div class="eyebrow">Runtime Events</div>
        <div class="drawer-content">
          {#if runtimeActivities.length === 0}
            <p class="drawer-empty">No runtime events yet.</p>
          {/if}

          {#each runtimeActivities.slice().reverse() as activity}
            <div class="event-card">
              <div class="event-type">{activity.type}</div>
              <pre>{JSON.stringify(activity, null, 2)}</pre>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if activeTab === "approvals" && showApprovals}
      <section class="inspector-section">
        <div class="eyebrow">Approvals</div>
        <div class="drawer-content">
          {#if approvals.length === 0}
            <p class="drawer-empty">No approval requests are waiting right now.</p>
          {/if}

          {#each approvals as approval}
            <div class="event-card">
              <div class="event-type">{approval.title}</div>
              <pre>{approval.detail}</pre>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </aside>
{/if}
