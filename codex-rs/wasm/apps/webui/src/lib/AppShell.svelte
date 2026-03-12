<script lang="ts">
  export let drawerOpen = false;
</script>

<div class:drawer-open={drawerOpen} class="app-shell">
  <slot name="sidebar" />
  <div class="shell-main">
    <slot name="main" />
  </div>
  <slot name="drawer" />
</div>
