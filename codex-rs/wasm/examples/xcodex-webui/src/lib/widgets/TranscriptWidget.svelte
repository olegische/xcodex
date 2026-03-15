<script lang="ts">
  import { afterUpdate, onMount } from "svelte";
  import Transcript from "../Transcript.svelte";
  import type { TranscriptEntry } from "../../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  export let flat = false;

  const BOTTOM_THRESHOLD = 48;

  let scrollContainer: HTMLDivElement | null = null;
  let showScrollToBottom = false;
  let lastAnchoredUserEntry = "";

  function updateScrollState(): void {
    if (!scrollContainer) {
      showScrollToBottom = false;
      return;
    }

    const hasTranscriptContent =
      transcript.length > 0 || liveStreamText.trim().length > 0;
    if (!hasTranscriptContent) {
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

  function scrollTranscriptToEntryTop(index: number): void {
    if (!scrollContainer) {
      return;
    }
    const target = scrollContainer.querySelector<HTMLElement>(`[data-transcript-index="${index}"]`);
    if (!target) {
      return;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scrollContainer.scrollTo({
      top: Math.max(scrollContainer.scrollTop + targetRect.top - containerRect.top, 0),
      behavior: "auto",
    });
  }

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
    const lastEntry = transcript[transcript.length - 1];
    const nextUserAnchor =
      lastEntry?.role === "user" ? `${transcript.length - 1}:${lastEntry.text}` : "";
    if (nextUserAnchor.length > 0 && nextUserAnchor !== lastAnchoredUserEntry) {
      lastAnchoredUserEntry = nextUserAnchor;
      scrollTranscriptToEntryTop(transcript.length - 1);
    }
    updateScrollState();
  });
</script>

<section class:transcript-flat={flat} class="transcript-widget-shell widget-surface">
  <div bind:this={scrollContainer} class="transcript-scroll" on:scroll={updateScrollState}>
    <Transcript {transcript} {liveStreamText} {status} {running} />
  </div>

  {#if showScrollToBottom}
    <button
      type="button"
      class="transcript-scroll-to-bottom"
      aria-label="Scroll transcript to bottom"
      on:click={scrollTranscriptToBottom}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" class="transcript-scroll-icon">
        <path
          d="M10 4.5v9m0 0-4-4m4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.8"
        />
      </svg>
    </button>
  {/if}
</section>
