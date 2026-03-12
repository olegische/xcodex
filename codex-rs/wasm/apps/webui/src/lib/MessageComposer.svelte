<script lang="ts">
  import { tick } from "svelte";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    send: void;
    stop: void;
  }>();

  export let message = "";
  export let disabled = false;
  export let running = false;
  let textareaElement: HTMLTextAreaElement | null = null;

  const MAX_ROWS = 10;
  const LINE_HEIGHT_PX = 32;

  $: void syncTextareaHeight(message);

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      dispatch("send");
    }
  }

  async function syncTextareaHeight(_: string) {
    await tick();
    if (textareaElement === null) {
      return;
    }

    textareaElement.style.height = "auto";
    const maxHeight = LINE_HEIGHT_PX * MAX_ROWS;
    const nextHeight = Math.min(textareaElement.scrollHeight, maxHeight);
    textareaElement.style.height = `${nextHeight}px`;
    textareaElement.style.overflowY = textareaElement.scrollHeight > maxHeight ? "auto" : "hidden";
  }
</script>

<div class="composer-shell">
  <div class="composer">
    <textarea
      bind:value={message}
      bind:this={textareaElement}
      class="composer-input"
      placeholder="Ask anything"
      rows="1"
      on:keydown={handleKeydown}
    ></textarea>

    <div class="composer-actions">
      <div class="composer-left-tools">
        <button class="icon-pill" aria-label="Attach">+</button>
      </div>
      <div class="composer-buttons">
        {#if running}
          <button class="button secondary" on:click={() => dispatch("stop")}>Stop</button>
        {:else}
          <button class="button primary" disabled={disabled} on:click={() => dispatch("send")}>
            Send
          </button>
        {/if}
      </div>
    </div>
  </div>
  <div class="composer-hint">Codex may make mistakes. Review important output.</div>
</div>
