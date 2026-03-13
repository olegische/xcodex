import type { ThreadSummary } from "../types";

export function buildThreadList(transcript: Array<{ role: string; text: string }>): ThreadSummary[] {
  const firstUserMessage = transcript.find((entry) => entry.role === "user")?.text;
  return [
    {
      id: "current-thread",
      title: firstUserMessage?.slice(0, 36) || "Current thread",
      subtitle: transcript.length === 0 ? "No messages yet" : `${transcript.length} transcript entries`,
      active: true,
    },
  ];
}

export function isCancellationError(error: unknown): boolean {
  if (error !== null && typeof error === "object") {
    const maybeRecord = error as { code?: unknown; message?: unknown };
    if (maybeRecord.code === "cancelled") {
      return true;
    }
    if (typeof maybeRecord.message === "string") {
      const messageText = maybeRecord.message.toLowerCase();
      return messageText.includes("cancelled") || messageText.includes("canceled");
    }
  }
  return false;
}
