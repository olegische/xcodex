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

export type ApsixZoneLifecycleState =
  | "idle"
  | "candidate"
  | "admitting"
  | "rejected"
  | "recon"
  | "admitted"
  | "partitioned"
  | "running"
  | "anchored"
  | "frozen"
  | "blocked"
  | "failed";

export type ApsixZonePhase =
  | "idle"
  | "admit_started"
  | "admit_decision"
  | "environment_recon"
  | "zone_admission"
  | "partition_design"
  | "spawn_admitted"
  | "executing"
  | "artifact_anchored"
  | "frozen"
  | "failed";

export type ApsixTargetSummary = {
  kind: "user_input";
  value: string;
  normalizedValue: string;
  validation:
    | "unvalidated_user_input"
    | "normalized_candidate"
    | "admitted_target"
    | "rejected_target";
  admissionDecision: "pending" | "allow" | "deny" | null;
  reasonCode: string | null;
  citations: string[];
};

export type ApsixZoneSummary = {
  zoneId: string | null;
  target: ApsixTargetSummary | null;
  lifecycleState: ApsixZoneLifecycleState;
  phase: ApsixZonePhase;
  summary: string;
  spawnPolicyVersion: string | null;
  spawnBudgetTotal: number;
  spawnBudgetUsed: number;
  environmentStatus: "pending" | "prepared" | "verified" | "violated";
  environmentSummary: string;
  environmentMutableRefs: string[];
  environmentProtectedRefs: string[];
  environmentPreparedAt: number | null;
  environmentVerifiedAt: number | null;
  authoritativeStateRef: string | null;
  spawnRequestId: string | null;
  spawnDecision: "pending" | "allow" | "deny" | null;
  spawnReasonCode: string | null;
  activeActorId: string | null;
  artifactIds: string[];
  blockers: string[];
  updatedAt: number | null;
};

export type ApsixActorSummary = {
  actorId: string;
  zoneId: string;
  admittedPartitions: string[];
  capabilityMask: string[];
  budgetShare: number;
  intent: string;
  status: "spawn_requested" | "running" | "completed" | "blocked" | "failed";
  requestId: string | null;
  runId: string | null;
  lastCapability: string | null;
  updatedAt: number | null;
};

export type ApsixCitationSourceKind =
  | "user_input"
  | "tool_output"
  | "workspace_doc"
  | "page_observation"
  | "runtime_event";

export type ApsixCitationSourceSummary = {
  citationKey: string;
  zoneId: string | null;
  kind: ApsixCitationSourceKind;
  requestId: string | null;
  runId: string | null;
  sourceRef: string;
  locator: string | null;
  excerpt: string;
  createdAt: number;
};

export type ApsixArtifactSummary = {
  artifactId: string;
  zoneId: string;
  originActorId: string;
  artifactType: "final_output" | "patch" | "file_write" | "file_update" | "file_delete" | "state_change";
  status: "candidate" | "anchored" | "rejected";
  summary: string;
  citations: string[];
  provenance: {
    requestId: string | null;
    runId: string | null;
    source: "assistant_final" | "tool_mutation";
  };
  path: string;
  updatedAt: number | null;
};

export type ApsixAnchorSummary = {
  anchorId: string;
  artifactId: string;
  zoneId: string;
  policyVersion: string;
  decision: "allow" | "deny";
  reasonCode: string;
  citationStatus: "verified" | "missing";
  citedKeys: string[];
  missingKeys: string[];
  timestamp: number;
};

export type ApsixLedgerEventSummary = {
  seqNo: number;
  type:
    | "admit_started"
    | "admit_decision"
    | "zone_created"
    | "spawn_requested"
    | "spawn_decision"
    | "environment_prepared"
    | "execution_started"
    | "actor_started"
    | "execute_requested"
    | "execution_completed"
    | "execution_verified"
    | "execute_completed"
    | "artifact_generated"
    | "anchor_decision"
    | "zone_frozen"
    | "zone_failed"
    | "zone_blocked";
  zoneId: string;
  subjectRef: string;
  subjectKind: "zone" | "actor" | "artifact" | "anchor" | "call" | "capability" | "unknown";
  requestId: string | null;
  requestKind: "turn" | "spawn" | "anchor" | "system" | null;
  runId: string | null;
  decision: "pending" | "allow" | "deny" | null;
  reasonCode: string | null;
  summary: string;
  timestamp: number;
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
  lane: "page" | "artifacts" | "idle";
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
