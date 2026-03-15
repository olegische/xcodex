import { get, writable } from "svelte/store";
import type { RuntimeActivity, TranscriptEntry } from "../runtime";

export type RuntimeUiState = {
  activities: RuntimeActivity[];
  transcriptEntries: TranscriptEntry[];
  liveStreamText: string;
  activeRequestId: string | null;
  running: boolean;
  stopRequested: boolean;
  turnCounter: number;
};

const initialState: RuntimeUiState = {
  activities: [],
  transcriptEntries: [],
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
            transcriptEntries: appendTranscriptEntry(state.transcriptEntries, {
              role: "assistant",
              text: stringifyActivityContent(activity.content),
            }),
            liveStreamText: "",
          };
        }
        if (activity.type === "toolCall") {
          return {
            ...state,
            activities,
            transcriptEntries: appendTranscriptEntry(state.transcriptEntries, {
              role: "tool",
              text: `Using ${activity.toolName ?? "tool"}`,
            }),
          };
        }
        if (activity.type === "toolOutput") {
          return {
            ...state,
            activities,
            transcriptEntries: appendTranscriptEntry(state.transcriptEntries, {
              role: "tool",
              text: stringifyActivityContent(activity.output),
            }),
          };
        }
        if (activity.type === "completed") {
          return {
            ...state,
            activities,
          };
        }
        return {
          ...state,
          activities,
        };
      });
    },
    beginManualTurn(message: string) {
      update((state) => ({
        ...state,
        running: true,
        stopRequested: false,
        transcriptEntries: appendTranscriptEntry([], {
          role: "user",
          text: message,
        }),
        liveStreamText: "",
      }));
    },
    completeTurn(nextTurnCounter: number) {
      update((state) => ({
        ...state,
        running: false,
        activeRequestId: null,
        transcriptEntries: [],
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
        transcriptEntries: [],
        liveStreamText: "",
        turnCounter: 1,
        activeRequestId: null,
        running: false,
        stopRequested: false,
      }));
    },
  };
}

function appendTranscriptEntry(
  transcript: TranscriptEntry[],
  nextEntry: TranscriptEntry,
): TranscriptEntry[] {
  const text = nextEntry.text.trim();
  if (text.length === 0) {
    return transcript;
  }
  return [...transcript, { ...nextEntry, text }];
}

function stringifyActivityContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

export const runtimeUiStore = createRuntimeUiStore();
