<script lang="ts">
  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let isError = false;
  export let running = false;

  function currentGreeting(): string {
    return "How can I help you today?";
  }

  function currentSubheading(currentStatus: string): string {
    if (currentStatus.length > 0) {
      return currentStatus;
    }
    return "Configure a provider, pick a model, and start a chat.";
  }
</script>

<section class="transcript">
  {#if transcript.length === 0 && liveStreamText.length === 0}
    <div class="empty-state">
      <h3>{currentGreeting()}</h3>
      <p>{currentSubheading(status)}</p>
    </div>
  {/if}

  {#each transcript as entry}
    <article class:user={entry.role === "user"} class="message-row">
      <div class="message-body">
        <div class="message-role">{entry.role === "user" ? "You" : "XCodex"}</div>
        <div class="message-text">{entry.text}</div>
      </div>
    </article>
  {/each}

  {#if running || liveStreamText.length > 0}
    <article class="message-row">
      <div class="message-body">
        <div class="message-role">XCodex</div>
        <div class="message-text">{liveStreamText || "Waiting for stream..."}</div>
      </div>
    </article>
  {/if}

  <footer class:error={isError} class="transcript-footer">
    {status}
  </footer>
</section>
