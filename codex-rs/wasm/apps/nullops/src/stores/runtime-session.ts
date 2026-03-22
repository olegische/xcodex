import { get, writable } from "svelte/store";
import { composerStore } from "./composer";
import {
  bootstrapWebUi,
  clearSavedAuth,
  createInitialState,
  refreshAccountAndModelsFromDraft,
  resetCurrentThread,
  runTurnFromDraft,
  saveDraftProviderConfig,
  type DemoState,
  type ProviderDraft,
  type SendTurnResult,
} from "../runtime";

type RuntimeSessionState = {
  state: DemoState;
  providerDraft: ProviderDraft;
};

type RuntimeTurnOutcome = {
  state: DemoState;
  providerDraft: ProviderDraft;
  result: SendTurnResult;
};

const initialProviderDraft: ProviderDraft = {
  transportMode: "xrouter-browser",
  providerDisplayName: "DeepSeek via XRouter Browser",
  providerBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  xrouterProvider: "deepseek",
  modelReasoningEffort: "medium",
  personality: "pragmatic",
  model: "",
};

function createRuntimeSessionStore() {
  const { subscribe, set, update } = writable<RuntimeSessionState>({
    state: createInitialState(),
    providerDraft: initialProviderDraft,
  });

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    async initialize() {
      const boot = await bootstrapWebUi();
      set({
        state: boot.state,
        providerDraft: boot.providerDraft,
      });
      syncComposer(boot.providerDraft, boot.state.models);
      return boot;
    },
    syncDraftFromComposer(input: { selectedModelId: string; selectedReasoning: string }) {
      const session = get({ subscribe });
      const nextModel = input.selectedModelId.trim();
      const nextReasoning = input.selectedReasoning.trim();
      if (
        session.providerDraft.model === nextModel &&
        session.providerDraft.modelReasoningEffort === nextReasoning
      ) {
        return;
      }
      set({
        ...session,
        providerDraft: {
          ...session.providerDraft,
          model: nextModel,
          modelReasoningEffort: nextReasoning,
        },
      });
    },
    async saveConfig(nextDraft?: ProviderDraft) {
      const session = get({ subscribe });
      const providerDraft = nextDraft ?? session.providerDraft;
      const saved = await saveDraftProviderConfig(session.state.runtime, session.state, providerDraft);
      set(saved);
      syncComposer(saved.providerDraft, saved.state.models);
      return saved;
    },
    async refreshAccountAndModels(nextDraft?: ProviderDraft) {
      const session = get({ subscribe });
      const providerDraft = nextDraft ?? session.providerDraft;
      const refreshed = await refreshAccountAndModelsFromDraft(
        session.state.runtime,
        session.state,
        providerDraft,
      );
      set(refreshed);
      syncComposer(refreshed.providerDraft, refreshed.state.models);
      return refreshed;
    },
    async clearAuth() {
      const session = get({ subscribe });
      const cleared = await clearSavedAuth(session.state.runtime, session.state);
      set(cleared);
      syncComposer(cleared.providerDraft, cleared.state.models);
      return cleared;
    },
    async runTurn(message: string, turnCounter: number): Promise<RuntimeTurnOutcome> {
      const session = get({ subscribe });
      const runtime = requireRuntime(session.state);
      const outcome = await runTurnFromDraft(runtime, session.state, session.providerDraft, message, turnCounter);
      set({
        state: outcome.state,
        providerDraft: outcome.providerDraft,
      });
      composerStore.syncFromDraft({
        message: "",
        model: outcome.providerDraft.model,
        reasoning: outcome.providerDraft.modelReasoningEffort,
        models: outcome.state.models,
      });
      return outcome;
    },
    async resetThread() {
      const session = get({ subscribe });
      const runtime = requireRuntime(session.state);
      const nextState = await resetCurrentThread(runtime, session.state);
      update((current) => ({
        ...current,
        state: nextState,
      }));
      return nextState;
    },
    setError(message: string) {
      update((session) => ({
        ...session,
        state: {
          ...session.state,
          status: message,
          isError: true,
        },
      }));
    },
    setStatus(message: string, isError: boolean) {
      update((session) => ({
        ...session,
        state: {
          ...session.state,
          status: message,
          isError,
        },
      }));
    },
    setCancelledStatus() {
      update((session) => ({
        ...session,
        state: {
          ...session.state,
          status: "Turn cancelled.",
          isError: false,
        },
      }));
    },
  };
}

function requireRuntime(state: DemoState) {
  if (state.runtime === null) {
    throw new Error("Runtime has not loaded yet.");
  }
  return state.runtime;
}

function syncComposer(providerDraft: ProviderDraft, models: RuntimeSessionState["state"]["models"]) {
  composerStore.syncFromDraft({
    model: providerDraft.model,
    reasoning: providerDraft.modelReasoningEffort,
    models,
  });
}

export const runtimeSessionStore = createRuntimeSessionStore();
