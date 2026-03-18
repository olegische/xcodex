import { get, writable } from "svelte/store";
import { applyUiSystem, loadUiSystem, subscribeUiSystem } from "../ui/system";
import type { UiSystemDocument } from "../ui/types";
import { DEFAULT_UI_LAYOUT } from "../ui/layout";
import { DEFAULT_UI_TOKENS } from "../ui/tokens";
import { DEFAULT_UI_VIEWS } from "../ui/views";
import { DEFAULT_UI_WIDGETS } from "../ui/widgets";
import { saveUiViewsDocument, setActiveUiView } from "../ui/views";

const initialUiSystem: UiSystemDocument = {
  tokens: structuredClone(DEFAULT_UI_TOKENS),
  views: structuredClone(DEFAULT_UI_VIEWS),
  layout: structuredClone(DEFAULT_UI_LAYOUT),
  widgets: structuredClone(DEFAULT_UI_WIDGETS),
  activeView: DEFAULT_UI_VIEWS.views[0] ?? null,
};

function createUiSystemStore() {
  const { subscribe, set, update } = writable<UiSystemDocument>(initialUiSystem);

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    async initialize() {
      const nextSystem = await loadUiSystem();
      set(nextSystem);
      applyUiSystem(nextSystem);
      return nextSystem;
    },
    subscribeToWorkspace(onUpdate?: (document: UiSystemDocument) => void): () => void {
      return subscribeUiSystem((nextSystem) => {
        set(nextSystem);
        applyUiSystem(nextSystem);
        onUpdate?.(nextSystem);
      });
    },
    apply() {
      applyUiSystem(get({ subscribe }));
    },
    async activateView(viewId: string) {
      const nextViews = setActiveUiView(get({ subscribe }).views, viewId);
      update((state) => {
        const activeView = nextViews.views.find((view) => view.id === nextViews.activeViewId) ?? nextViews.views[0] ?? null;
        const nextState = {
          ...state,
          views: nextViews,
          activeView,
        };
        applyUiSystem(nextState);
        return nextState;
      });
      await saveUiViewsDocument(nextViews);
      return nextViews;
    },
  };
}

export const uiSystemStore = createUiSystemStore();
