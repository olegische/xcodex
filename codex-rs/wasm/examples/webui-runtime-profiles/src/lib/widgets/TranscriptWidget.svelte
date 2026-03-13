<script lang="ts">
  import Transcript from "../Transcript.svelte";
  import type { RuntimeActivity, TranscriptEntry } from "../../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  export let runtimeActivities: RuntimeActivity[] = [];
  export let flat = false;

  function currentTurnActivities(activities: RuntimeActivity[]): RuntimeActivity[] {
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      if (activities[index]?.type === "turnStart") {
        return activities.slice(index);
      }
    }
    return activities;
  }

  function formatToolOutput(output: unknown): string {
    if (typeof output === "string") {
      return output;
    }
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }

  function liveToolEntries(activities: RuntimeActivity[]): TranscriptEntry[] {
    return currentTurnActivities(activities).flatMap((activity) => {
      if (activity.type === "toolCall") {
        return [
          {
            role: "tool" as const,
            text: `Using ${activity.toolName ?? "tool"}`,
          },
        ];
      }
      if (activity.type === "toolOutput") {
        return [
          {
            role: "tool" as const,
            text: formatToolOutput(activity.output),
          },
        ];
      }
      return [];
    });
  }

  $: liveToolTranscript = liveToolEntries(runtimeActivities);

</script>

<section class:transcript-flat={flat} class="transcript-widget-shell widget-surface">
  <div class="transcript-scroll">
    <Transcript {transcript} toolEntries={liveToolTranscript} {liveStreamText} {status} {running} />
  </div>
</section>
