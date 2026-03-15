<script lang="ts">
  import MessageComposer from "../MessageComposer.svelte";

  export let disabled = false;
  export let running = false;
  export let onSend: () => void;
  export let onStop: () => void;
  export let onSettings: () => void;
</script>

<div class="widget-surface">
  <MessageComposer
    {disabled}
    {running}
    on:send={onSend}
    on:stop={onStop}
    on:settings={onSettings}
  />
</div>
