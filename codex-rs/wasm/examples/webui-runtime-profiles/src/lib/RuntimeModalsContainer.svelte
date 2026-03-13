<script lang="ts">
  import RuntimeModals from "./RuntimeModals.svelte";
  import { inspectorStore } from "../stores/inspector";
  import type { ProviderDraft } from "../runtime";
  import type { UiProfile, UiProfilesDocument } from "../ui/profiles";

  export let disabled = false;
  export let draft: ProviderDraft;
  export let profiles: UiProfilesDocument;
  export let onSaveConfig: (event: CustomEvent<ProviderDraft>) => void;
  export let onRefreshAccountAndModels: (event: CustomEvent<ProviderDraft>) => void;
  export let onClearAuth: () => void;
  export let onCreateProfile: () => void;
  export let onSaveProfile: (event: CustomEvent<UiProfile>) => void;
  export let onActivateProfile: (event: CustomEvent<{ id: string }>) => void;
  export let onDeleteProfile: () => void;

  $: inspectorState = $inspectorStore;
  $: settingsDraft = { ...draft };

  function closeSettings() {
    inspectorStore.closeSettings();
  }

  function closeProfiles() {
    inspectorStore.closeProfiles();
  }
</script>

<RuntimeModals
  {disabled}
  {inspectorState}
  profiles={profiles}
  draft={settingsDraft}
  onCloseProfiles={closeProfiles}
  onCloseSettings={closeSettings}
  onSaveConfig={onSaveConfig}
  onRefreshAccountAndModels={onRefreshAccountAndModels}
  {onClearAuth}
  {onCreateProfile}
  {onSaveProfile}
  {onActivateProfile}
  {onDeleteProfile}
/>
