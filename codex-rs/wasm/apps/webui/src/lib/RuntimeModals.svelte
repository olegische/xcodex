<script lang="ts">
  import CollaborationModal from "./CollaborationModal.svelte";
  import ProviderSettingsModal from "./ProviderSettingsModal.svelte";
  import type { ProviderDraft } from "../runtime";
  import type { CollaborationRequest } from "../stores/collaboration";
  import type { InspectorState } from "../stores/inspector";

  export let disabled = false;
  export let inspectorState: InspectorState;
  export let collaborationRequest: CollaborationRequest | null = null;
  export let draft: ProviderDraft;
  export let onCancelCollaboration: () => void;
  export let onSubmitCollaboration: (event: CustomEvent<Array<{ id: string; value: string }>>) => void;
  export let onCloseSettings: () => void;
  export let onSaveConfig: (event: CustomEvent<ProviderDraft>) => void;
  export let onRefreshAccountAndModels: (event: CustomEvent<ProviderDraft>) => void;
  export let onClearAuth: () => void;
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

<CollaborationModal
  request={collaborationRequest}
  on:cancel={onCancelCollaboration}
  on:submit={onSubmitCollaboration}
/>
