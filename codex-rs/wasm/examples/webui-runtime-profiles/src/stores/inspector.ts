import { get, writable } from "svelte/store";
import type { InspectorTab, InspectorMode } from "../ui/types";

export type InspectorState = {
  activeTab: InspectorTab;
  showEvents: boolean;
  showApprovals: boolean;
  sidebarOpen: boolean;
  showSettings: boolean;
  showProfiles: boolean;
};

const initialState: InspectorState = {
  activeTab: "metrics",
  showEvents: false,
  showApprovals: false,
  sidebarOpen: true,
  showSettings: false,
  showProfiles: false,
};

function createInspectorStore() {
  const { subscribe, update, set } = writable<InspectorState>(initialState);

  return {
    subscribe,
    reset() {
      set(initialState);
    },
    snapshot() {
      return get({ subscribe });
    },
    setDefaultTab(activeTab: InspectorTab) {
      update((state) => ({ ...state, activeTab }));
    },
    toggleInspectorTab(activeTab: InspectorTab, inspectorMode: InspectorMode) {
      update((state) => {
        if (inspectorMode !== "drawer") {
          return {
            ...state,
            activeTab,
          };
        }

        if (activeTab === "events") {
          const showEvents = !state.showEvents;
          return {
            ...state,
            activeTab,
            showEvents,
            showApprovals: showEvents ? false : state.showApprovals,
          };
        }

        if (activeTab === "approvals") {
          const showApprovals = !state.showApprovals;
          return {
            ...state,
            activeTab,
            showApprovals,
            showEvents: showApprovals ? false : state.showEvents,
          };
        }

        return {
          ...state,
          activeTab,
          showEvents: false,
          showApprovals: false,
        };
      });
    },
    toggleEvents(inspectorMode: InspectorMode) {
      this.toggleInspectorTab("events", inspectorMode);
    },
    toggleApprovals(inspectorMode: InspectorMode) {
      this.toggleInspectorTab("approvals", inspectorMode);
    },
    toggleSidebar() {
      update((state) => ({ ...state, sidebarOpen: !state.sidebarOpen }));
    },
    openSettings() {
      update((state) => ({ ...state, showSettings: true }));
    },
    closeSettings() {
      update((state) => ({ ...state, showSettings: false }));
    },
    openProfiles() {
      update((state) => ({ ...state, showProfiles: true }));
    },
    closeProfiles() {
      update((state) => ({ ...state, showProfiles: false }));
    },
    closeEvents() {
      update((state) => ({ ...state, showEvents: false }));
    },
    closeApprovals() {
      update((state) => ({ ...state, showApprovals: false }));
    },
  };
}

export const inspectorStore = createInspectorStore();
