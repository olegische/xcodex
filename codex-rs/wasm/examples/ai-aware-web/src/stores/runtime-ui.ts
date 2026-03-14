import { get, writable } from "svelte/store";
import type { RuntimeActivity } from "../runtime";

export type RuntimeUiState = {
  activities: RuntimeActivity[];
  liveStreamText: string;
  activeRequestId: string | null;
  running: boolean;
  stopRequested: boolean;
  turnCounter: number;
};

const initialState: RuntimeUiState = {
  activities: [],
  liveStreamText: "",
  activeRequestId: null,
  running: false,
  stopRequested: false,
  turnCounter: 1,
};

function createRuntimeUiStore() {
  const { subscribe, update, set } = writable<RuntimeUiState>(initialState);

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    reset() {
      set(initialState);
    },
    observeActivity(activity: RuntimeActivity) {
      update((state) => {
        const activities = [...state.activities, activity].slice(-120);
        if (activity.type === "turnStart") {
          return {
            ...state,
            activities,
            activeRequestId: activity.requestId.split(":")[0] ?? activity.requestId,
            running: true,
            liveStreamText: activity.requestId.includes(":") ? state.liveStreamText : "",
          };
        }
        if (activity.type === "delta") {
          return {
            ...state,
            activities,
            liveStreamText: state.liveStreamText + activity.text,
          };
        }
        if (activity.type === "assistantMessage") {
          return {
            ...state,
            activities,
            liveStreamText: "",
          };
        }
        if (activity.type === "completed") {
          return {
            ...state,
            activities,
            liveStreamText: "",
          };
        }
        return {
          ...state,
          activities,
        };
      });
    },
    beginManualTurn() {
      update((state) => ({
        ...state,
        running: true,
        stopRequested: false,
        liveStreamText: "",
      }));
    },
    completeTurn(nextTurnCounter: number) {
      update((state) => ({
        ...state,
        running: false,
        activeRequestId: null,
        liveStreamText: "",
        stopRequested: false,
        turnCounter: nextTurnCounter,
      }));
    },
    markStopRequested() {
      update((state) => ({
        ...state,
        stopRequested: true,
      }));
    },
    markCancelled() {
      update((state) => ({
        ...state,
        running: false,
        activeRequestId: null,
        stopRequested: false,
      }));
    },
    resetThread() {
      update((state) => ({
        ...state,
        activities: [],
        liveStreamText: "",
        turnCounter: 1,
        activeRequestId: null,
        running: false,
        stopRequested: false,
      }));
    },
  };
}

export const runtimeUiStore = createRuntimeUiStore();
