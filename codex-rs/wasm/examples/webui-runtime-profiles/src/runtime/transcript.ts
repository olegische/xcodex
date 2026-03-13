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
        .flatMap((entry: unknown) => {
          if (entry === null || typeof entry !== "object") {
            return [];
          }
          if ("type" in entry && entry.type === "text") {
            return [typeof (entry as any).text === "string" ? (entry as any).text : ""];
          }
          if ("type" in entry && entry.type === "message" && Array.isArray((entry as any).content)) {
            return (entry as any).content
              .filter(
                (part: unknown) =>
                  part !== null &&
                  typeof part === "object" &&
                  !Array.isArray(part) &&
                  ((part as any).type === "input_text" || (part as any).type === "text"),
              )
              .map((part: any) => (typeof part.text === "string" ? part.text : ""));
          }
          return [];
        })
        .join("\n");
      appendTranscriptEntry(transcript, { role: "user", text });
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
      const responseItem = item.item as Record<string, unknown>;
      const toolText = toolTextFromResponseItem(responseItem);
      if (toolText !== null) {
        if (pendingAssistant.length > 0) {
          appendTranscriptEntry(transcript, { role: "assistant", text: pendingAssistant });
          pendingAssistant = "";
        }
        appendTranscriptEntry(transcript, { role: "tool", text: toolText });
        continue;
      }

      const assistantText = assistantTextFromResponseItem(responseItem);
      if (assistantText !== null) {
        if (pendingAssistant.length > 0) {
          if (pendingAssistant === assistantText) {
            appendTranscriptEntry(transcript, { role: "assistant", text: assistantText });
            pendingAssistant = "";
            continue;
          }
          appendTranscriptEntry(transcript, { role: "assistant", text: pendingAssistant });
          pendingAssistant = "";
        }
        appendTranscriptEntry(transcript, { role: "assistant", text: assistantText });
      }
      continue;
    }
    if (item.type === "modelCompleted" && pendingAssistant.length > 0) {
      appendTranscriptEntry(transcript, { role: "assistant", text: pendingAssistant });
      pendingAssistant = "";
    }
  }

  if (pendingAssistant.length > 0) {
    appendTranscriptEntry(transcript, { role: "assistant", text: pendingAssistant });
  }

  return transcript;
}

function appendTranscriptEntry(transcript: TranscriptEntry[], nextEntry: TranscriptEntry) {
  const normalizedText = nextEntry.text.trim();
  if (normalizedText.length === 0) {
    return;
  }

  const lastEntry = transcript[transcript.length - 1];
  if (lastEntry?.role === "tool" && nextEntry.role === "tool") {
    lastEntry.text = `${lastEntry.text}\n\n${normalizedText}`;
    return;
  }

  transcript.push({
    ...nextEntry,
    text: normalizedText,
  });
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

function toolTextFromResponseItem(item: Record<string, unknown>): string | null {
  if (item.type !== "function_call" || typeof item.name !== "string") {
    return null;
  }
  return `Using ${item.name}`;
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
