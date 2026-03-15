import { readApsixZoneState } from "../apsix/workspace";
import type { ThreadSummary, WorkspaceFileSummary } from "../types";

export function buildThreadList(workspaceFiles: WorkspaceFileSummary[]): ThreadSummary[] {
  const zone = readApsixZoneState(workspaceFiles);
  if (zone.zoneId === null) {
    return [];
  }
  const normalizedTitle = zone.target?.value.replace(/\s+/g, " ").trim();
  return [
    {
      id: zone.zoneId,
      title: normalizedTitle?.slice(0, 64) || "Active zone",
      subtitle: zone.lifecycleState,
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
