<script lang="ts">
  import type { WorkspaceFileSummary } from "../../types";

  export let title = "Workspace Files";
  export let workspaceFiles: WorkspaceFileSummary[] = [];
  export let maxItems = 8;
  export let showPreview = true;

  $: visibleFiles = workspaceFiles.slice().sort((left, right) => left.path.localeCompare(right.path)).slice(0, maxItems);
  $: selectedPath = visibleFiles[0]?.path ?? "";
  $: selectedFile = visibleFiles.find((file) => file.path === selectedPath) ?? visibleFiles[0] ?? null;
</script>

<section class="widget-panel inspector-section">
  <div class="eyebrow">{title}</div>
  <div class="drawer-content">
    {#if visibleFiles.length === 0}
      <p class="drawer-empty">No workspace files yet.</p>
    {/if}
    {#if visibleFiles.length > 0}
      <div class="workspace-files-list">
        {#each visibleFiles as file}
          <button class:active={file.path === selectedPath} class="thread-card" on:click={() => (selectedPath = file.path)}>
            <span class="thread-title">{file.path}</span>
            <span class="thread-subtitle">{file.bytes} bytes</span>
          </button>
        {/each}
      </div>
      {#if selectedFile}
        <div class="event-card">
          <div class="event-type">{selectedFile.path}</div>
          <pre>{showPreview ? selectedFile.content : `${selectedFile.bytes} bytes`}</pre>
        </div>
      {/if}
    {/if}
  </div>
</section>
