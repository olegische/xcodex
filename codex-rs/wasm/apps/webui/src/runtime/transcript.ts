import type { JsonValue, RuntimeEvent, TranscriptEntry } from "./types";

export function threadToTranscript(thread: unknown): TranscriptEntry[] {
  const transcript: TranscriptEntry[] = [];
  const record =
    thread !== null && typeof thread === "object" && !Array.isArray(thread)
      ? (thread as Record<string, unknown>)
      : {};
  const turns = Array.isArray(record.turns) ? record.turns : [];

  for (const turn of turns) {
    if (turn === null || typeof turn !== "object" || Array.isArray(turn)) {
      continue;
    }
    const items = Array.isArray((turn as { items?: unknown[] }).items) ? (turn as { items: unknown[] }).items : [];
    for (const item of items) {
      if (item === null || typeof item !== "object" || !("type" in item)) {
        continue;
      }
      if (item.type === "userMessage" && Array.isArray(item.content)) {
        const text = item.content
          .flatMap((entry: unknown) =>
            entry !== null &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            (entry as { type?: unknown }).type === "text" &&
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
      const toolEntry = toolEntryFromThreadItem(item as Record<string, unknown>);
      if (toolEntry !== null) {
        appendTranscriptEntry(transcript, toolEntry);
      }
    }
  }

  return transcript;
}

function appendTranscriptEntry(transcript: TranscriptEntry[], nextEntry: TranscriptEntry) {
  const normalizedText = nextEntry.text.trim();
  if (normalizedText.length === 0) {
    return;
  }

  transcript.push({
    ...nextEntry,
    text: normalizedText,
  });
}

function toolTextFromThreadItem(item: Record<string, unknown>): string | null {
  const entry = toolEntryFromThreadItem(item);
  return entry?.text ?? null;
}

function toolEntryFromThreadItem(item: Record<string, unknown>): TranscriptEntry | null {
  switch (item.type) {
    case "dynamicToolCall":
      return dynamicToolCallEntry(item);
    case "mcpToolCall":
      return mcpToolCallEntry(item);
    case "fileChange":
      return { role: "tool", summary: "Applied file changes", details: null, text: "Applied file changes" };
    case "commandExecution":
      return {
        role: "tool",
        summary: typeof item.command === "string" ? item.command : "Command execution",
        details: null,
        text: typeof item.command === "string" ? item.command : "Command execution",
      };
    default:
      return null;
  }
}

function dynamicToolCallEntry(item: Record<string, unknown>): TranscriptEntry | null {
  if (typeof item.tool !== "string") {
    return null;
  }
  const summary = `Using ${item.tool}`;
  const lines = [summary];
  const argumentsText = stringifyJsonLike(item.arguments);
  if (argumentsText !== null) {
    lines.push(argumentsText);
  }
  const contentItems = Array.isArray(item.contentItems) ? item.contentItems : [];
  const contentText = contentItems
    .flatMap((entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { text?: unknown }).text === "string"
        ? [(entry as { text: string }).text]
        : [],
    )
    .join("\n");
  if (contentText.trim().length > 0) {
    lines.push(`Result\n${contentText.trim()}`);
  }
  return {
    role: "tool",
    summary,
    details: lines.slice(1).join("\n").trim() || null,
    text: lines.join("\n"),
    callId: typeof item.id === "string" ? item.id : null,
  };
}

function mcpToolCallEntry(item: Record<string, unknown>): TranscriptEntry | null {
  if (typeof item.tool !== "string") {
    return null;
  }
  const summary = `Using ${item.tool}`;
  const lines = [summary];
  const argumentsText = stringifyJsonLike(item.arguments);
  if (argumentsText !== null) {
    lines.push(argumentsText);
  }
  const resultText = stringifyJsonLike(item.result);
  if (resultText !== null) {
    lines.push(`Result\n${resultText}`);
  }
  const errorText = stringifyJsonLike(item.error);
  if (errorText !== null) {
    lines.push(`Error\n${errorText}`);
  }
  return {
    role: "tool",
    summary,
    details: lines.slice(1).join("\n").trim() || null,
    text: lines.join("\n"),
    callId: typeof item.id === "string" ? item.id : null,
  };
}

function stringifyJsonLike(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : null;
  }
  try {
    const text = JSON.stringify(value, null, 2)?.trim() ?? "";
    return text.length > 0 ? text : null;
  } catch {
    const text = String(value).trim();
    return text.length > 0 ? text : null;
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

export function buildOutputFromEvents(events: RuntimeEvent[]): string {
  return events
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
