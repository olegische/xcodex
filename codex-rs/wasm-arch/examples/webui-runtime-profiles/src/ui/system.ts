import { ensureUiDashboardsDocument, subscribeUiDashboards } from "./dashboards";
import { ensureUiLayoutDocument, subscribeUiLayout } from "./layout";
import { ensureUiProfilesDocument, subscribeUiProfiles } from "./profiles";
import { applyThemeTokens, ensureUiTokensDocument, subscribeUiTokens } from "./tokens";
import { ensureUiViewsDocument, subscribeUiViews } from "./views";
import { ensureUiWidgetsDocument, subscribeUiWidgets } from "./widgets";
import { resolveActiveUiProfile } from "./profiles";
import type { UiSystemDocument } from "./types";

export async function loadUiSystem(): Promise<UiSystemDocument> {
  const [tokens, profiles, views, dashboards, layout, widgets] = await Promise.all([
    ensureUiTokensDocument(),
    ensureUiProfilesDocument(),
    ensureUiViewsDocument(),
    ensureUiDashboardsDocument(),
    ensureUiLayoutDocument(),
    ensureUiWidgetsDocument(),
  ]);
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

  const unsubscribeWorkspace = subscribeUiTokens(() => {
    void emit();
  });

  const unsubscribers = [
    unsubscribeWorkspace,
    subscribeUiProfiles(() => {
      void emit();
    }),
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
  const profile = resolveActiveUiProfile(document.profiles);
  const themeTokens = document.tokens.themes[profile.theme] ?? document.tokens.themes.dark ?? {};
  applyThemeTokens(profile.theme, {
    ...themeTokens,
    ...profile.tokens,
  });
}
