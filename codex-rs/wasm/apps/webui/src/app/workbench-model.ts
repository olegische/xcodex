import { buildMetrics, buildUiRenderPlan } from "../ui/renderer";
import { transportLabel, type DemoState, type ProviderDraft, type RuntimeActivity } from "../runtime";
import type { PendingApproval } from "../types";
import type { UiSystemDocument } from "../ui/types";
import type { PlanStepItem, RuntimeStatusSummary, SessionStatusItem, WorkspaceFileSummary } from "../types";

export function createWorkbenchModel(input: {
  state: DemoState;
  providerDraft: ProviderDraft;
  uiSystem: UiSystemDocument;
  runtimeActivities: RuntimeActivity[];
  approvals: PendingApproval[];
  running: boolean;
  composerMessage: string;
  workspaceFiles: WorkspaceFileSummary[];
}) {
  const renderPlan = buildUiRenderPlan(input.uiSystem);
  const toolActivities = input.runtimeActivities.filter(
    (activity) => activity.type === "toolCall" || activity.type === "toolOutput",
  );
  const latestPlanUpdate = input.runtimeActivities
    .filter((activity): activity is Extract<RuntimeActivity, { type: "planUpdate" }> => activity.type === "planUpdate")
    .at(-1);
  const metrics = buildMetrics(input.uiSystem.widgets.metrics.items, {
    view: input.uiSystem.activeView?.name ?? "Chat",
    theme: "dark",
    sidebar: renderPlan.sidebarSide,
    transcript: `${input.state.transcript.length}`,
    events: `${input.runtimeActivities.length}`,
    approvals: `${input.approvals.length}`,
    tools: `${toolActivities.length}`,
    workspace: `${input.workspaceFiles.length}`,
    model: input.providerDraft.model || "none",
  });

  return {
    providerSummary: transportLabel(input.providerDraft),
    threadGroups: input.state.threadGroups,
    approvals: input.approvals,
    composerDisabled: input.state.runtime === null || input.composerMessage.trim().length === 0 || input.running,
    routerStatus: buildRouterStatus(input.state, input.runtimeActivities, input.running),
    codexStatus: buildCodexStatus(input.state, input.runtimeActivities, input.running, input.approvals.length),
    latestPlanExplanation: latestPlanUpdate?.explanation ?? null,
    planSteps:
      latestPlanUpdate?.plan.map((step) => ({
        step: step.step,
        status: step.status,
      })) ?? [],
    renderPlan,
    sessionStatus: buildSessionStatus(
      input.state,
      input.providerDraft,
      input.running,
      input.workspaceFiles.length,
      input.uiSystem.activeView?.name ?? "Chat",
    ),
    metrics,
    toolActivities,
    workspaceFiles: input.workspaceFiles,
  };
}

function buildRouterStatus(
  state: DemoState,
  runtimeActivities: RuntimeActivity[],
  running: boolean,
): RuntimeStatusSummary {
  if (state.runtime === null) {
    return { label: "Router", value: "Not ready", tone: "warning" };
  }
  if (state.isError) {
    return { label: "Router", value: "Error", tone: "warning" };
  }
  if (running) {
    const recentActivities = activitiesSinceLastTurnStart(runtimeActivities);
    const isStreaming = recentActivities.some((activity) => activity.type === "delta");
    return {
      label: "Router",
      value: isStreaming ? "Streaming" : "Requesting",
      tone: "success",
    };
  }
  return { label: "Router", value: "Idle", tone: "default" };
}

function buildCodexStatus(
  state: DemoState,
  runtimeActivities: RuntimeActivity[],
  running: boolean,
  approvalCount: number,
): RuntimeStatusSummary {
  if (state.runtime === null) {
    return { label: "Codex", value: "Not ready", tone: "warning" };
  }
  if (state.isError) {
    return { label: "Codex", value: "Error", tone: "warning" };
  }
  if (approvalCount > 0) {
    return { label: "Codex", value: "Awaiting approval", tone: "warning" };
  }
  const recentActivities = activitiesSinceLastTurnStart(runtimeActivities);
  const lastToolCallIndex = findLastActivityIndex(recentActivities, "toolCall");
  const lastToolOutputIndex = findLastActivityIndex(recentActivities, "toolOutput");
  if (running && lastToolCallIndex > lastToolOutputIndex) {
    return { label: "Codex", value: "Running tool", tone: "success" };
  }
  if (running && recentActivities.some((activity) => activity.type === "planUpdate")) {
    return { label: "Codex", value: "Planning", tone: "success" };
  }
  if (running && recentActivities.some((activity) => activity.type === "delta")) {
    return { label: "Codex", value: "Responding", tone: "success" };
  }
  if (running) {
    return { label: "Codex", value: "Thinking", tone: "success" };
  }
  if (recentActivities.some((activity) => activity.type === "completed")) {
    return { label: "Codex", value: "Done", tone: "default" };
  }
  return { label: "Codex", value: "Idle", tone: "default" };
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

function buildSessionStatus(
  state: DemoState,
  providerDraft: ProviderDraft,
  running: boolean,
  workspaceFileCount: number,
  activeViewName: string,
): SessionStatusItem[] {
  return [
    {
      label: "Runtime",
      value: state.runtime === null ? "Not ready" : running ? "Running" : "Ready",
      tone: state.runtime === null ? "warning" : running ? "success" : "default",
    },
    {
      label: "Provider",
      value: providerDraft.providerDisplayName,
    },
    {
      label: "View",
      value: activeViewName,
    },
    {
      label: "Model",
      value: providerDraft.model || "No model selected",
    },
    {
      label: "Transcript",
      value: `${state.transcript.length} entries`,
    },
    {
      label: "Workspace",
      value: `${workspaceFileCount} files`,
    },
    {
      label: "Status",
      value: state.status || "Idle",
      tone: state.isError ? "warning" : "default",
    },
  ];
}
