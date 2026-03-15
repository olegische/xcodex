<script lang="ts">
  import type { RuntimeActivity } from "../../runtime";

  export let title = "Tool Activity";
  export let toolActivities: RuntimeActivity[] = [];
  export let compact = false;

  type ToolCallGroup = {
    id: string;
    requestId: string;
    toolName: string;
    callId: string | null;
    argumentsText: string | null;
    outputs: string[];
  };

  $: groupedCalls = groupToolActivities(toolActivities).reverse();

  function groupToolActivities(activities: RuntimeActivity[]): ToolCallGroup[] {
    const groups = new Map<string, ToolCallGroup>();

    for (const activity of activities) {
      if (activity.type !== "toolCall" && activity.type !== "toolOutput") {
        continue;
      }

      const groupKey =
        activity.type === "toolCall"
          ? `${activity.requestId}:${activity.callId ?? activity.toolName ?? "tool"}`
          : `${activity.requestId}:${activity.callId ?? "output"}`;
      const existingGroup = groups.get(groupKey);
      if (activity.type === "toolCall") {
        groups.set(groupKey, {
          id: groupKey,
          requestId: activity.requestId,
          toolName: activity.toolName ?? "tool",
          callId: activity.callId,
          argumentsText: compact ? null : JSON.stringify(activity.arguments, null, 2),
          outputs: existingGroup?.outputs ?? [],
        });
        continue;
      }

      const outputText = compact ? JSON.stringify(activity.output) : JSON.stringify(activity.output, null, 2);
      if (existingGroup) {
        existingGroup.outputs = [...existingGroup.outputs, outputText];
        continue;
      }
      groups.set(groupKey, {
        id: groupKey,
        requestId: activity.requestId,
        toolName: "tool_output",
        callId: activity.callId,
        argumentsText: null,
        outputs: [outputText],
      });
    }

    return [...groups.values()];
  }
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class="drawer-content">
    {#if groupedCalls.length === 0}
      <p class="drawer-empty">No tool activity yet.</p>
    {/if}
    {#each groupedCalls as group}
      <div class="event-card">
        <div class="event-type">{group.toolName}</div>
        <pre>{group.callId ?? group.requestId}</pre>
        {#if group.argumentsText}
          <pre>{group.argumentsText}</pre>
        {/if}
        {#each group.outputs as output}
          <pre>{output}</pre>
        {/each}
      </div>
    {/each}
  </div>
</section>
