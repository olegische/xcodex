<script lang="ts">
  import type { WorkspaceFileSummary } from "../types";

  export let workspaceFiles: WorkspaceFileSummary[] = [];

  const PRIMARY_APP_PATH = "/workspace/nullops/app.html";
  const FALLBACK_APP_PATH = "/workspace/nullops/index.html";

  function extractTitle(content: string): string | null {
    const match = content.match(/<title>([\s\S]*?)<\/title>/i);
    return match?.[1]?.trim() || null;
  }

  $: appFile =
    workspaceFiles.find((file) => file.path === PRIMARY_APP_PATH) ??
    workspaceFiles.find((file) => file.path === FALLBACK_APP_PATH) ??
    null;
  $: appTitle = appFile ? extractTitle(appFile.content) ?? "Generated app" : "No app yet";
  $: srcdoc = appFile?.content ?? "";
</script>

<section class="nullops-preview-shell">
  <header class="nullops-preview-header">
    <div>
      <div class="eyebrow">Live App</div>
      <strong>{appTitle}</strong>
    </div>
    {#if appFile}
      <div class="pill-row">
        <span class="chip">runtime</span>
        <span class="chip ghost">{appFile.path}</span>
      </div>
    {/if}
  </header>

  {#if appFile}
    <div class="nullops-preview-stage">
      <iframe
        class="nullops-preview-frame"
        sandbox="allow-scripts allow-forms allow-modals"
        title={appTitle}
        {srcdoc}
      ></iframe>
    </div>
  {:else}
    <div class="nullops-preview-empty">
      <div class="eyebrow">Ready</div>
      <strong>Ask for a site and it will appear here.</strong>
      <p>NullOps watches <code>/workspace/nullops/app.html</code>. The model can generate a calculator or any other self-contained app directly into runtime.</p>
    </div>
  {/if}
</section>
