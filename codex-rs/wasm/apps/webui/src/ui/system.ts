import { ensureUiLayoutDocument, subscribeUiLayout } from "./layout";
import { applyThemeTokens, DEFAULT_UI_TOKENS } from "./tokens";
import { ensureUiViewsDocument, subscribeUiViews } from "./views";
import { ensureUiWidgetsDocument, subscribeUiWidgets } from "./widgets";
import type { UiSystemDocument } from "./types";

export async function loadUiSystem(): Promise<UiSystemDocument> {
  const [views, layout, widgets] = await Promise.all([
    ensureUiViewsDocument(),
    ensureUiLayoutDocument(),
    ensureUiWidgetsDocument(),
  ]);
  const tokens = structuredClone(DEFAULT_UI_TOKENS);
  const activeView = views.views.find((view) => view.id === views.activeViewId) ?? views.views[0] ?? null;
  return {
    tokens,
    views,
    layout,
    widgets,
    activeView,
  };
}

export function subscribeUiSystem(listener: (document: UiSystemDocument) => void): () => void {
  let revision = 0;
  let disposed = false;

  const emit = async () => {
    const currentRevision = revision + 1;
    revision = currentRevision;
    const nextState = await loadUiSystem();
    if (disposed || currentRevision !== revision) {
      return;
    }
    listener(nextState);
  };

  void emit();

  const unsubscribers = [
    subscribeUiViews(() => {
      void emit();
    }),
    subscribeUiLayout(() => {
      void emit();
    }),
    subscribeUiWidgets(() => {
      void emit();
    }),
  ];
  return () => {
    disposed = true;
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

export function applyUiSystem(document: UiSystemDocument): void {
  const themeTokens = DEFAULT_UI_TOKENS.themes.dark ?? {};
  applyThemeTokens("dark", themeTokens);
}
