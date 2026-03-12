<script lang="ts">
  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;

  function currentGreeting(): string {
    return "How can I help you today?";
  }

  function currentSubheading(currentStatus: string): string {
    return "This runtime can inspect browser state, use DevTools-visible surfaces, and execute code.";
  }

  function paragraphs(text: string): string[] {
    return text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
</script>

<section class="transcript">
  {#if transcript.length === 0 && liveStreamText.length === 0}
    <div class="empty-state">
      <h3>{currentGreeting()}</h3>
      <p>{currentSubheading(status)}</p>
      <p>Do not use it in a browser session you are not willing to expose or break.</p>
    </div>
  {/if}

  {#each transcript as entry}
    <article class:user={entry.role === "user"} class="message-row">
      <div class="message-body">
        <div class="message-role">{entry.role === "user" ? "You" : "XCodex"}</div>
        <div class="message-text">
          {#each paragraphs(entry.text) as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>
      </div>
    </article>
  {/each}

  {#if running || liveStreamText.length > 0}
    <article class="message-row">
      <div class="message-body">
        <div class="message-role">XCodex</div>
        <div class="message-text">
          {#each paragraphs(liveStreamText || "Waiting for stream...") as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>
      </div>
    </article>
  {/if}
</section>
