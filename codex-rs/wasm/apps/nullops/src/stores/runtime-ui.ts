import { get, writable } from "svelte/store";
import { runtimeActivityFromEvent } from "../runtime/notifications";
import type { RuntimeActivity, RuntimeEvent, TranscriptEntry } from "../runtime";
import {
  appendLiveEvent,
  projectRuntimeLedger,
  sealActiveTurn,
  type ChatPhase,
  type FinalizedTurnSnapshot,
  type LiveTurnEvent,
} from "../runtime/chat-ledger";

export type RuntimeUiState = {
  activities: RuntimeActivity[];
  phase: ChatPhase;
  confirmedTranscript: TranscriptEntry[];
  liveEventLog: LiveTurnEvent[];
  finalizedSnapshots: FinalizedTurnSnapshot[];
  pendingUserMessage: TranscriptEntry | null;
  transcriptEntries: TranscriptEntry[];
  liveStreamText: string;
  activeRequestId: string | null;
  running: boolean;
  stopRequested: boolean;
  turnCounter: number;
};

const initialState: RuntimeUiState = {
  activities: [],
  phase: "idle",
  confirmedTranscript: [],
  liveEventLog: [],
  finalizedSnapshots: [],
  pendingUserMessage: null,
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
    observeRuntimeEvent(event: RuntimeEvent) {
      const activity = runtimeActivityFromEvent(event);
      if (activity === null) {
        return;
      }
      update((state) => {
        const activities = [...state.activities, activity].slice(-120);
        let nextState: RuntimeUiState = {
          ...state,
          activities,
        };

        if (activity.type === "turnStart") {
          nextState = {
            ...nextState,
            phase: "live",
            activeRequestId: activity.requestId,
            running: true,
            stopRequested: false,
            liveEventLog: [{ type: "turn_started", turnId: activity.requestId }],
            finalizedSnapshots: nextState.finalizedSnapshots.filter(
              (snapshot) => snapshot.turnId !== activity.requestId,
            ),
          };
          return projectRuntimeUiState(nextState);
        }

        if (
          nextState.activeRequestId === null ||
          !("requestId" in activity) ||
          activity.requestId !== nextState.activeRequestId
        ) {
          return projectRuntimeUiState(nextState);
        }

        switch (activity.type) {
          case "delta":
            nextState = mergeLedgerState(nextState, appendLiveEvent(nextState, {
              type: "assistant_delta",
              turnId: activity.requestId,
              delta: activity.text,
            }));
            break;
          case "assistantMessage":
            nextState = mergeLedgerState(nextState, appendLiveEvent(nextState, {
              type: "assistant_message",
              turnId: activity.requestId,
              text: stringifyActivityContent(activity.content),
            }));
            break;
          case "toolCall":
            nextState = mergeLedgerState(nextState, appendLiveEvent(nextState, {
              type: "tool_call_started",
              turnId: activity.requestId,
              callId: activity.callId,
              toolName: activity.toolName,
              argumentsText: normalizeOptionalText(stringifyActivityContent(activity.arguments)),
            }));
            break;
          case "toolOutput":
            nextState = mergeLedgerState(nextState, appendLiveEvent(nextState, {
              type: "tool_call_completed",
              turnId: activity.requestId,
              callId: activity.callId,
              outputText: normalizeOptionalText(stringifyActivityContent(activity.output)),
            }));
            break;
          case "completed":
            nextState = mergeLedgerState(nextState, appendLiveEvent(nextState, {
              type: "turn_completed",
              turnId: activity.requestId,
            }));
            nextState = mergeLedgerState(nextState, sealActiveTurn(nextState));
            break;
          case "error":
            nextState = mergeLedgerState(nextState, appendLiveEvent(nextState, {
              type: "turn_failed",
              turnId: activity.requestId,
              message: activity.message,
            }));
            nextState = {
              ...nextState,
              phase: "failed",
              running: false,
              stopRequested: false,
            };
            break;
          default:
            break;
        }

        return projectRuntimeUiState(nextState);
      });
    },
    beginManualTurn(message: string) {
      update((state) =>
        projectRuntimeUiState({
          ...state,
          phase: state.phase === "finalizing" ? "finalizing" : "idle",
          running: true,
          stopRequested: false,
          pendingUserMessage: {
            role: "user",
            text: message,
          },
        }),
      );
    },
    finalizeTranscript(finalTranscript: TranscriptEntry[], nextTurnCounter: number) {
      update((state) => {
        const activeTurnId = state.activeRequestId;
        const nextState: RuntimeUiState = {
          ...state,
          phase: "settled",
          confirmedTranscript: finalTranscript,
          liveEventLog: [],
          finalizedSnapshots:
            activeTurnId === null
              ? []
              : state.finalizedSnapshots.filter((snapshot) => snapshot.turnId !== activeTurnId),
          pendingUserMessage: null,
          running: false,
          activeRequestId: null,
          liveStreamText: "",
          stopRequested: false,
          turnCounter: nextTurnCounter,
        };
        return projectRuntimeUiState(nextState);
      });
    },
    markStopRequested() {
      update((state) => ({
        ...state,
        stopRequested: true,
      }));
    },
    markCancelled() {
      update((state) =>
        projectRuntimeUiState({
          ...state,
          phase: state.phase === "finalizing" ? "finalizing" : "failed",
          running: false,
          activeRequestId: null,
          stopRequested: false,
          liveEventLog: [],
          pendingUserMessage: null,
        }),
      );
    },
    resetThread() {
      update((state) => ({
        ...state,
        phase: "idle",
        activities: [],
        confirmedTranscript: [],
        liveEventLog: [],
        finalizedSnapshots: [],
        pendingUserMessage: null,
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

function projectRuntimeUiState(state: RuntimeUiState): RuntimeUiState {
  const projection = projectRuntimeLedger(state);
  return {
    ...state,
    transcriptEntries: projection.transcriptEntries,
    liveStreamText: projection.liveStreamText,
  };
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

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed === "null" ? null : trimmed;
}

function mergeLedgerState(state: RuntimeUiState, ledgerState: {
  phase: ChatPhase;
  confirmedTranscript: TranscriptEntry[];
  liveEventLog: LiveTurnEvent[];
  finalizedSnapshots: FinalizedTurnSnapshot[];
  pendingUserMessage: TranscriptEntry | null;
  activeRequestId: string | null;
  running: boolean;
  stopRequested: boolean;
  turnCounter: number;
}): RuntimeUiState {
  return {
    ...state,
    ...ledgerState,
  };
}

export const runtimeUiStore = createRuntimeUiStore();
