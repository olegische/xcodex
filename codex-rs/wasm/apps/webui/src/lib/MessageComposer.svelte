<script lang="ts">
  import { tick } from "svelte";
  import { createEventDispatcher } from "svelte";
  import type { ModelPreset } from "../runtime";

  const dispatch = createEventDispatcher<{
    send: void;
    stop: void;
    settings: void;
    selectmodel: { model: string };
    selectreasoning: { value: string };
  }>();

  export let message = "";
  export let disabled = false;
  export let running = false;
  export let models: ModelPreset[] = [];
  export let currentModel = "";
  export let currentReasoning = "medium";

  let textareaElement: HTMLTextAreaElement | null = null;
  let modelMenuOpen = false;
  let reasoningMenuOpen = false;

  const MAX_ROWS = 10;
  const LINE_HEIGHT_PX = 32;
  const reasoningOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  $: void syncTextareaHeight(message);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dispatch("send");
    }
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest(".composer-menu-shell") !== null) {
      return;
    }
    modelMenuOpen = false;
    reasoningMenuOpen = false;
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      modelMenuOpen = false;
      reasoningMenuOpen = false;
    }
  }

  function toggleModelMenu(event: MouseEvent) {
    event.stopPropagation();
    modelMenuOpen = !modelMenuOpen;
    if (modelMenuOpen) {
      reasoningMenuOpen = false;
    }
  }

  function toggleReasoningMenu(event: MouseEvent) {
    event.stopPropagation();
    reasoningMenuOpen = !reasoningMenuOpen;
    if (reasoningMenuOpen) {
      modelMenuOpen = false;
    }
  }

  function selectModel(model: string) {
    dispatch("selectmodel", { model });
    modelMenuOpen = false;
  }

  function selectReasoning(value: string) {
    dispatch("selectreasoning", { value });
    reasoningMenuOpen = false;
  }

  function currentModelLabel(): string {
    return models.find((model) => model.id === currentModel)?.displayName || currentModel || "Select model";
  }

  function currentReasoningLabel(): string {
    return reasoningOptions.find((option) => option.value === currentReasoning)?.label || currentReasoning;
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

<svelte:document on:click={handleDocumentClick} on:keydown={handleDocumentKeydown} />

<div class="composer-shell">
  <div class="composer">
    <textarea
      bind:value={message}
      bind:this={textareaElement}
      class="composer-input"
      placeholder="Ask for follow-up changes"
      rows="1"
      on:keydown={handleKeydown}
    ></textarea>

    <div class="composer-actions">
      <div class="composer-left-tools">
        <button class="icon-pill" aria-label="Open settings" on:click={() => dispatch("settings")}>+</button>

        <div class="composer-menu-shell">
          <button class="composer-menu-trigger" on:click={toggleModelMenu} aria-haspopup="menu" aria-expanded={modelMenuOpen}>
            <span class="composer-menu-label">{currentModelLabel()}</span>
            <span class="composer-menu-caret" aria-hidden="true"></span>
          </button>

          {#if modelMenuOpen}
            <div class="composer-menu" role="menu">
              <div class="composer-menu-title">Select model</div>
              {#if models.length === 0}
                <div class="composer-menu-empty">No models loaded</div>
              {:else}
                {#each models as model}
                  <button
                    class:active={model.id === currentModel}
                    class="composer-menu-item"
                    role="menuitemradio"
                    aria-checked={model.id === currentModel}
                    on:click={() => selectModel(model.id)}
                  >
                    <span>{model.displayName || model.id}</span>
                    {#if model.id === currentModel}
                      <span class="composer-menu-check">✓</span>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <div class="composer-menu-shell">
          <button
            class="composer-menu-trigger"
            on:click={toggleReasoningMenu}
            aria-haspopup="menu"
            aria-expanded={reasoningMenuOpen}
          >
            <span class="composer-menu-label">{currentReasoningLabel()}</span>
            <span class="composer-menu-caret" aria-hidden="true"></span>
          </button>

          {#if reasoningMenuOpen}
            <div class="composer-menu" role="menu">
              <div class="composer-menu-title">Select reasoning</div>
              {#each reasoningOptions as option}
                <button
                  class:active={option.value === currentReasoning}
                  class="composer-menu-item"
                  role="menuitemradio"
                  aria-checked={option.value === currentReasoning}
                  on:click={() => selectReasoning(option.value)}
                >
                  <span>{option.label}</span>
                  {#if option.value === currentReasoning}
                    <span class="composer-menu-check">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
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
</div>
