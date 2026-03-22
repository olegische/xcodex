<script lang="ts">
  import RuntimeModals from "./RuntimeModals.svelte";
  import { collaborationStore } from "../stores/collaboration";
  import { inspectorStore } from "../stores/inspector";
  import type { ProviderDraft } from "../runtime";

  export let disabled = false;
  export let draft: ProviderDraft;
  export let onSaveConfig: (event: CustomEvent<ProviderDraft>) => void;
  export let onRefreshAccountAndModels: (event: CustomEvent<ProviderDraft>) => void;
  export let onClearAuth: () => void;

  $: inspectorState = $inspectorStore;
  $: collaborationState = $collaborationStore;
  $: settingsDraft = { ...draft };

  function closeSettings() {
    inspectorStore.closeSettings();
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
  draft={settingsDraft}
  onCancelCollaboration={cancelCollaboration}
  onCloseSettings={closeSettings}
  onSaveConfig={onSaveConfig}
  onRefreshAccountAndModels={onRefreshAccountAndModels}
  onSubmitCollaboration={submitCollaboration}
  {onClearAuth}
/>
