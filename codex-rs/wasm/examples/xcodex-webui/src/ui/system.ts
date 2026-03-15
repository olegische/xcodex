import { ensureUiDashboardsDocument, subscribeUiDashboards } from "./dashboards";
import { ensureUiLayoutDocument, subscribeUiLayout } from "./layout";
import { DEFAULT_UI_PROFILES, resolveActiveUiProfile } from "./profiles";
import { applyThemeTokens, DEFAULT_UI_TOKENS } from "./tokens";
import { ensureUiViewsDocument, subscribeUiViews } from "./views";
import { ensureUiWidgetsDocument, subscribeUiWidgets } from "./widgets";
import type { UiSystemDocument } from "./types";

export async function loadUiSystem(): Promise<UiSystemDocument> {
  const [views, dashboards, layout, widgets] = await Promise.all([
    ensureUiViewsDocument(),
    ensureUiDashboardsDocument(),
    ensureUiLayoutDocument(),
    ensureUiWidgetsDocument(),
  ]);
  const tokens = structuredClone(DEFAULT_UI_TOKENS);
  const profiles = structuredClone(DEFAULT_UI_PROFILES);
  const activeView = views.views.find((view) => view.id === views.activeViewId) ?? views.views[0] ?? null;
  const activeDashboard =
    dashboards.dashboards.find((dashboard) => dashboard.id === activeView?.dashboardId) ?? dashboards.dashboards[0] ?? null;
  return {
    tokens,
    profiles,
    views,
    dashboards,
    layout: activeDashboard?.layout ?? layout,
    widgets: activeDashboard?.widgets ?? widgets,
    activeView,
    activeDashboard,
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
    subscribeUiDashboards(() => {
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
  const profile = resolveActiveUiProfile(DEFAULT_UI_PROFILES);
  const themeTokens = DEFAULT_UI_TOKENS.themes.dark ?? {};
  applyThemeTokens(profile.theme, themeTokens);
}
