<script lang="ts">
  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let toolEntries: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  let copiedText: string | null = null;
  let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

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
          {#each paragraphs(entry.text) as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>
      </div>
    </article>
  {/each}

  {#each toolEntries as entry}
    <article class:tool={true} class="message-row">
      <div class="message-body">
        <div class="message-role">Tool</div>
        <div class="message-text">
          {#each paragraphs(entry.text) as paragraph}
            <p>{paragraph}</p>
          {/each}
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
