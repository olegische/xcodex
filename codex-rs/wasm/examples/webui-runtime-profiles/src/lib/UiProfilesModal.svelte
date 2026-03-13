<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import {
    UI_PROFILES_GUIDE_PATH,
    UI_PROFILES_PATH,
    resolveActiveUiProfile,
    type UiProfile,
    type UiProfilesDocument,
  } from "../ui/profiles";
  import { UI_LAYOUT_GUIDE_PATH, UI_LAYOUT_PATH } from "../ui/layout";
  import { UI_TOKENS_GUIDE_PATH, UI_TOKENS_PATH } from "../ui/tokens";
  import { UI_WIDGETS_GUIDE_PATH, UI_WIDGETS_PATH } from "../ui/widgets";

  const dispatch = createEventDispatcher<{
    close: void;
    createprofile: void;
    saveprofile: UiProfile;
    activateprofile: { id: string };
    deleteprofile: void;
  }>();

  export let open = false;
  export let document: UiProfilesDocument;

  let activeProfileId = "";
  let draft: UiProfile = {
    id: "",
    name: "",
    theme: "dark",
    sidebarSide: "left",
  };

  $: activeProfile = resolveActiveUiProfile(document);
  $: if (activeProfile.id !== activeProfileId) {
    activeProfileId = activeProfile.id;
    draft = { ...activeProfile };
  }

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
    aria-label="Close UI profiles"
    on:click={closeModal}
    on:keydown={handleOverlayKeydown}
  >
    <section
      class="modal-card profiles-card"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">Runtime UI</div>
          <h3>Workspace Profiles</h3>
        </div>
        <button class="button ghost" type="button" on:click={closeModal}>Close</button>
      </div>

      <p class="profiles-note">
        Codex can rewrite <code>{UI_PROFILES_PATH}</code> directly in-browser. Schema notes live in
        <code>{UI_PROFILES_GUIDE_PATH}</code>. Shell layout lives in <code>{UI_LAYOUT_PATH}</code> with notes in
        <code>{UI_LAYOUT_GUIDE_PATH}</code>. Base tokens live in <code>{UI_TOKENS_PATH}</code>, and widget config lives in
        <code>{UI_WIDGETS_PATH}</code> with guides in <code>{UI_TOKENS_GUIDE_PATH}</code> and <code>{UI_WIDGETS_GUIDE_PATH}</code>.
      </p>

      <div class="profiles-layout">
        <div class="profiles-list">
          {#each document.profiles as profile}
            <button
              class:active={profile.id === document.activeProfileId}
              class="profile-card"
              type="button"
              on:click={() => dispatch("activateprofile", { id: profile.id })}
            >
              <strong>{profile.name}</strong>
              <span>{profile.theme} theme</span>
              <span>sidebar {profile.sidebarSide}</span>
            </button>
          {/each}
        </div>

        <form class="profiles-editor" on:submit|preventDefault={() => dispatch("saveprofile", draft)}>
          <label>
            <span>Active Profile Name</span>
            <input bind:value={draft.name} />
          </label>

          <label>
            <span>Theme</span>
            <select bind:value={draft.theme}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>

          <label>
            <span>Sidebar Side</span>
            <select bind:value={draft.sidebarSide}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>

          <div class="modal-actions">
            <button class="button ghost" type="button" on:click={() => dispatch("createprofile")}>New Profile</button>
            <button
              class="button ghost"
              type="button"
              disabled={document.profiles.length <= 1}
              on:click={() => dispatch("deleteprofile")}
            >
              Delete Active
            </button>
            <button class="button primary" type="submit">Save Active</button>
          </div>
        </form>
      </div>
    </section>
  </div>
{/if}
