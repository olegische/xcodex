<script lang="ts">
  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  let copiedText: string | null = null;
  let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;
  let expandedToolEntries = new Set<string>();
  let previousRunning = running;
  let previousToolKeys = "";

  function currentGreeting(): string {
    return "What should I do in this browser environment?";
  }

  function currentSubheading(currentStatus: string): string {
    void currentStatus;
    return "Start in chat. Open the inspector only when you need page state, tools, artifacts, or event logs.";
  }

  function paragraphs(text: string): string[] {
    return text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  function copyableTranscript(): string {
    return transcript
      .filter((entry) => entry.role !== "user")
      .map((entry) => `${entry.role === "tool" ? "Tool" : "Agent"}\n${entry.text.trim()}`)
      .join("\n\n");
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedText = text;
      if (copiedResetTimeout !== null) {
        clearTimeout(copiedResetTimeout);
      }
      copiedResetTimeout = setTimeout(() => {
        copiedText = null;
      }, 1500);
    } catch {
      copiedText = null;
    }
  }

  function hasToolDetails(entry: TranscriptEntry): boolean {
    return entry.role === "tool" && typeof entry.details === "string" && entry.details.trim().length > 0;
  }

  function toolEntryKey(entry: TranscriptEntry, index: number): string {
    return `${index}:${entry.summary ?? entry.text}`;
  }

  function isToolEntryExpanded(entry: TranscriptEntry, index: number): boolean {
    return expandedToolEntries.has(toolEntryKey(entry, index));
  }

  function toggleToolEntry(entry: TranscriptEntry, index: number): void {
    const key = toolEntryKey(entry, index);
    const next = new Set(expandedToolEntries);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    expandedToolEntries = next;
  }

  $: {
    const visibleToolKeys = transcript.flatMap((entry, index) =>
      hasToolDetails(entry) ? [toolEntryKey(entry, index)] : [],
    );
    const nextToolKeys = visibleToolKeys.join("|");

    if (running !== previousRunning) {
      expandedToolEntries = new Set();
    } else if (nextToolKeys !== previousToolKeys && expandedToolEntries.size > 0) {
      expandedToolEntries = new Set(
        Array.from(expandedToolEntries).filter((key) => visibleToolKeys.includes(key)),
      );
    }

    previousRunning = running;
    previousToolKeys = nextToolKeys;
  }
</script>

<section class="transcript">
  {#if transcript.length === 0 && liveStreamText.length === 0}
    <div class="empty-state">
      <h3>{currentGreeting()}</h3>
      <p>{currentSubheading(status)}</p>
    </div>
  {/if}

  {#each transcript as entry, index}
    <article
      data-transcript-index={index}
      class:user={entry.role === "user"}
      class:tool={entry.role === "tool"}
      class:assistant={entry.role !== "user" && entry.role !== "tool"}
      class="message-row"
    >
      <div class="message-body">
        <div class="message-role">
          {entry.role === "user" ? "You" : entry.role === "tool" ? "Tool" : "Agent"}
        </div>
        <div class="message-text">
          {#if hasToolDetails(entry)}
            <div class="tool-details">
              <button
                type="button"
                class="tool-details-toggle"
                aria-expanded={isToolEntryExpanded(entry, index)}
                on:click={() => toggleToolEntry(entry, index)}
              >
                <span class="tool-details-marker">
                  {isToolEntryExpanded(entry, index) ? "-" : "+"}
                </span>
                <span>{entry.summary ?? entry.text}</span>
              </button>
              {#if isToolEntryExpanded(entry, index)}
                <div class="tool-details-body">
                  {#each paragraphs(entry.details ?? "") as paragraph}
                    <p>{paragraph}</p>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            {#each paragraphs(entry.text) as paragraph}
              <p>{paragraph}</p>
            {/each}
          {/if}
        </div>
      </div>
    </article>
  {/each}

  {#if liveStreamText.length > 0}
    <article class="message-row">
      <div class="message-body">
        <div class="message-role">Agent</div>
        <div class="message-text">
          {#each paragraphs(liveStreamText) as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>
      </div>
    </article>
  {/if}

  {#if !running && transcript.some((entry) => entry.role !== "user")}
    <div class="message-actions">
      <button class="message-action-button" on:click={() => void copyMessage(copyableTranscript())}>
        {copiedText === copyableTranscript() ? "Copied" : "Copy"}
      </button>
    </div>
  {/if}
</section>
