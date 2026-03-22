<script lang="ts">
  import { inspectorStore } from "../stores/inspector";
  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let status = "";
  export let running = false;
  export let onSettings: (() => void) | undefined = undefined;
  let copiedText: string | null = null;
  let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

  function currentGreeting(): string {
    return "What should I do in this browser environment?";
  }

  function currentSubheading(currentStatus: string): string {
    if (needsProviderSetup(currentStatus)) {
      return "Router is not configured yet. Open Settings, paste your provider API key, save the config, then refresh models.";
    }
    if (currentStatus.startsWith("Router bootstrap pending:")) {
      return `Router setup is incomplete. ${currentStatus.replace("Router bootstrap pending:", "").trim()}`;
    }
    return "Start in chat. Open the inspector only when you need page state, tools, artifacts, or event logs.";
  }

  function needsProviderSetup(currentStatus: string): boolean {
    return currentStatus === "Waiting for router API key.";
  }

  function openSettings(): void {
    if (onSettings !== undefined) {
      onSettings();
      return;
    }
    inspectorStore.openSettings();
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

</script>

<section class="transcript">
  {#if transcript.length === 0}
    <div class="empty-state">
      <h3>{currentGreeting()}</h3>
      <p>{currentSubheading(status)}</p>
      {#if needsProviderSetup(status) || status.startsWith("Router bootstrap pending:")}
        <button class="empty-state-cta" on:click={openSettings}>Open Settings</button>
      {/if}
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
            <details class="tool-details">
              <summary class="tool-details-toggle">
                <span class="tool-details-marker">+</span>
                <span>{entry.summary ?? entry.text}</span>
              </summary>
                <div class="tool-details-body">
                  {#each paragraphs(entry.details ?? "") as paragraph}
                    <p>{paragraph}</p>
                  {/each}
                </div>
            </details>
          {:else}
            {#each paragraphs(entry.text) as paragraph}
              <p>{paragraph}</p>
            {/each}
          {/if}
        </div>
      </div>
    </article>
  {/each}
  {#if !running && transcript.some((entry) => entry.role !== "user")}
    <div class="message-actions">
      <button class="message-action-button" on:click={() => void copyMessage(copyableTranscript())}>
        {copiedText === copyableTranscript() ? "Copied" : "Copy"}
      </button>
    </div>
  {/if}
</section>
