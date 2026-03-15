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
      if (activity.type === "toolCall" || activity.type === "toolOutput") {
        console.info("[webui] runtime-ui:observe-tool-activity", activity);
      }
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
          const nextTranscriptEntries = appendTranscriptEntry(
            state.transcriptEntries,
            formatToolCallEntry(activity),
          );
          console.info("[webui] runtime-ui:tool-call-entry", {
            beforeCount: state.transcriptEntries.length,
            afterCount: nextTranscriptEntries.length,
            entry: nextTranscriptEntries[nextTranscriptEntries.length - 1] ?? null,
          });
          return {
            ...state,
            activities,
            transcriptEntries: nextTranscriptEntries,
          };
        }
        if (activity.type === "toolOutput") {
          const nextTranscriptEntries = mergeToolOutputEntry(
            state.transcriptEntries,
            activity,
          );
          console.info("[webui] runtime-ui:tool-output-entry", {
            beforeCount: state.transcriptEntries.length,
            afterCount: nextTranscriptEntries.length,
            entry:
              nextTranscriptEntries.findLast(
                (entry) => entry.role === "tool" && entry.callId === activity.callId,
              ) ??
              nextTranscriptEntries[nextTranscriptEntries.length - 1] ??
              null,
          });
          return {
            ...state,
            activities,
            transcriptEntries: nextTranscriptEntries,
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

function formatToolCall(activity: Extract<RuntimeActivity, { type: "toolCall" }>): string {
  const toolName = activity.toolName ?? "tool";
  const argumentsText = stringifyActivityContent(activity.arguments);
  if (argumentsText.length === 0 || argumentsText === "null") {
    return `Calling ${toolName}`;
  }
  return `Calling ${toolName}\n${argumentsText}`;
}

function formatToolOutput(activity: Extract<RuntimeActivity, { type: "toolOutput" }>): string {
  const outputText = stringifyActivityContent(activity.output);
  if (outputText.length === 0 || outputText === "null") {
    return "Tool result received";
  }
  return `Tool result\n${outputText}`;
}

function formatToolCallEntry(
  activity: Extract<RuntimeActivity, { type: "toolCall" }>,
): TranscriptEntry {
  const summary = `Using ${activity.toolName ?? "tool"}`;
  const details = stringifyActivityContent(activity.arguments);
  return {
    role: "tool",
    summary,
    details: details.length > 0 && details !== "null" ? details : null,
    text: formatToolCall(activity),
    callId: activity.callId,
  };
}

function mergeToolOutputEntry(
  transcript: TranscriptEntry[],
  activity: Extract<RuntimeActivity, { type: "toolOutput" }>,
): TranscriptEntry[] {
  const details = stringifyActivityContent(activity.output);
  const resultText = details.length > 0 && details !== "null" ? details : null;
  if (resultText === null) {
    return transcript;
  }

  const nextTranscript = [...transcript];
  const matchingIndex = nextTranscript.findLastIndex(
    (entry) => entry.role === "tool" && entry.callId === activity.callId,
  );
  const fallbackIndex = nextTranscript.findLastIndex((entry) => entry.role === "tool");
  const targetIndex = matchingIndex >= 0 ? matchingIndex : fallbackIndex;

  if (targetIndex < 0) {
    return appendTranscriptEntry(nextTranscript, {
      role: "tool",
      summary: "Tool result",
      details: `Result\n${resultText}`,
      text: formatToolOutput(activity),
      callId: activity.callId,
    });
  }

  const targetEntry = nextTranscript[targetIndex];
  const nextDetails = appendToolResultDetails(targetEntry.details ?? null, resultText);
  nextTranscript[targetIndex] = {
    ...targetEntry,
    details: nextDetails,
    text: [targetEntry.summary ?? targetEntry.text, nextDetails].filter(Boolean).join("\n"),
  };
  return nextTranscript;
}

function appendToolResultDetails(details: string | null, resultText: string): string {
  const resultSection = `Result\n${resultText}`;
  if (details === null || details.trim().length === 0) {
    return resultSection;
  }
  if (details.includes(resultSection)) {
    return details;
  }
  return `${details}\n\n${resultSection}`;
}

export const runtimeUiStore = createRuntimeUiStore();
