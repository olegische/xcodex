import type { RuntimeActivity } from "../runtime";
import type { PendingApproval, ThreadSummary } from "../types";

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

export function deriveApprovals(activities: RuntimeActivity[]): PendingApproval[] {
  return activities
    .filter((activity) => activity.type === "toolCall")
    .map((activity, index) => ({
      id: `${activity.requestId}-${index}`,
      title: activity.toolName ?? "toolCall",
      detail:
        activity.toolName === "apply_patch"
          ? "Observed apply_patch tool call. Real approve/reject wiring is the next step."
          : "Observed tool call. Approval gating has not been connected yet.",
      status: "observed",
    }));
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
