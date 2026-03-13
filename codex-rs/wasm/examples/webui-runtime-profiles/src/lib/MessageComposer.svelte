<script lang="ts">
  import { onMount, tick } from "svelte";
  import { createEventDispatcher } from "svelte";
  import { composerLabelState, composerStore } from "../stores/composer";

  const dispatch = createEventDispatcher<{
    send: void;
    stop: void;
    settings: void;
  }>();

  export let disabled = false;
  export let running = false;

  let textareaElement: HTMLTextAreaElement | null = null;
  let modelTriggerElement: HTMLButtonElement | null = null;
  let reasoningTriggerElement: HTMLButtonElement | null = null;
  let modelMenuOpen = false;
  let reasoningMenuOpen = false;
  let modelMenuStyle = "";
  let reasoningMenuStyle = "";

  const MAX_ROWS = 10;
  const LINE_HEIGHT_PX = 32;
  const reasoningOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  $: composerState = $composerStore;
  $: labelState = $composerLabelState;
  $: void syncTextareaHeight(composerState.message);

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
      updateMenuPositions();
    }
  }

  function toggleReasoningMenu(event: MouseEvent) {
    event.stopPropagation();
    reasoningMenuOpen = !reasoningMenuOpen;
    if (reasoningMenuOpen) {
      modelMenuOpen = false;
      updateMenuPositions();
    }
  }

  function selectModel(model: string) {
    composerStore.setSelectedModel(model);
    modelMenuOpen = false;
  }

  function selectReasoning(value: string) {
    composerStore.setSelectedReasoning(value);
    reasoningMenuOpen = false;
  }

  onMount(() => {
    const handleWindowLayoutChange = () => updateMenuPositions();
    window.addEventListener("resize", handleWindowLayoutChange);
    window.addEventListener("scroll", handleWindowLayoutChange, true);
    void focusComposer();
    return () => {
      window.removeEventListener("resize", handleWindowLayoutChange);
      window.removeEventListener("scroll", handleWindowLayoutChange, true);
    };
  });

  $: if (modelMenuOpen || reasoningMenuOpen) {
    void tick().then(updateMenuPositions);
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

  async function focusComposer() {
    await tick();
    if (disabled || textareaElement === null) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body && activeElement !== textareaElement) {
      return;
    }
    textareaElement.focus();
  }

  function updateMenuPositions() {
    modelMenuStyle = computeMenuStyle(modelTriggerElement);
    reasoningMenuStyle = computeMenuStyle(reasoningTriggerElement);
  }

  function computeMenuStyle(trigger: HTMLButtonElement | null): string {
    if (trigger === null) {
      return "";
    }
    const rect = trigger.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 220);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - minWidth - 16));
    const top = Math.max(16, rect.top - 10);
    return `position: fixed; left: ${left}px; top: ${top}px; min-width: ${minWidth}px; transform: translateY(-100%);`;
  }
</script>

<svelte:document on:click={handleDocumentClick} on:keydown={handleDocumentKeydown} />

<div class="composer-shell">
  <div class="composer">
    <textarea
      value={composerState.message}
      bind:this={textareaElement}
      class="composer-input"
      placeholder="Ask for follow-up changes"
      rows="1"
      on:input={(event) => composerStore.setMessage((event.currentTarget as HTMLTextAreaElement).value)}
      on:keydown={handleKeydown}
    ></textarea>

    <div class="composer-actions">
      <div class="composer-left-tools">
        <button class="icon-pill" aria-label="Open settings" on:click={() => dispatch("settings")}>+</button>

        <div class="composer-menu-shell">
          <button
            bind:this={modelTriggerElement}
            class="composer-menu-trigger"
            on:click={toggleModelMenu}
            aria-haspopup="menu"
            aria-expanded={modelMenuOpen}
          >
            <span class="composer-menu-label">{labelState.modelLabel}</span>
            <span class="composer-menu-caret" aria-hidden="true"></span>
          </button>

          {#if modelMenuOpen}
            <div class="composer-menu" style={modelMenuStyle} role="menu">
              <div class="composer-menu-title">{labelState.modelLabel}</div>
              {#if composerState.models.length === 0}
                <div class="composer-menu-empty">No models loaded</div>
              {:else}
                {#each composerState.models as model}
                  <button
                    class:active={model.id === composerState.selectedModelId}
                    class="composer-menu-item"
                    role="menuitemradio"
                    aria-checked={model.id === composerState.selectedModelId}
                    on:click={() => selectModel(model.id)}
                  >
                    <span>{model.displayName || model.id}</span>
                    {#if model.id === composerState.selectedModelId}
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
            bind:this={reasoningTriggerElement}
            class="composer-menu-trigger"
            on:click={toggleReasoningMenu}
            aria-haspopup="menu"
            aria-expanded={reasoningMenuOpen}
          >
            <span class="composer-menu-label">{labelState.reasoningLabel}</span>
            <span class="composer-menu-caret" aria-hidden="true"></span>
          </button>

          {#if reasoningMenuOpen}
            <div class="composer-menu" style={reasoningMenuStyle} role="menu">
              <div class="composer-menu-title">Select reasoning</div>
              {#each reasoningOptions as option}
                <button
                  class:active={option.value === composerState.selectedReasoning}
                  class="composer-menu-item"
                  role="menuitemradio"
                  aria-checked={option.value === composerState.selectedReasoning}
                  on:click={() => selectReasoning(option.value)}
                >
                  <span>{option.label}</span>
                  {#if option.value === composerState.selectedReasoning}
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
