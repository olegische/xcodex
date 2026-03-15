import { get, writable } from "svelte/store";
import { createUiProfile, deleteActiveUiProfile, saveUiProfilesDocument, setActiveUiProfile, updateActiveUiProfile, type UiProfile } from "../ui/profiles";
import { applyUiSystem, loadUiSystem, subscribeUiSystem } from "../ui/system";
import type { UiSystemDocument } from "../ui/types";
import { DEFAULT_UI_DASHBOARDS } from "../ui/dashboards";
import { DEFAULT_UI_LAYOUT } from "../ui/layout";
import { DEFAULT_UI_PROFILES } from "../ui/profiles";
import { DEFAULT_UI_TOKENS } from "../ui/tokens";
import { DEFAULT_UI_VIEWS } from "../ui/views";
import { DEFAULT_UI_WIDGETS } from "../ui/widgets";
import { saveUiViewsDocument, setActiveUiView } from "../ui/views";

const initialUiSystem: UiSystemDocument = {
  tokens: structuredClone(DEFAULT_UI_TOKENS),
  profiles: structuredClone(DEFAULT_UI_PROFILES),
  views: structuredClone(DEFAULT_UI_VIEWS),
  dashboards: structuredClone(DEFAULT_UI_DASHBOARDS),
  layout: structuredClone(DEFAULT_UI_LAYOUT),
  widgets: structuredClone(DEFAULT_UI_WIDGETS),
  activeView: DEFAULT_UI_VIEWS.views[0] ?? null,
  activeDashboard: DEFAULT_UI_DASHBOARDS.dashboards[0] ?? null,
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
    async createProfile() {
      const nextProfiles = createUiProfile(get({ subscribe }).profiles);
      update((state) => {
        const nextState = { ...state, profiles: nextProfiles };
        applyUiSystem(nextState);
        return nextState;
      });
      await saveUiProfilesDocument(nextProfiles);
      return nextProfiles;
    },
    async saveProfile(profile: UiProfile) {
      const nextProfiles = updateActiveUiProfile(get({ subscribe }).profiles, profile);
      update((state) => {
        const nextState = { ...state, profiles: nextProfiles };
        applyUiSystem(nextState);
        return nextState;
      });
      await saveUiProfilesDocument(nextProfiles);
      return nextProfiles;
    },
    async activateProfile(profileId: string) {
      const nextProfiles = setActiveUiProfile(get({ subscribe }).profiles, profileId);
      update((state) => {
        const nextState = { ...state, profiles: nextProfiles };
        applyUiSystem(nextState);
        return nextState;
      });
      await saveUiProfilesDocument(nextProfiles);
      return nextProfiles;
    },
    async deleteActiveProfile() {
      const nextProfiles = deleteActiveUiProfile(get({ subscribe }).profiles);
      update((state) => {
        const nextState = { ...state, profiles: nextProfiles };
        applyUiSystem(nextState);
        return nextState;
      });
      await saveUiProfilesDocument(nextProfiles);
      return nextProfiles;
    },
    async activateView(viewId: string) {
      const nextViews = setActiveUiView(get({ subscribe }).views, viewId);
      update((state) => {
        const activeView = nextViews.views.find((view) => view.id === nextViews.activeViewId) ?? nextViews.views[0] ?? null;
        const activeDashboard =
          state.dashboards.dashboards.find((dashboard) => dashboard.id === activeView?.dashboardId) ??
          state.dashboards.dashboards[0] ??
          null;
        const nextState = {
          ...state,
          views: nextViews,
          activeView,
          activeDashboard,
          layout: activeDashboard?.layout ?? state.layout,
          widgets: activeDashboard?.widgets ?? state.widgets,
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
