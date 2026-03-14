export type ThreadSummary = {
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
};

export type PendingApproval = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "observed";
};

export type WorkspaceFileSummary = {
  path: string;
  bytes: number;
  preview: string;
  content: string;
};

export type SessionStatusItem = {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
};

export type RuntimeStatusSummary = {
  label: string;
  value: string;
  tone: "default" | "success" | "warning";
};

export type PlanStepItem = {
  step: string;
  status: string;
};

export type MissionPhase = "idle" | "observing" | "planning" | "acting" | "waiting" | "blocked" | "completed" | "failed";

export type MissionStep = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  detail: string;
};

export type MissionStateSummary = {
  goal: string;
  phase: MissionPhase;
  lane: "page" | "tools" | "artifacts" | "idle";
  summary: string;
  blockers: string[];
  steps: MissionStep[];
  updatedAt: number | null;
};

export type PageEventSummary = {
  id: string;
  kind: "navigation" | "mutation" | "selection" | "click" | "input" | "tool" | "lifecycle";
  summary: string;
  detail: string | null;
  target: string | null;
  timestamp: number;
};

export type PageRuntimeSummary = {
  url: string;
  title: string;
  capabilityMode: "page" | "extension" | "devtools";
  readyState: string;
  selectionText: string | null;
  interactives: Array<{
    selector: string;
    tagName: string;
    role: string | null;
    label: string;
  }>;
  observedAt: number | null;
};
