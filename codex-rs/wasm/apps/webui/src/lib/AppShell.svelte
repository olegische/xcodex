<script lang="ts">
  export let drawerOpen = false;
  export let sidebarOpen = false;
</script>

<div class:drawer-open={drawerOpen} class:sidebar-open={sidebarOpen} class="app-shell">
  <div class="shell-sidebar">
    <slot name="sidebar" />
  </div>
  <div class="shell-main">
    <slot name="main" />
  </div>
  <slot name="drawer" />
</div>
