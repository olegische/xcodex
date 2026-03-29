<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ProviderDraft } from "../runtime";

  const dispatch = createEventDispatcher<{
    close: void;
    save: ProviderDraft;
    refreshaccount: ProviderDraft;
    refreshmodels: ProviderDraft;
    clearauth: void;
  }>();

  export let open = false;
  export let disabled = false;
  export let draft: ProviderDraft;

  function closeModal() {
    dispatch("close");
  }

  function handleOverlayKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      closeModal();
    }
  }
</script>

{#if open}
  <div
    class="overlay"
    role="button"
    tabindex="0"
    aria-label="Close settings"
    on:click={closeModal}
    on:keydown={handleOverlayKeydown}
  >
    <section
      class="modal-card settings-card"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">Settings</div>
          <h3>Provider Configuration</h3>
        </div>
        <button class="button ghost" type="button" on:click={closeModal}>Close</button>
      </div>

      <p class="profiles-note">
        Provider secrets are stored locally in this browser profile for convenience. They are not kept in a secure
        enclave and can be read by scripts running on this origin.
      </p>

      <form class="settings-form" on:submit|preventDefault={() => dispatch("save", draft)}>
      <div class="settings-grid">
        <label>
          <span>Protocol</span>
          <select bind:value={draft.protocolMode} disabled={disabled}>
            <option value="app-server">App Server compatible</option>
            <option value="responses-api">Responses API compatible</option>
          </select>
        </label>

        <label>
          <span>Transport</span>
          <select bind:value={draft.transportMode} disabled={disabled}>
            <option value="xrouter-browser">XRouter Browser</option>
            <option value="openai">OpenAI</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
        </label>

        <label>
          <span>Provider Name</span>
          <input bind:value={draft.providerDisplayName} autocomplete="organization" disabled={disabled} />
        </label>

        {#if draft.transportMode === "xrouter-browser"}
          <label>
            <span>Upstream Provider</span>
            <select bind:value={draft.xrouterProvider} disabled={disabled}>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
              <option value="zai">ZAI</option>
            </select>
          </label>
        {/if}

        <label>
          <span>Base URL</span>
          <input bind:value={draft.providerBaseUrl} autocomplete="url" disabled={disabled} />
        </label>

        <label>
          <span>API Key</span>
          <input
            bind:value={draft.apiKey}
            type="password"
            autocomplete="off"
            disabled={disabled}
          />
          <span class="settings-help">Stored locally in this browser profile. Do not use on shared machines or untrusted origins.</span>
        </label>

        <label>
          <span>Reasoning</span>
          <select bind:value={draft.modelReasoningEffort} disabled={disabled}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>

        <label>
          <span>Personality</span>
          <input bind:value={draft.personality} autocomplete="off" disabled={disabled} />
        </label>
      </div>

      <div class="modal-actions">
        <button class="button ghost" type="button" disabled={disabled} on:click={() => dispatch("refreshaccount", draft)}>
          Refresh Account
        </button>
        <button class="button ghost" type="button" disabled={disabled} on:click={() => dispatch("refreshmodels", draft)}>
          Refresh Models
        </button>
        <button class="button ghost" type="button" disabled={disabled} on:click={() => dispatch("clearauth")}>
          Clear Auth
        </button>
        <button class="button primary" type="submit" disabled={disabled}>
          Save Config
        </button>
      </div>
      </form>
    </section>
  </div>
{/if}
