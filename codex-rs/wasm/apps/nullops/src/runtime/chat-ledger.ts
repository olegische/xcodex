import type { TranscriptEntry } from "./types";

export type ChatPhase = "idle" | "live" | "finalizing" | "settled" | "failed";

export type LiveTurnEvent =
  | { type: "turn_started"; turnId: string }
  | { type: "assistant_delta"; turnId: string; delta: string }
  | { type: "assistant_message"; turnId: string; text: string }
  | { type: "tool_call_started"; turnId: string; callId: string | null; toolName: string | null; argumentsText: string | null }
  | { type: "tool_call_completed"; turnId: string; callId: string | null; outputText: string | null }
  | { type: "turn_completed"; turnId: string }
  | { type: "turn_failed"; turnId: string; message: string };

export type FinalizedTurnSnapshot = {
  turnId: string;
  transcriptEntries: TranscriptEntry[];
  liveStreamText: string;
};

export type RuntimeLedgerState = {
  phase: ChatPhase;
  confirmedTranscript: TranscriptEntry[];
  liveEventLog: LiveTurnEvent[];
  finalizedSnapshots: FinalizedTurnSnapshot[];
  pendingUserMessage: TranscriptEntry | null;
  activeRequestId: string | null;
  running: boolean;
  stopRequested: boolean;
  turnCounter: number;
};

export type RuntimeLedgerProjection = {
  transcriptEntries: TranscriptEntry[];
  liveStreamText: string;
};

export function appendLiveEvent(state: RuntimeLedgerState, event: LiveTurnEvent): RuntimeLedgerState {
  return {
    ...state,
    liveEventLog: [...state.liveEventLog, event],
  };
}

export function sealActiveTurn(state: RuntimeLedgerState): RuntimeLedgerState {
  if (state.activeRequestId === null) {
    return state;
  }
  const projection = projectLiveTurn(state.liveEventLog);
  const snapshot: FinalizedTurnSnapshot = {
    turnId: state.activeRequestId,
    transcriptEntries: projection.transcriptEntries,
    liveStreamText: projection.liveStreamText,
  };
  return {
    ...state,
    phase: "finalizing",
    finalizedSnapshots: [
      ...state.finalizedSnapshots.filter((entry) => entry.turnId !== state.activeRequestId),
      snapshot,
    ],
    running: false,
    stopRequested: false,
  };
}

export function projectRuntimeLedger(state: RuntimeLedgerState): RuntimeLedgerProjection {
  const historicalTranscript = [...state.confirmedTranscript];
  const pendingUser = state.pendingUserMessage === null ? [] : [state.pendingUserMessage];

  if (state.phase === "live") {
    const liveProjection = projectLiveTurn(state.liveEventLog);
    return {
      transcriptEntries: [...historicalTranscript, ...pendingUser, ...liveProjection.transcriptEntries],
      liveStreamText: liveProjection.liveStreamText,
    };
  }

  if (state.phase === "finalizing") {
    const snapshot =
      state.activeRequestId === null
        ? state.finalizedSnapshots[state.finalizedSnapshots.length - 1] ?? null
        : findFinalizedSnapshot(state.finalizedSnapshots, state.activeRequestId);
    return {
      transcriptEntries: [...historicalTranscript, ...pendingUser, ...(snapshot?.transcriptEntries ?? [])],
      liveStreamText: snapshot?.liveStreamText ?? "",
    };
  }

  if (state.phase === "failed") {
    const liveProjection = projectLiveTurn(state.liveEventLog);
    return {
      transcriptEntries: [...historicalTranscript, ...pendingUser, ...liveProjection.transcriptEntries],
      liveStreamText: liveProjection.liveStreamText,
    };
  }

  return {
    transcriptEntries: [...historicalTranscript],
    liveStreamText: "",
  };
}

export function projectLiveTurn(events: LiveTurnEvent[]): RuntimeLedgerProjection {
  const transcriptEntries: TranscriptEntry[] = [];
  let liveStreamText = "";

  for (const event of events) {
    switch (event.type) {
      case "turn_started":
      case "turn_completed":
        break;
      case "assistant_delta":
        liveStreamText += event.delta;
        break;
      case "assistant_message":
        appendTranscriptEntry(transcriptEntries, {
          role: "assistant",
          text: event.text,
        });
        liveStreamText = "";
        break;
      case "tool_call_started":
        appendTranscriptEntry(
          transcriptEntries,
          formatToolCallEntry(event.callId, event.toolName, event.argumentsText),
        );
        break;
      case "tool_call_completed":
        mergeToolOutputEntry(transcriptEntries, event.callId, event.outputText);
        break;
      case "turn_failed":
        if (event.message.trim().length > 0) {
          appendTranscriptEntry(transcriptEntries, {
            role: "tool",
            summary: "Error",
            details: event.message,
            text: event.message,
            callId: null,
          });
        }
        break;
    }
  }

  if (liveStreamText.trim().length > 0) {
    appendTranscriptEntry(transcriptEntries, {
      role: "assistant",
      text: liveStreamText,
    });
  }

  return {
    transcriptEntries,
    liveStreamText,
  };
}

function appendTranscriptEntry(transcript: TranscriptEntry[], nextEntry: TranscriptEntry): void {
  const text = nextEntry.text.trim();
  if (text.length === 0) {
    return;
  }
  transcript.push({
    ...nextEntry,
    text,
  });
}

function formatToolCallEntry(
  callId: string | null,
  toolName: string | null,
  argumentsText: string | null,
): TranscriptEntry {
  const summary = `Using ${toolName ?? "tool"}`;
  const details = argumentsText === null ? null : argumentsText;
  return {
    role: "tool",
    summary,
    details,
    text: details === null ? summary : `${summary}\n${details}`,
    callId,
  };
}

function mergeToolOutputEntry(
  transcript: TranscriptEntry[],
  callId: string | null,
  outputText: string | null,
): void {
  if (outputText === null) {
    return;
  }

  const targetIndex = findLastToolIndex(transcript, callId);
  if (targetIndex < 0) {
    appendTranscriptEntry(transcript, {
      role: "tool",
      summary: "Tool result",
      details: `Result\n${outputText}`,
      text: `Tool result\n${outputText}`,
      callId,
    });
    return;
  }

  const targetEntry = transcript[targetIndex];
  const nextDetails = appendToolResultDetails(targetEntry.details ?? null, outputText);
  transcript[targetIndex] = {
    ...targetEntry,
    details: nextDetails,
    text: [targetEntry.summary ?? targetEntry.text, nextDetails].filter(Boolean).join("\n"),
  };
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

function findLastToolIndex(transcript: TranscriptEntry[], callId: string | null): number {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry.role !== "tool") {
      continue;
    }
    if (callId !== null && entry.callId === callId) {
      return index;
    }
    if (callId === null) {
      return index;
    }
  }
  return -1;
}

function findFinalizedSnapshot(
  snapshots: FinalizedTurnSnapshot[],
  turnId: string,
): FinalizedTurnSnapshot | null {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (snapshot.turnId === turnId) {
      return snapshot;
    }
  }
  return null;
}
