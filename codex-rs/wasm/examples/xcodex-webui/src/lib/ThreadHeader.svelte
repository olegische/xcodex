<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { InspectorTab, ShellActionId, ShellActionSpec } from "../ui/types";

  const dispatch = createEventDispatcher<{
    action: ShellActionId;
    selectinspector: { id: InspectorTab };
  }>();

  export let sidebarOpen = false;
  export let leadingActions: ShellActionSpec[] = [];
  export let trailingActions: ShellActionSpec[] = [];
  export let activeInspectorTab: InspectorTab = "mission";

  const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "mission", label: "Zone" },
    { id: "ledger", label: "Ledger" },
    { id: "citations", label: "Citations" },
    { id: "tools", label: "Tools" },
    { id: "workspace", label: "Artifacts" },
    { id: "events", label: "Events" },
  ];

  let inspectorMenuOpen = false;
  let inspectorShellElement: HTMLDivElement | null = null;

  function triggerAction(id: ShellActionId) {
    dispatch("action", id);
  }

  function toggleInspectorMenu() {
    inspectorMenuOpen = !inspectorMenuOpen;
  }

  function selectInspector(id: InspectorTab) {
    inspectorMenuOpen = false;
    dispatch("selectinspector", { id });
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && inspectorShellElement?.contains(target)) {
      return;
    }
    inspectorMenuOpen = false;
  }
</script>

<svelte:document on:click={handleDocumentClick} />

<header class="thread-header">
  <div class="nav-left">
    {#each leadingActions as action (action.id)}
      {#if action.id === "new_thread"}
        {#if !sidebarOpen}
          <button class="header-action-button" on:click={() => triggerAction(action.id)}>{action.label}</button>
        {/if}
      {:else}
        <button class="nav-icon-button" on:click={() => triggerAction(action.id)} aria-label={action.ariaLabel}>
          {action.shortLabel}
        </button>
      {/if}
    {/each}
  </div>

  <div class="nav-center"></div>

  <div class="nav-right">
    <div class="composer-menu-shell" bind:this={inspectorShellElement}>
      <button class="composer-menu-trigger" on:click={toggleInspectorMenu}>
        <span class="composer-menu-label">
          {inspectorTabs.find((tab) => tab.id === activeInspectorTab)?.label ?? "Zone"}
        </span>
        <span class="composer-menu-caret" aria-hidden="true"></span>
      </button>

      {#if inspectorMenuOpen}
        <div class="composer-menu header-dropdown-menu" role="menu">
          <div class="composer-menu-title">Inspector</div>
          {#each inspectorTabs as tab}
            <button
              class:active={tab.id === activeInspectorTab}
              class="composer-menu-item"
              role="menuitemradio"
              aria-checked={tab.id === activeInspectorTab}
              on:click={() => selectInspector(tab.id)}
            >
              <span>{tab.label}</span>
              {#if tab.id === activeInspectorTab}
                <span class="composer-menu-check" aria-hidden="true">
                  <svg viewBox="0 0 12 10" focusable="false">
                    <path d="M1.5 5.5 4.5 8.5 10.5 1.5"></path>
                  </svg>
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#each trailingActions as action (action.id)}
      <button class="nav-icon-button" on:click={() => triggerAction(action.id)} aria-label={action.ariaLabel}>
        {action.shortLabel}
      </button>
    {/each}
  </div>
</header>
