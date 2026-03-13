<script lang="ts">
  import { afterUpdate, onMount } from "svelte";
  import Transcript from "../Transcript.svelte";
  import type { RuntimeActivity, TranscriptEntry } from "../../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  export let runtimeActivities: RuntimeActivity[] = [];
  export let flat = false;

  const BOTTOM_THRESHOLD = 48;

  let scrollContainer: HTMLDivElement | null = null;
  let showScrollToBottom = false;

  function updateScrollState(): void {
    if (!scrollContainer) {
      showScrollToBottom = false;
      return;
    }

    const distanceToBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    showScrollToBottom =
      scrollContainer.scrollHeight > scrollContainer.clientHeight &&
      distanceToBottom > BOTTOM_THRESHOLD;
  }

  function scrollTranscriptToBottom(): void {
    if (!scrollContainer) {
      return;
    }
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: "smooth",
    });
  }

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

  onMount(() => {
    updateScrollState();

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });

    if (scrollContainer) {
      resizeObserver.observe(scrollContainer);
    }

    return () => {
      resizeObserver.disconnect();
    };
  });

  afterUpdate(() => {
    updateScrollState();
  });
</script>

<section class:transcript-flat={flat} class="transcript-widget-shell widget-surface">
  <div bind:this={scrollContainer} class="transcript-scroll" on:scroll={updateScrollState}>
    <Transcript {transcript} toolEntries={liveToolTranscript} {liveStreamText} {status} {running} />
  </div>

  {#if showScrollToBottom}
    <button
      type="button"
      class="transcript-scroll-to-bottom"
      aria-label="Scroll transcript to bottom"
      on:click={scrollTranscriptToBottom}
    >
      ↓
    </button>
  {/if}
</section>
