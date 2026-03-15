<script lang="ts">
  export let drawerOpen = false;
  export let sidebarOpen = false;
  export let sidebarSide: "left" | "right" = "left";
</script>

<div
  class:drawer-open={drawerOpen}
  class:sidebar-open={sidebarOpen}
  class:sidebar-right={sidebarSide === "right"}
  class="app-shell"
>
  <div class="shell-sidebar">
    <slot name="sidebar" />
  </div>
  <div class="shell-main">
    <slot name="main" />
  </div>
  <slot name="drawer" />
</div>
