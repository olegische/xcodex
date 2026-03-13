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
  status: "observed";
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
