import { getXrouterModulePromise } from "./activity";
import type { DemoState, RuntimeActivity } from "./types";

export function buildStatusLines(input: {
  state: DemoState;
  runtimeActivities: RuntimeActivity[];
  running: boolean;
  activeRequestId: string | null;
  pendingPrompt: string;
  approvalCount: number;
}): string[] {
  return [
    `runtime      ${runtimeStatus(input.state, input.running)}`,
    `router       ${routerStatus(input.state, input.runtimeActivities, input.running)}`,
    `codex        ${codexStatus(input.state, input.runtimeActivities, input.running, input.approvalCount)}`,
    `model        ${input.state.codexConfig.model || "not-selected"}`,
    `provider     ${input.state.codexConfig.modelProvider || "none"}`,
    `request      ${input.activeRequestId ?? "idle"}`,
    `thread       ${input.state.transcript.length > 0 ? "active" : "empty"}`,
    `approvals    ${input.approvalCount > 0 ? `${input.approvalCount} pending` : "none"}`,
    `composer     ${input.pendingPrompt.trim().length > 0 ? "buffered" : "empty"}`,
    `xrouter      ${getXrouterModulePromise() === null ? "not-loaded" : "loaded"}`,
  ];
}

function runtimeStatus(state: DemoState, running: boolean): string {
  if (state.runtime === null) {
    return "not-ready";
  }
  if (state.isError) {
    return "error";
  }
  if (running) {
    return "running";
  }
  return "ready";
}

function routerStatus(state: DemoState, runtimeActivities: RuntimeActivity[], running: boolean): string {
  if (state.isError) {
    return "error";
  }
  if (state.runtime === null) {
    return state.models.length > 0 ? "models-ready" : "bootstrap";
  }
  if (running) {
    const recentActivities = activitiesSinceLastTurnStart(runtimeActivities);
    return recentActivities.some((activity) => activity.type === "delta") ? "streaming" : "requesting";
  }
  return "idle";
}

function codexStatus(
  state: DemoState,
  runtimeActivities: RuntimeActivity[],
  running: boolean,
  approvalCount: number,
): string {
  if (state.runtime === null) {
    return "not-ready";
  }
  if (state.isError) {
    return "error";
  }
  if (approvalCount > 0) {
    return "awaiting-approval";
  }
  const recentActivities = activitiesSinceLastTurnStart(runtimeActivities);
  const lastToolCallIndex = findLastActivityIndex(recentActivities, "toolCall");
  const lastToolOutputIndex = findLastActivityIndex(recentActivities, "toolOutput");
  if (running && lastToolCallIndex > lastToolOutputIndex) {
    return "running-tool";
  }
  if (running && recentActivities.some((activity) => activity.type === "planUpdate")) {
    return "planning";
  }
  if (running && recentActivities.some((activity) => activity.type === "delta")) {
    return "responding";
  }
  if (running) {
    return "thinking";
  }
  if (recentActivities.some((activity) => activity.type === "completed")) {
    return "idle-done";
  }
  return "idle";
}

function activitiesSinceLastTurnStart(runtimeActivities: RuntimeActivity[]): RuntimeActivity[] {
  const lastTurnStartIndex = findLastActivityIndex(runtimeActivities, "turnStart");
  return lastTurnStartIndex >= 0 ? runtimeActivities.slice(lastTurnStartIndex) : runtimeActivities;
}

function findLastActivityIndex<TType extends RuntimeActivity["type"]>(
  runtimeActivities: RuntimeActivity[],
  type: TType,
): number {
  for (let index = runtimeActivities.length - 1; index >= 0; index -= 1) {
    if (runtimeActivities[index]?.type === type) {
      return index;
    }
  }
  return -1;
}
