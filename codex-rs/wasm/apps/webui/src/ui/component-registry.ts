import type { ComponentType } from "svelte";
import ComposerWidget from "../lib/widgets/ComposerWidget.svelte";
import CitationsWidget from "../lib/widgets/CitationsWidget.svelte";
import LedgerWidget from "../lib/widgets/LedgerWidget.svelte";
import MetricsWidget from "../lib/widgets/MetricsWidget.svelte";
import MissionStateWidget from "../lib/widgets/MissionStateWidget.svelte";
import PageStateWidget from "../lib/widgets/PageStateWidget.svelte";
import PlanStatusWidget from "../lib/widgets/PlanStatusWidget.svelte";
import RuntimeEventsWidget from "../lib/widgets/RuntimeEventsWidget.svelte";
import SessionStatusWidget from "../lib/widgets/SessionStatusWidget.svelte";
import TranscriptWidget from "../lib/widgets/TranscriptWidget.svelte";
import ApprovalsWidget from "../lib/widgets/ApprovalsWidget.svelte";
import ToolActivityWidget from "../lib/widgets/ToolActivityWidget.svelte";
import WorkspaceFilesWidget from "../lib/widgets/WorkspaceFilesWidget.svelte";
import WebSignalsWidget from "../lib/widgets/WebSignalsWidget.svelte";
import AgentSwarmWidget from "../lib/widgets/AgentSwarmWidget.svelte";
import type { RuntimeActivity, TranscriptEntry } from "../runtime";
import type { PendingApproval, PlanStepItem, SessionStatusItem, WorkspaceFileSummary } from "../types";
import type { MetricItem, RenderedWidget, UiAreaName, UiWidgetId, UiWidgetsDocument } from "./types";

export type WidgetDefinition = {
  id: UiWidgetId;
  title: string;
  allowedAreas: UiAreaName[];
};

export type WidgetHostContext = {
  widget: RenderedWidget;
  widgetsDocument: UiWidgetsDocument;
  transcript: TranscriptEntry[];
  liveStreamText: string;
  status: string;
  running: boolean;
  disabled: boolean;
  runtimeActivities: RuntimeActivity[];
  toolActivities: RuntimeActivity[];
  approvals: PendingApproval[];
  metrics: MetricItem[];
  sessionStatus: SessionStatusItem[];
  latestPlanExplanation: string | null;
  planSteps: PlanStepItem[];
  workspaceFiles: WorkspaceFileSummary[];
  onSend: () => void;
  onStop: () => void;
  onSettings: () => void;
};

export type WidgetRendererDefinition = WidgetDefinition & {
  component: ComponentType;
  createProps: (context: WidgetHostContext) => Record<string, unknown>;
};

export const WIDGET_REGISTRY: Record<UiWidgetId, WidgetRendererDefinition> = {
  mission_state: {
    id: "mission_state",
    title: "Zone State",
    allowedAreas: ["inspector", "mainTop", "mainBody", "mainBottom"],
    component: MissionStateWidget,
    createProps: (context) => ({
      title: context.widget.title,
    }),
  },
  ledger: {
    id: "ledger",
    title: "Ledger",
    allowedAreas: ["inspector", "mainTop", "mainBody", "mainBottom"],
    component: LedgerWidget,
    createProps: (context) => ({
      title: context.widget.title,
      workspaceFiles: context.workspaceFiles,
    }),
  },
  citations: {
    id: "citations",
    title: "Citations",
    allowedAreas: ["inspector", "mainTop", "mainBody", "mainBottom"],
    component: CitationsWidget,
    createProps: (context) => ({
      title: context.widget.title,
      workspaceFiles: context.workspaceFiles,
    }),
  },
  page_state: {
    id: "page_state",
    title: "Page State",
    allowedAreas: ["inspector", "mainTop", "mainBody", "mainBottom"],
    component: PageStateWidget,
    createProps: (context) => ({
      title: context.widget.title,
    }),
  },
  session_status: {
    id: "session_status",
    title: "Session Status",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: SessionStatusWidget,
    createProps: (context) => ({
      title: context.widget.title,
      items: context.sessionStatus,
      dense: context.widgetsDocument.sessionStatus.dense,
    }),
  },
  plan_status: {
    id: "plan_status",
    title: "Plan Status",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: PlanStatusWidget,
    createProps: (context) => ({
      title: context.widget.title,
      explanation: context.latestPlanExplanation,
      steps: context.planSteps,
      showExplanation: context.widgetsDocument.planStatus.showExplanation,
    }),
  },
  transcript: {
    id: "transcript",
    title: "Transcript",
    allowedAreas: ["mainTop", "mainBody", "mainBottom"],
    component: TranscriptWidget,
    createProps: (context) => ({
      transcript: context.transcript,
      liveStreamText: context.liveStreamText,
      status: context.status,
      running: context.running,
      runtimeActivities: context.runtimeActivities,
      flat: context.widgetsDocument.transcript.variant === "flat",
      onSettings: context.onSettings,
    }),
  },
  composer: {
    id: "composer",
    title: "Composer",
    allowedAreas: ["mainTop", "mainBottom"],
    component: ComposerWidget,
    createProps: (context) => ({
      disabled: context.disabled,
      running: context.running,
      onSend: context.onSend,
      onStop: context.onStop,
      onSettings: context.onSettings,
    }),
  },
  metrics: {
    id: "metrics",
    title: "Metrics",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: MetricsWidget,
    createProps: (context) => ({
      title: context.widget.title,
      metrics: context.metrics,
    }),
  },
  runtime_events: {
    id: "runtime_events",
    title: "Runtime Events",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: RuntimeEventsWidget,
    createProps: (context) => ({
      title: context.widget.title,
      runtimeActivities: context.runtimeActivities,
      compact: context.widgetsDocument.runtimeEvents.compact,
    }),
  },
  approvals: {
    id: "approvals",
    title: "Approvals",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: ApprovalsWidget,
    createProps: (context) => ({
      title: context.widget.title,
      approvals: context.approvals,
      compact: context.widgetsDocument.approvals.compact,
    }),
  },
  tool_activity: {
    id: "tool_activity",
    title: "Tool Activity",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: ToolActivityWidget,
    createProps: (context) => ({
      title: context.widget.title,
      toolActivities: context.toolActivities,
      compact: context.widgetsDocument.toolActivity.compact,
    }),
  },
  workspace_files: {
    id: "workspace_files",
    title: "Workspace Files",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
    component: WorkspaceFilesWidget,
    createProps: (context) => ({
      title: context.widget.title,
      workspaceFiles: context.workspaceFiles,
      maxItems: context.widgetsDocument.workspaceFiles.maxItems,
      showPreview: context.widgetsDocument.workspaceFiles.showPreview,
    }),
  },
  web_signals: {
    id: "web_signals",
    title: "Web Signals",
    allowedAreas: ["mainTop", "mainBody", "mainBottom"],
    component: WebSignalsWidget,
    createProps: (context) => ({
      title: context.widget.title,
      workspaceFiles: context.workspaceFiles,
    }),
  },
  agent_swarm: {
    id: "agent_swarm",
    title: "Actors",
    allowedAreas: ["mainTop", "mainBody", "mainBottom"],
    component: AgentSwarmWidget,
    createProps: (context) => ({
      title: context.widget.title,
      workspaceFiles: context.workspaceFiles,
    }),
  },
};

export function getWidgetRenderer(id: UiWidgetId): WidgetRendererDefinition {
  return WIDGET_REGISTRY[id];
}
