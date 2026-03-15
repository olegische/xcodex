import type { JsonValue, RuntimeDispatch, SessionSnapshot, TranscriptEntry } from "./types";

export function assertRuntimeDispatch(dispatch: RuntimeDispatch): void {
  if (dispatch === null || typeof dispatch !== "object" || !Array.isArray(dispatch.events)) {
    throw new Error("runtime.runTurn() returned an invalid dispatch payload");
  }
}

export function snapshotToTranscript(snapshot: SessionSnapshot): TranscriptEntry[] {
  const transcript: TranscriptEntry[] = [];

  for (const item of snapshot.items) {
    if (item === null || typeof item !== "object" || !("type" in item)) {
      continue;
    }
    if (item.type === "userMessage" && Array.isArray(item.content)) {
      const text = item.content
        .flatMap((entry: unknown) =>
          entry !== null &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          entry.type === "text" &&
          typeof (entry as { text?: unknown }).text === "string"
            ? [(entry as { text: string }).text]
            : [],
        )
        .join("\n");
      appendTranscriptEntry(transcript, { role: "user", text });
      continue;
    }
    if (item.type === "agentMessage" && typeof item.text === "string") {
      appendTranscriptEntry(transcript, { role: "assistant", text: item.text });
      continue;
    }
    const toolText = toolTextFromThreadItem(item as Record<string, unknown>);
    if (toolText !== null) {
      appendTranscriptEntry(transcript, { role: "tool", text: toolText });
    }
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

function toolTextFromThreadItem(item: Record<string, unknown>): string | null {
  switch (item.type) {
    case "dynamicToolCall":
      return typeof item.tool === "string" ? `Using ${item.tool}` : null;
    case "mcpToolCall":
      return typeof item.tool === "string" ? `Using ${item.tool}` : null;
    case "fileChange":
      return "Applied file changes";
    case "commandExecution":
      return typeof item.command === "string" ? item.command : "Command execution";
    default:
      return null;
  }
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
    .filter((event) => event !== null && typeof event === "object" && event.method === "item/agentMessage/delta")
    .map((event) => {
      const params = event.params as { delta?: string };
      return typeof params.delta === "string" ? params.delta : "";
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
