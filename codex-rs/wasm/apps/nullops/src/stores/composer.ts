import { derived, get, writable } from "svelte/store";
import type { ModelPreset } from "../runtime";

type ComposerState = {
  message: string;
  selectedModelId: string;
  selectedReasoning: string;
  models: ModelPreset[];
};

const initialState: ComposerState = {
  message: "",
  selectedModelId: "",
  selectedReasoning: "medium",
  models: [],
};

function createComposerStore() {
  const { subscribe, update, set } = writable<ComposerState>(initialState);

  return {
    subscribe,
    reset() {
      set(initialState);
    },
    setMessage(message: string) {
      update((state) => ({ ...state, message }));
    },
    setSelectedModel(selectedModelId: string) {
      update((state) => ({ ...state, selectedModelId }));
    },
    setSelectedReasoning(selectedReasoning: string) {
      update((state) => ({ ...state, selectedReasoning }));
    },
    syncModels(models: ModelPreset[]) {
      const state = get({ subscribe });
      const selectedModelId = resolveSelectedModelId(state.selectedModelId, models);
      if (state.selectedModelId === selectedModelId && sameModels(state.models, models)) {
        return;
      }
      set({
        ...state,
        models,
        selectedModelId,
      });
    },
    syncFromDraft(input: { message?: string; model?: string; reasoning?: string; models?: ModelPreset[] }) {
      const state = get({ subscribe });
      const models = input.models ?? state.models;
      const selectedModelId = resolveSelectedModelId(input.model ?? state.selectedModelId, models);
      const selectedReasoning = normalizeReasoning(input.reasoning ?? state.selectedReasoning);
      const message = input.message ?? state.message;
      if (
        state.message === message &&
        state.selectedModelId === selectedModelId &&
        state.selectedReasoning === selectedReasoning &&
        sameModels(state.models, models)
      ) {
        return;
      }
      set({
        message,
        selectedModelId,
        selectedReasoning,
        models,
      });
    },
    snapshot() {
      return get({ subscribe });
    },
  };
}

export const composerStore = createComposerStore();

export const composerLabelState = derived(composerStore, ($composerStore) => {
  const selectedModel = $composerStore.models.find((model) => model.id === $composerStore.selectedModelId);
  return {
    modelLabel: selectedModel?.displayName || $composerStore.selectedModelId || "Select model",
    reasoningLabel: labelForReasoning($composerStore.selectedReasoning),
  };
});

function resolveSelectedModelId(currentModelId: string, models: ModelPreset[]): string {
  const trimmedCurrentModel = currentModelId.trim();
  if (trimmedCurrentModel.length > 0 && models.some((model) => model.id === trimmedCurrentModel)) {
    return trimmedCurrentModel;
  }
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? "";
}

function sameModels(left: ModelPreset[], right: ModelPreset[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (model, index) =>
      model.id === right[index]?.id &&
      model.displayName === right[index]?.displayName &&
      model.isDefault === right[index]?.isDefault,
  );
}

function normalizeReasoning(reasoning: string): string {
  return ["low", "medium", "high"].includes(reasoning) ? reasoning : "medium";
}

function labelForReasoning(reasoning: string): string {
  switch (normalizeReasoning(reasoning)) {
    case "low":
      return "Low";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    default:
      return "Medium";
  }
}
