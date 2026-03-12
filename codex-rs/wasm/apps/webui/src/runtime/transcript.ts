import type { JsonValue, RuntimeDispatch, SessionSnapshot, TranscriptEntry } from "./types";

export function assertRuntimeDispatch(dispatch: RuntimeDispatch): void {
  if (dispatch === null || typeof dispatch !== "object" || !Array.isArray(dispatch.events)) {
    throw new Error("runtime.runTurn() returned an invalid dispatch payload");
  }
}

export function snapshotToTranscript(snapshot: SessionSnapshot): TranscriptEntry[] {
  const transcript: TranscriptEntry[] = [];
  let pendingAssistant = "";

  for (const item of snapshot.items) {
    if (item === null || typeof item !== "object" || !("type" in item)) {
      continue;
    }
    if (item.type === "userInput" && Array.isArray(item.input)) {
      const text = item.input
        .filter((entry: unknown) => entry !== null && typeof entry === "object" && entry.type === "text")
        .map((entry: any) => entry.text ?? "")
        .join("\n");
      transcript.push({ role: "user", text });
      continue;
    }
    if (
      item.type === "modelDelta" &&
      "payload" in item &&
      item.payload !== null &&
      typeof item.payload === "object" &&
      "outputTextDelta" in item.payload &&
      typeof item.payload.outputTextDelta === "string"
    ) {
      pendingAssistant += item.payload.outputTextDelta;
      continue;
    }
    if (item.type === "modelOutputItem" && "item" in item && item.item !== null && typeof item.item === "object") {
      const assistantText = assistantTextFromResponseItem(item.item as Record<string, unknown>);
      if (assistantText !== null) {
        if (pendingAssistant.length > 0) {
          if (pendingAssistant === assistantText) {
            transcript.push({ role: "assistant", text: assistantText });
            pendingAssistant = "";
            continue;
          }
          transcript.push({ role: "assistant", text: pendingAssistant });
          pendingAssistant = "";
        }
        transcript.push({ role: "assistant", text: assistantText });
      }
      continue;
    }
    if (item.type === "modelCompleted" && pendingAssistant.length > 0) {
      transcript.push({ role: "assistant", text: pendingAssistant });
      pendingAssistant = "";
    }
  }

  if (pendingAssistant.length > 0) {
    transcript.push({ role: "assistant", text: pendingAssistant });
  }

  return transcript;
}

export function assistantTextFromResponseItem(item: Record<string, unknown>): string | null {
  if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) {
    return null;
  }
  const text = item.content
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === "object" && entry.type === "output_text",
    )
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .join("");
  return text.trim().length === 0 ? null : text;
}

export function buildOutputFromDispatch(dispatch: RuntimeDispatch): string {
  return dispatch.events
    .filter((event) => event !== null && typeof event === "object" && event.event === "modelDelta")
    .map((event) => {
      const payload = event.payload as { payload: { outputTextDelta: string } };
      return payload.payload.outputTextDelta;
    })
    .join("");
}

export function isCompletedEvent(event: JsonValue, requestId: string): boolean {
  return (
    event !== null &&
    typeof event === "object" &&
    "type" in event &&
    event.type === "completed" &&
    "requestId" in event &&
    event.requestId === requestId
  );
}

export function isOutputItemDoneEvent(event: JsonValue, requestId: string): boolean {
  return (
    event !== null &&
    typeof event === "object" &&
    !Array.isArray(event) &&
    event.type === "outputItemDone" &&
    event.requestId === requestId
  );
}
