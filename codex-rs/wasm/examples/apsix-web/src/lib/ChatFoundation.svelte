<script lang="ts">
  import ComposerWidget from "./widgets/ComposerWidget.svelte";
  import TranscriptWidget from "./widgets/TranscriptWidget.svelte";
  import type { TranscriptEntry } from "../runtime";

  export let transcript: TranscriptEntry[] = [];
  export let liveStreamText = "";
  export let status = "";
  export let running = false;
  export let disabled = false;
  export let onSend: () => void;
  export let onStop: () => void;
  export let onSettings: () => void;
</script>

<div class="chat-foundation">
  <div class="chat-foundation-transcript-layer">
    <div class="chat-foundation-transcript-shell">
      <TranscriptWidget {transcript} {liveStreamText} {status} {running} />
    </div>
  </div>

  <div class="chat-foundation-composer-layer">
    <div class="chat-foundation-composer-shell">
      <ComposerWidget {disabled} {running} {onSend} {onStop} {onSettings} />
    </div>
  </div>
</div>
