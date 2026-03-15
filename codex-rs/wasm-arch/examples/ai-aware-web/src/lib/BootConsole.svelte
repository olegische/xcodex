<script lang="ts">
  import type { BootState, BootStep } from "../stores/boot";

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

  function currentStep(): BootStep | null {
    const activeStep = bootState.steps.find((step) => step.status === "active");
    if (activeStep) {
      return activeStep;
    }
    const errorStep = bootState.steps.find((step) => step.status === "error");
    if (errorStep) {
      return errorStep;
    }
    const completedSteps = bootState.steps.filter((step) => step.status === "done");
    return completedSteps[completedSteps.length - 1] ?? null;
  }

  $: stage = currentStep();
</script>

<section class:error={bootState.phase === "error"} class="boot-console">
  <div class="boot-console-panel">
    <div class="boot-console-stage">
      <div class="eyebrow">Boot Sequence</div>
      <strong>{bootState.phase === "error" ? "Boot failed" : bootState.message}</strong>

      {#if stage !== null}
        <div class={`boot-stage-card ${stepTone(stage.status)}`}>
          <div class="boot-stage-meta">
            <span class="boot-stage-label">{stage.label}</span>
            <span class="chip ghost">{stage.status}</span>
          </div>
          <div class="boot-stage-detail">{stage.detail}</div>
        </div>
      {/if}
    </div>

    {#if bootState.errorDetail !== null}
      <pre class="boot-console-error">{bootState.errorDetail}</pre>
    {/if}
  </div>
</section>
