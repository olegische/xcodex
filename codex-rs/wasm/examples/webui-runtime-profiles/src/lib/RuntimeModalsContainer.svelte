<script lang="ts">
  import RuntimeModals from "./RuntimeModals.svelte";
  import { collaborationStore } from "../stores/collaboration";
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
  $: collaborationState = $collaborationStore;
  $: settingsDraft = { ...draft };

  function closeSettings() {
    inspectorStore.closeSettings();
  }

  function closeProfiles() {
    inspectorStore.closeProfiles();
  }

  function cancelCollaboration() {
    collaborationStore.cancelCurrentRequest();
  }

  function submitCollaboration(event: CustomEvent<Array<{ id: string; value: string }>>) {
    collaborationStore.submitCurrentAnswer(
      event.detail.map((answer) => ({
        id: answer.id,
        value: answer.value,
      })),
    );
  }
</script>

<RuntimeModals
  collaborationRequest={collaborationState.currentRequest}
  {disabled}
  {inspectorState}
  profiles={profiles}
  draft={settingsDraft}
  onCancelCollaboration={cancelCollaboration}
  onCloseProfiles={closeProfiles}
  onCloseSettings={closeSettings}
  onSaveConfig={onSaveConfig}
  onRefreshAccountAndModels={onRefreshAccountAndModels}
  onSubmitCollaboration={submitCollaboration}
  {onClearAuth}
  {onCreateProfile}
  {onSaveProfile}
  {onActivateProfile}
  {onDeleteProfile}
/>
