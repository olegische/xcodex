<script lang="ts">
  import ProviderSettingsModal from "./ProviderSettingsModal.svelte";
  import UiProfilesModal from "./UiProfilesModal.svelte";
  import type { ProviderDraft } from "../runtime";
  import type { UiProfile, UiProfilesDocument } from "../ui/profiles";
  import type { InspectorState } from "../stores/inspector";

  export let disabled = false;
  export let inspectorState: InspectorState;
  export let draft: ProviderDraft;
  export let profiles: UiProfilesDocument;
  export let onCloseSettings: () => void;
  export let onCloseProfiles: () => void;
  export let onSaveConfig: (event: CustomEvent<ProviderDraft>) => void;
  export let onRefreshAccountAndModels: (event: CustomEvent<ProviderDraft>) => void;
  export let onClearAuth: () => void;
  export let onCreateProfile: () => void;
  export let onSaveProfile: (event: CustomEvent<UiProfile>) => void;
  export let onActivateProfile: (event: CustomEvent<{ id: string }>) => void;
  export let onDeleteProfile: () => void;
</script>

<ProviderSettingsModal
  {draft}
  {disabled}
  open={inspectorState.showSettings}
  on:close={onCloseSettings}
  on:save={onSaveConfig}
  on:refreshaccount={onRefreshAccountAndModels}
  on:refreshmodels={onRefreshAccountAndModels}
  on:clearauth={onClearAuth}
/>

<UiProfilesModal
  document={profiles}
  open={inspectorState.showProfiles}
  on:close={onCloseProfiles}
  on:createprofile={onCreateProfile}
  on:saveprofile={onSaveProfile}
  on:activateprofile={onActivateProfile}
  on:deleteprofile={onDeleteProfile}
/>
