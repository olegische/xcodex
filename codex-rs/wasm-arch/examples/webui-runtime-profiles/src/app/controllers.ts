import { composerStore } from "../stores/composer";
import { runtimeSessionStore } from "../stores/runtime-session";

export function connectComposerSessionSync(): () => void {
  const unsubscribeSession = runtimeSessionStore.subscribe((session) => {
    composerStore.syncModels(session.state.models);
  });

  const unsubscribeComposer = composerStore.subscribe((composerState) => {
    runtimeSessionStore.syncDraftFromComposer({
      selectedModelId: composerState.selectedModelId,
      selectedReasoning: composerState.selectedReasoning,
    });
  });

  return () => {
    unsubscribeSession();
    unsubscribeComposer();
  };
}
