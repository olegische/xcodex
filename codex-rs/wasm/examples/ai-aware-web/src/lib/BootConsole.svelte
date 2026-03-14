<script lang="ts">
  import type { BootState } from "../stores/boot";

  export let bootState: BootState;

  function stepTone(status: string) {
    if (status === "done") {
      return "success";
    }
    if (status === "error") {
      return "warning";
    }
    if (status === "active") {
      return "active";
    }
    return "pending";
  }
</script>

<section class:error={bootState.phase === "error"} class="boot-console">
  <div class="boot-console-header">
    <div>
      <div class="eyebrow">Boot Sequence</div>
      <strong>{bootState.phase === "error" ? "Boot failed" : bootState.message}</strong>
    </div>
    <span class:warning={bootState.phase === "error"} class="status-tag">
      {bootState.phase}
    </span>
  </div>

  <div class="boot-console-steps">
    {#each bootState.steps as step}
      <div class={`boot-step ${stepTone(step.status)}`}>
        <div class="boot-step-title">
          <span>{step.label}</span>
          <span class="chip ghost">{step.status}</span>
        </div>
        <div class="card-footnote">{step.detail}</div>
      </div>
    {/each}
  </div>

  {#if bootState.errorDetail !== null}
    <pre class="boot-console-error">{bootState.errorDetail}</pre>
  {/if}
</section>
