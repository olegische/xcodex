<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { CollaborationRequest } from "../stores/collaboration";

  const dispatch = createEventDispatcher<{
    cancel: void;
    submit: Array<{ id: string; value: string }>;
  }>();

  export let request: CollaborationRequest | null = null;

  let selectedValues: Record<string, string> = {};

  $: singleQuestion = request?.questions.length === 1 ? request.questions[0] : null;
  $: singleQuestionOptions = singleQuestion?.options ?? [];

  $: if (request !== null) {
    selectedValues = Object.fromEntries(
      request.questions.map((question) => [question.id, selectedValues[question.id] ?? ""]),
    );
  }

  $: canSubmit =
    request !== null &&
    request.questions.every((question) => selectedValues[question.id]?.trim().length > 0);

  function submitAnswers() {
    if (request === null || !canSubmit) {
      return;
    }
    dispatch(
      "submit",
      request.questions.map((question) => ({
        id: question.id,
        value: selectedValues[question.id] ?? "",
      })),
    );
  }

  function submitSingleAnswer(questionId: string, value: string) {
    dispatch("submit", [{ id: questionId, value }]);
  }
</script>

{#if request !== null}
  <div class="overlay collaboration-overlay">
    <section class="modal-card collaboration-card" role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <div>
          <div class="eyebrow">Approval</div>
          <h3>{request.title}</h3>
        </div>
        <button class="button ghost" type="button" on:click={() => dispatch("cancel")}>Close</button>
      </div>

      <div class="collaboration-body">
        {#if singleQuestion !== null}
          <section class="collaboration-question">
            <p class="collaboration-question-text">{singleQuestion.question}</p>
          </section>
        {:else}
          {#each request.questions as question}
            <section class="collaboration-question">
              <div class="event-type">{question.header}</div>
              <p class="collaboration-question-text">{question.question}</p>
              <div class="collaboration-options">
                {#each question.options as option}
                  <button
                    class:selected={selectedValues[question.id] === option.label}
                    class="button ghost collaboration-option"
                    type="button"
                    on:click={() => {
                      selectedValues = {
                        ...selectedValues,
                        [question.id]: option.label,
                      };
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        {/if}
      </div>

      <div class="modal-actions">
        {#if singleQuestion !== null}
          {#each singleQuestionOptions as option, index}
            <button
              class:primary={index === 0}
              class="button {index === 0 ? 'primary' : 'ghost'}"
              type="button"
              on:click={() => submitSingleAnswer(singleQuestion.id, option.label)}
            >
              {option.label}
            </button>
          {/each}
        {:else}
          <button class="button ghost" type="button" on:click={() => dispatch("cancel")}>
            Cancel
          </button>
          <button class="button primary" type="button" disabled={!canSubmit} on:click={submitAnswers}>
            Continue
          </button>
        {/if}
      </div>
    </section>
  </div>
{/if}
