import { get, writable } from "svelte/store";
import { loadStoredWorkspaceSnapshot, normalizeWorkspaceFilePath } from "../runtime/storage";
import {
  ensureApsixWorkspaceSeed,
  saveApsixArtifactBody,
  saveApsixWorkspaceSnapshot,
  type ApsixWorkspaceSnapshot,
} from "../apsix/workspace";
import { subscribeRuntimeActivity } from "../runtime/activity";
import type { RuntimeActivity, TranscriptEntry } from "../runtime";
import type {
  ApsixActorSummary,
  ApsixAnchorSummary,
  ApsixArtifactSummary,
  ApsixCitationSourceSummary,
  ApsixLedgerEventSummary,
  ApsixZoneSummary,
} from "../types";

type ApsixZoneStoreState = ApsixWorkspaceSnapshot;
type ToolCallRecord = {
  requestId: string;
  toolName: string | null;
  arguments: unknown;
};

const initialState: ApsixZoneStoreState = {
  zone: {
    zoneId: null,
    target: null,
    lifecycleState: "idle",
    phase: "idle",
    summary: "Waiting for a bounded browser task. Casual chat should not create a zone.",
    spawnPolicyVersion: null,
    spawnBudgetTotal: 0,
    spawnBudgetUsed: 0,
    environmentStatus: "pending",
    environmentSummary: "Spawn preparation has not run yet.",
    environmentMutableRefs: [],
    environmentProtectedRefs: [],
    environmentPreparedAt: null,
    environmentVerifiedAt: null,
    authoritativeStateRef: null,
    spawnRequestId: null,
    spawnDecision: null,
    spawnReasonCode: null,
    activeActorId: null,
    artifactIds: [],
    blockers: [],
    updatedAt: null,
  },
  actors: [],
  artifacts: [],
  anchors: [],
  events: [],
  sources: [],
};

function createApsixZoneStore() {
  const { subscribe, set } = writable<ApsixZoneStoreState>(structuredClone(initialState));
  let activityChain = Promise.resolve();
  const callRegistry = new Map<string, ToolCallRecord>();
  const deltaBuffers = new Map<string, string[]>();
  const assistantBuffers = new Map<string, string>();

  async function commit(nextState: ApsixZoneStoreState) {
    set(nextState);
    await saveApsixWorkspaceSnapshot(nextState);
  }

  function resetTransientState() {
    callRegistry.clear();
    deltaBuffers.clear();
    assistantBuffers.clear();
  }

  function clearTransientStateForRequest(requestId: string) {
    deltaBuffers.delete(requestId);
    assistantBuffers.delete(requestId);
    for (const [callId, record] of callRegistry.entries()) {
      if (normalizedRequestId(record.requestId) === requestId) {
        callRegistry.delete(callId);
      }
    }
  }

  function withEvent(
    state: ApsixZoneStoreState,
    input: Omit<ApsixLedgerEventSummary, "seqNo" | "timestamp">,
  ): ApsixZoneStoreState {
    const nextEvent: ApsixLedgerEventSummary = {
      ...input,
      seqNo: state.events.at(-1)?.seqNo ? state.events.at(-1)!.seqNo + 1 : 1,
      timestamp: Date.now(),
    };
    return {
      ...state,
      events: [...state.events, nextEvent].slice(-160),
    };
  }

  function updateActor(
    state: ApsixZoneStoreState,
    actorId: string,
    updater: (actor: ApsixActorSummary) => ApsixActorSummary,
  ): ApsixActorSummary[] {
    return state.actors.map((actor) => (actor.actorId === actorId ? updater(actor) : actor));
  }

  function normalizedRequestId(requestId: string | null): string | null {
    if (requestId === null) {
      return null;
    }
    return requestId.split(":")[0] ?? requestId;
  }

  function runIdFor(zoneId: string, requestId: string): string {
    return `${zoneId}-run-${slugify(normalizedRequestId(requestId) ?? requestId)}`;
  }

  function hasEvent(
    state: ApsixZoneStoreState,
    input: {
      type: ApsixLedgerEventSummary["type"];
      requestId?: string | null;
      runId?: string | null;
      subjectRef?: string | null;
    },
  ): boolean {
    const requestId = input.requestId ?? undefined;
    const runId = input.runId ?? undefined;
    const subjectRef = input.subjectRef ?? undefined;
    return state.events.some(
      (event) =>
        event.type === input.type &&
        (requestId === undefined || event.requestId === requestId) &&
        (runId === undefined || event.runId === runId) &&
        (subjectRef === undefined || event.subjectRef === subjectRef),
    );
  }

  function withSource(
    state: ApsixZoneStoreState,
    source: ApsixCitationSourceSummary,
  ): ApsixZoneStoreState {
    const filtered = state.sources.filter((entry) => entry.citationKey !== source.citationKey);
    return {
      ...state,
      sources: [...filtered, source].slice(-320),
    };
  }

  function registerToolCall(activity: Extract<RuntimeActivity, { type: "toolCall" }>) {
    if (activity.callId === null) {
      return;
    }
    callRegistry.set(activity.callId, {
      requestId: normalizedRequestId(activity.requestId) ?? activity.requestId,
      toolName: activity.toolName,
      arguments: activity.arguments,
    });
  }

  function bufferDelta(requestId: string, text: string) {
    const existing = deltaBuffers.get(requestId) ?? [];
    existing.push(text);
    deltaBuffers.set(requestId, existing);
  }

  function bufferAssistantOutput(requestId: string, content: unknown) {
    assistantBuffers.set(requestId, stringifyContent(content));
  }

  function finalOutputForRequest(requestId: string): string {
    return assistantBuffers.get(requestId)?.trim() ?? "";
  }

  function citationsForRequest(
    state: ApsixZoneStoreState,
    requestId: string,
    runId: string | null,
  ): string[] {
    const citations = state.sources
      .filter((source) => source.requestId === requestId || (runId !== null && source.runId === runId))
      .map((source) => source.citationKey);
    return Array.from(new Set(citations));
  }

  function verifyCitations(state: ApsixZoneStoreState, citationKeys: string[]) {
    const citedKeys = Array.from(new Set(citationKeys));
    const missingKeys = citedKeys.filter(
      (citationKey) => !state.sources.some((source) => sourceMatchesCitationReference(source, citationKey)),
    );
    return {
      citedKeys,
      missingKeys,
      citationStatus:
        citedKeys.length > 0 && missingKeys.length === 0 ? ("verified" satisfies ApsixAnchorSummary["citationStatus"]) : ("missing" satisfies ApsixAnchorSummary["citationStatus"]),
    };
  }

  async function createArtifactAndAnchor(
    state: ApsixZoneStoreState,
    input: {
      requestId: string;
      runId: string | null;
      artifactType: ApsixArtifactSummary["artifactType"];
      summary: string;
      body: string;
      citations: string[];
      provenanceSource: ApsixArtifactSummary["provenance"]["source"];
    },
  ): Promise<ApsixZoneStoreState> {
    if (state.zone.zoneId === null || state.zone.activeActorId === null) {
      return state;
    }
    const artifactIndex = state.artifacts.length + 1;
    const artifactId = `${state.zone.zoneId}-artifact-${artifactIndex}`;
    const anchorId = `${artifactId}-anchor-1`;
    const artifactPath = await saveApsixArtifactBody(artifactId, input.body);
    const verification = verifyCitations(state, input.citations);
    const decision: ApsixAnchorSummary["decision"] = verification.citationStatus === "verified" ? "allow" : "deny";
    const reasonCode = verification.citationStatus === "verified" ? "citations_verified" : "missing_citations";
    let nextState = {
      ...state,
      artifacts: [
        ...state.artifacts,
        {
          artifactId,
          zoneId: state.zone.zoneId,
          originActorId: state.zone.activeActorId,
          artifactType: input.artifactType,
          status: decision === "allow" ? "anchored" : "rejected",
          summary: input.summary,
          citations: verification.citedKeys,
          provenance: {
            requestId: input.requestId,
            runId: input.runId,
            source: input.provenanceSource,
          },
          path: artifactPath,
          updatedAt: Date.now(),
        } satisfies ApsixArtifactSummary,
      ],
      anchors: [
        ...state.anchors,
        {
          anchorId,
          artifactId,
          zoneId: state.zone.zoneId,
          policyVersion: "citation-anchor-v1",
          decision,
          reasonCode,
          citationStatus: verification.citationStatus,
          citedKeys: verification.citedKeys,
          missingKeys: verification.missingKeys,
          timestamp: Date.now(),
        } satisfies ApsixAnchorSummary,
      ],
      zone: {
        ...state.zone,
        lifecycleState: decision === "allow" ? "anchored" : state.zone.lifecycleState,
        phase: decision === "allow" ? "artifact_anchored" : state.zone.phase,
        summary:
          decision === "allow"
            ? `${input.summary} Anchor verified all citations.`
            : `${input.summary} Anchor rejected the artifact because citations were missing.`,
        authoritativeStateRef: decision === "allow" ? artifactPath : state.zone.authoritativeStateRef,
        artifactIds: [...state.zone.artifactIds, artifactId],
        updatedAt: Date.now(),
      },
    };
    nextState = withEvent(nextState, {
      type: "artifact_generated",
      zoneId: state.zone.zoneId,
      subjectRef: artifactId,
      subjectKind: "artifact",
      requestId: input.requestId,
      requestKind: "turn",
      runId: input.runId,
      decision: null,
      reasonCode: null,
      summary: input.summary,
    });
    nextState = withEvent(nextState, {
      type: "anchor_decision",
      zoneId: state.zone.zoneId,
      subjectRef: anchorId,
      subjectKind: "anchor",
      requestId: anchorId,
      requestKind: "anchor",
      runId: input.runId,
      decision,
      reasonCode,
      summary:
        decision === "allow"
          ? `Anchor allow ${artifactId} via citation verification`
          : `Anchor deny ${artifactId} because citations were missing`,
    });
    return nextState;
  }

  async function syncFinalArtifactForRequest(
    state: ApsixZoneStoreState,
    requestId: string,
    runId: string | null,
  ): Promise<ApsixZoneStoreState> {
    const artifact = [...state.artifacts]
      .reverse()
      .find(
        (entry) =>
          entry.artifactType === "final_output" &&
          entry.provenance.requestId === requestId &&
          entry.provenance.runId === runId,
      );
    if (artifact === undefined) {
      return state;
    }
    const verification = verifyCitations(state, citationsForRequest(state, requestId, runId));
    const decision: ApsixAnchorSummary["decision"] = verification.citationStatus === "verified" ? "allow" : "deny";
    const reasonCode = verification.citationStatus === "verified" ? "citations_verified" : "missing_citations";
    return {
      ...state,
      artifacts: state.artifacts.map((entry) =>
        entry.artifactId === artifact.artifactId
          ? {
              ...entry,
              status: decision === "allow" ? "anchored" : "rejected",
              updatedAt: Date.now(),
            }
          : entry,
      ),
      anchors: state.anchors.map((anchor) =>
        anchor.artifactId === artifact.artifactId
          ? {
              ...anchor,
              decision,
              reasonCode,
              citationStatus: verification.citationStatus,
              citedKeys: verification.citedKeys,
              missingKeys: verification.missingKeys,
              timestamp: Date.now(),
            }
          : anchor,
      ),
      zone: {
        ...state.zone,
        authoritativeStateRef: decision === "allow" ? artifact.path : state.zone.authoritativeStateRef,
        updatedAt: Date.now(),
      },
    };
  }

  function findFinalArtifactForRequest(
    state: ApsixZoneStoreState,
    requestId: string,
    runId: string | null,
  ): ApsixArtifactSummary | undefined {
    return [...state.artifacts]
      .reverse()
      .find(
        (entry) =>
          entry.artifactType === "final_output" &&
          entry.provenance.requestId === requestId &&
          entry.provenance.runId === runId,
      );
  }

  async function upsertFinalArtifactForRequest(
    state: ApsixZoneStoreState,
    input: {
      requestId: string;
      runId: string | null;
      summary: string;
      assistantOutput: string;
    },
  ): Promise<ApsixZoneStoreState> {
    const existingArtifact = findFinalArtifactForRequest(state, input.requestId, input.runId);
    const citations = extractInlineCitationReferences(input.assistantOutput);
    if (existingArtifact === undefined) {
      return createArtifactAndAnchor(state, {
        requestId: input.requestId,
        runId: input.runId,
        artifactType: "final_output",
        summary: input.summary,
        body: buildFinalOutputArtifactBody(input.assistantOutput),
        citations,
        provenanceSource: "assistant_final",
      });
    }

    const artifactPath = await saveApsixArtifactBody(
      existingArtifact.artifactId,
      buildFinalOutputArtifactBody(input.assistantOutput),
    );
    const verification = verifyCitations(state, citations);
    const decision: ApsixAnchorSummary["decision"] =
      verification.citationStatus === "verified" ? "allow" : "deny";
    const reasonCode = verification.citationStatus === "verified" ? "citations_verified" : "missing_citations";

    return {
      ...state,
      artifacts: state.artifacts.map((entry) =>
        entry.artifactId === existingArtifact.artifactId
          ? {
              ...entry,
              summary: input.summary,
              citations: verification.citedKeys,
              status: decision === "allow" ? "anchored" : "rejected",
              path: artifactPath,
              updatedAt: Date.now(),
            }
          : entry,
      ),
      anchors: state.anchors.map((anchor) =>
        anchor.artifactId === existingArtifact.artifactId
          ? {
              ...anchor,
              decision,
              reasonCode,
              citationStatus: verification.citationStatus,
              citedKeys: verification.citedKeys,
              missingKeys: verification.missingKeys,
              timestamp: Date.now(),
            }
          : anchor,
      ),
      zone: {
        ...state.zone,
        authoritativeStateRef:
          decision === "allow"
            ? artifactPath
            : state.zone.authoritativeStateRef === existingArtifact.path
              ? null
              : state.zone.authoritativeStateRef,
        updatedAt: Date.now(),
      },
    };
  }

  const store = {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    async initialize() {
      await ensureApsixWorkspaceSeed();
      resetTransientState();
      await commit(structuredClone(initialState));
      const unsubscribeRuntime = subscribeRuntimeActivity((activity) => {
        activityChain = activityChain
          .catch(() => undefined)
          .then(() => store.observeRuntimeActivity(activity));
      });
      return () => {
        unsubscribeRuntime();
      };
    },
    async beginTurn(target: string) {
      const normalizedTarget = target.trim();
      if (normalizedTarget.length === 0) {
        return;
      }
      resetTransientState();
      const state = get({ subscribe });
      await commit({
        ...state,
        zone: {
          ...initialState.zone,
          target: {
            kind: "user_input",
            value: normalizedTarget,
            normalizedValue: normalizeTargetText(normalizedTarget),
            validation: "unvalidated_user_input",
            admissionDecision: null,
            reasonCode: null,
            citations: [],
          },
          updatedAt: Date.now(),
        },
        actors: [],
        artifacts: [],
        anchors: [],
        events: [],
        sources: [],
      });
    },
    async observeRuntimeActivity(activity: RuntimeActivity) {
      const state = get({ subscribe });
      const actorId = state.zone.activeActorId;

      if (activity.type === "planUpdate" && state.zone.zoneId === null && state.zone.target !== null) {
        await commit({
          ...state,
          zone: {
            ...state.zone,
            target: {
              ...state.zone.target,
              validation: "normalized_candidate",
              admissionDecision: "pending",
              reasonCode: "awaiting_admit",
            },
            lifecycleState: "admitting",
            phase: "admit_started",
            summary:
              activity.explanation ??
              "Admit is evaluating whether the request is a bounded browser task in the current environment.",
            updatedAt: Date.now(),
          },
        });
        return;
      }

      if (activity.type === "toolCall" && state.zone.zoneId === null && state.zone.target !== null) {
        registerToolCall(activity);
        const turnRequestId = normalizedRequestId(activity.requestId) ?? activity.requestId;
        const timestamp = Date.now();
        const targetAssessment = await assessTargetAdmission(state.zone.target, turnRequestId, activity.toolName);
        let candidateState = withSource(
          state,
          buildCitationSource(null, "user_input", turnRequestId, {
            requestId: turnRequestId,
            runId: null,
            sourceRef: "user target",
            locator: `request:${turnRequestId}`,
            excerpt: state.zone.target.value,
            createdAt: timestamp,
          }),
        );
        if (
          !hasEvent(candidateState, {
            type: "admit_started",
            requestId: turnRequestId,
            subjectRef: turnRequestId,
          })
        ) {
          candidateState = withEvent(candidateState, {
            type: "admit_started",
            zoneId: "pending",
            subjectRef: turnRequestId,
            subjectKind: "call",
            requestId: turnRequestId,
            requestKind: "turn",
            runId: null,
            decision: "pending",
            reasonCode: "admit_evaluating",
            summary: "Admit started. Verifying environment fit, resource existence, and tool availability before creating a zone.",
          });
        }
        for (const source of targetAssessment.sources) {
          candidateState = withSource(candidateState, source);
        }
        if (targetAssessment.decision === "deny") {
          candidateState = withEvent(candidateState, {
            type: "admit_decision",
            zoneId: "pending",
            subjectRef: turnRequestId,
            subjectKind: "call",
            requestId: turnRequestId,
            requestKind: "turn",
            runId: null,
            decision: "deny",
            reasonCode: targetAssessment.reasonCode,
            summary: targetAssessment.summary,
          });
          await commit({
            ...candidateState,
            zone: {
              ...candidateState.zone,
              target: {
                ...candidateState.zone.target!,
                validation: "rejected_target",
                admissionDecision: "deny",
                reasonCode: targetAssessment.reasonCode,
                citations: targetAssessment.citations,
              },
              lifecycleState: "rejected",
              phase: "admit_decision",
              summary: targetAssessment.summary,
              spawnDecision: "deny",
              spawnReasonCode: targetAssessment.reasonCode,
              blockers: [targetAssessment.summary],
              updatedAt: timestamp,
            },
          });
          return;
        }
        const normalizedTarget = state.zone.target.normalizedValue.trim();
        const zoneId = `apsix-${slugify(normalizedTarget).slice(0, 24) || "zone"}-${timestamp.toString(36)}`;
        const spawnRequestId = `${zoneId}-spawn-1`;
        const nextActorId = `${zoneId}-actor-1`;
        const runId = runIdFor(zoneId, turnRequestId);
        const workspace = await loadStoredWorkspaceSnapshot();
        const protectedSnapshotRefs = snapshotWorkspaceRefs(workspace, targetAssessment.protectedWorkspaceRefs);
        const environmentSummary =
          protectedSnapshotRefs.length === 0
            ? "Spawn prepared a single-actor execution with no protected workspace refs."
            : `Spawn prepared a single-actor execution with ${protectedSnapshotRefs.length} protected workspace refs.`;
        let nextState: ApsixZoneStoreState = {
          ...candidateState,
          zone: {
            ...candidateState.zone,
            zoneId,
            target: {
              ...candidateState.zone.target!,
              validation: "admitted_target",
              admissionDecision: "allow",
              reasonCode: targetAssessment.reasonCode,
              citations: targetAssessment.citations,
            },
            lifecycleState: "admitted",
            phase: "spawn_admitted",
            summary: "Spawn policy admitted one actor and prepared the execution environment.",
            spawnPolicyVersion: "apsix-spawn-policy-v1",
            spawnBudgetTotal: 1,
            spawnBudgetUsed: 1,
            environmentStatus: "prepared",
            environmentSummary,
            environmentMutableRefs: [],
            environmentProtectedRefs: protectedSnapshotRefs,
            environmentPreparedAt: timestamp,
            environmentVerifiedAt: null,
            authoritativeStateRef: null,
            spawnRequestId,
            spawnDecision: "allow",
            spawnReasonCode: "spawn_policy_admitted",
            activeActorId: nextActorId,
            artifactIds: [],
            blockers: [],
            updatedAt: timestamp,
          },
          actors: [
            {
              actorId: nextActorId,
              zoneId,
              admittedPartitions: ["target"],
              capabilityMask: ["browser", "mcp", "anchor"],
              budgetShare: 1,
              intent: normalizedTarget,
              status: "spawn_requested",
              requestId: null,
              runId: null,
              lastCapability: null,
              updatedAt: timestamp,
            },
          ],
          artifacts: [],
          anchors: [],
          events: candidateState.events,
          sources: candidateState.sources.map((source) =>
            source.zoneId === null ? { ...source, zoneId } : source,
          ),
        };
        nextState = withEvent(nextState, {
          type: "admit_decision",
          zoneId,
          subjectRef: turnRequestId,
          subjectKind: "call",
          requestId: turnRequestId,
          requestKind: "turn",
          runId: null,
          decision: "allow",
          reasonCode: targetAssessment.reasonCode,
          summary: `Admit allowed the request because the current environment can support the target: ${normalizedTarget}`,
        });
        nextState = withEvent(nextState, {
          type: "zone_created",
          zoneId,
          subjectRef: zoneId,
          subjectKind: "zone",
          requestId: turnRequestId,
          requestKind: "turn",
          runId: null,
          decision: null,
          reasonCode: null,
          summary: `Zone admitted for bounded target: ${normalizedTarget}`,
        });
        nextState = withEvent(nextState, {
          type: "spawn_requested",
          zoneId,
          subjectRef: nextActorId,
          subjectKind: "actor",
          requestId: spawnRequestId,
          requestKind: "spawn",
          runId: null,
          decision: "pending",
          reasonCode: "admit_allowed",
          summary: "Spawn requested after Admit accepted the target and created a zone.",
        });
        nextState = withEvent(nextState, {
          type: "spawn_decision",
          zoneId,
          subjectRef: nextActorId,
          subjectKind: "actor",
          requestId: spawnRequestId,
          requestKind: "spawn",
          runId: null,
          decision: "allow",
          reasonCode: "spawn_policy_admitted",
          summary: "Spawn admitted one actor under the single-actor budget policy.",
        });
        nextState = withEvent(nextState, {
          type: "environment_prepared",
          zoneId,
          subjectRef: zoneId,
          subjectKind: "zone",
          requestId: spawnRequestId,
          requestKind: "spawn",
          runId: null,
          decision: "allow",
          reasonCode: protectedSnapshotRefs.length === 0 ? "no_protected_refs" : "workspace_boundary_snapshotted",
          summary: environmentSummary,
        });
        await commit(nextState);
        return;
      }

      if (activity.type === "delta") {
        bufferDelta(normalizedRequestId(activity.requestId) ?? activity.requestId, activity.text);
        return;
      }

      if (state.zone.zoneId === null || actorId === null) {
        if (activity.type === "assistantMessage" && state.zone.target !== null) {
          if (state.zone.target.admissionDecision === "deny") {
            return;
          }
          await commit({
            ...state,
            zone: {
              ...initialState.zone,
              target: {
                ...state.zone.target,
                validation: "rejected_target",
                admissionDecision: "deny",
                reasonCode: "chat_mode",
              },
              lifecycleState: "rejected",
              phase: "admit_decision",
              summary:
                "Admit denied zone creation because the exchange stayed in chat mode and never produced a bounded browser task.",
              updatedAt: Date.now(),
            },
          });
        }
        return;
      }

      if (activity.type === "turnStart") {
        const turnRequestId = normalizedRequestId(activity.requestId) ?? activity.requestId;
        const runId = runIdFor(state.zone.zoneId, turnRequestId);
        let nextState: ApsixZoneStoreState = {
          ...state,
          actors: updateActor(state, actorId, (actor) => ({
            ...actor,
            status: "running",
            requestId: turnRequestId,
            runId,
            updatedAt: Date.now(),
          })),
          zone: {
            ...state.zone,
            lifecycleState: "running",
            phase: "executing",
            summary: "Execution started inside the prepared spawn environment.",
            spawnDecision: "allow",
            spawnReasonCode: "spawn_policy_admitted",
            updatedAt: Date.now(),
          },
        };
        if (!hasEvent(nextState, { type: "spawn_decision", requestId: state.zone.spawnRequestId, subjectRef: actorId })) {
          nextState = withEvent(nextState, {
            type: "spawn_decision",
            zoneId: state.zone.zoneId,
            subjectRef: actorId,
            subjectKind: "actor",
            requestId: state.zone.spawnRequestId,
            requestKind: "spawn",
            runId: null,
            decision: "allow",
            reasonCode: "browser_task_admitted",
            summary: "Spawn admitted and actor execution started.",
          });
        }
        if (!hasEvent(nextState, { type: "actor_started", requestId: turnRequestId, runId, subjectRef: actorId })) {
          nextState = withEvent(nextState, {
            type: "actor_started",
            zoneId: state.zone.zoneId,
            subjectRef: actorId,
            subjectKind: "actor",
            requestId: turnRequestId,
            requestKind: "turn",
            runId,
            decision: null,
            reasonCode: null,
            summary: `Actor started with model ${activity.model}.`,
          });
        }
        if (!hasEvent(nextState, { type: "execution_started", requestId: turnRequestId, runId, subjectRef: actorId })) {
          nextState = withEvent(nextState, {
            type: "execution_started",
            zoneId: state.zone.zoneId,
            subjectRef: actorId,
            subjectKind: "actor",
            requestId: turnRequestId,
            requestKind: "turn",
            runId,
            decision: null,
            reasonCode: "spawn_environment_prepared",
            summary: "Execution started as a single bounded actor run after spawn policy and environment preparation.",
          });
        }
        await commit(nextState);
        return;
      }

      if (activity.type === "toolCall") {
        registerToolCall(activity);
        const turnRequestId = normalizedRequestId(activity.requestId) ?? activity.requestId;
        const runId = state.actors.find((actor) => actor.actorId === actorId)?.runId ?? runIdFor(state.zone.zoneId, turnRequestId);
        await commit({
          ...state,
          actors: updateActor(state, actorId, (actor) => ({
            ...actor,
            requestId: turnRequestId,
            runId,
            lastCapability: activity.toolName,
            updatedAt: Date.now(),
          })),
          zone: {
            ...state.zone,
            lifecycleState: "running",
            phase: "executing",
            summary:
              activity.toolName === null
                ? "Execution is active inside the prepared spawn environment."
                : `Execution is active. Runtime observed internal tool activity via ${activity.toolName}.`,
            updatedAt: Date.now(),
          },
        });
        return;
      }

      if (activity.type === "toolOutput") {
        const turnRequestId = normalizedRequestId(activity.requestId) ?? activity.requestId;
        const runId = state.actors.find((actor) => actor.actorId === actorId)?.runId ?? runIdFor(state.zone.zoneId, turnRequestId);
        const callRecord = activity.callId === null ? null : callRegistry.get(activity.callId) ?? null;
        let nextState = state;
        nextState = {
          ...nextState,
          zone: {
            ...nextState.zone,
            phase: "executing",
            summary: "Execution is still running. Runtime observations may contribute evidence for later verification.",
            updatedAt: Date.now(),
          },
        };
        if (callRecord !== null && state.zone.zoneId !== null) {
          const toolName = callRecord.toolName;
          const artifactType = mutationArtifactTypeForTool(toolName, callRecord.arguments);
          if (artifactType !== null) {
            const citations = citationsForRequest(nextState, turnRequestId, runId);
            nextState = await createArtifactAndAnchor(nextState, {
              requestId: turnRequestId,
              runId,
              artifactType,
              summary: summarizeMutationArtifact(toolName, artifactType),
              body: buildMutationArtifactBody(toolName, callRecord.arguments, activity.output, citations),
              citations,
              provenanceSource: "tool_mutation",
            });
          }
          nextState = withSource(
            nextState,
            {
              citationKey: createCitationKey(
                state.zone.zoneId,
                artifactType === null ? citationSourceKindForTool(toolName) : "tool_output",
                activity.callId ?? `${turnRequestId}-${nextState.sources.length + 1}`,
              ),
              zoneId: state.zone.zoneId,
              kind: artifactType === null ? citationSourceKindForTool(toolName) : "tool_output",
              requestId: turnRequestId,
              runId,
              sourceRef: toolName ?? "tool-output",
              locator: locateCitation(toolName, callRecord.arguments, activity.output),
              excerpt: excerptContent(activity.output),
              createdAt: Date.now(),
            } satisfies ApsixCitationSourceSummary,
          );
          nextState = await syncFinalArtifactForRequest(nextState, turnRequestId, runId);
        }
        await commit(nextState);
        return;
      }

      if (activity.type === "assistantMessage") {
        bufferAssistantOutput(normalizedRequestId(activity.requestId) ?? activity.requestId, activity.content);
        return;
      }

      if (activity.type === "completed" && state.zone.zoneId === null) {
        return;
      }

      if (activity.type === "completed") {
        const turnRequestId = normalizedRequestId(activity.requestId) ?? activity.requestId;
        const runId = state.actors.find((actor) => actor.actorId === actorId)?.runId ?? runIdFor(state.zone.zoneId, turnRequestId);
        let nextState = state;
        const assistantOutput = finalOutputForRequest(turnRequestId);
        if (assistantOutput.length > 0) {
          const citations = extractInlineCitationReferences(assistantOutput);
          nextState = await createArtifactAndAnchor(nextState, {
            requestId: turnRequestId,
            runId,
            artifactType: "final_output",
            summary: "Final assistant output captured as an APSIX artifact.",
            body: buildFinalOutputArtifactBody(assistantOutput),
            citations,
            provenanceSource: "assistant_final",
          });
        }
        if (hasEvent(state, { type: "execution_completed", requestId: turnRequestId, runId, subjectRef: actorId })) {
          clearTransientStateForRequest(turnRequestId);
          return;
        }
        nextState = {
          ...nextState,
          actors: updateActor(nextState, actorId, (actor) => ({
            ...actor,
            status: "completed",
            updatedAt: Date.now(),
          })),
          zone: {
            ...nextState.zone,
            lifecycleState: "admitted",
            phase: "artifact_anchored",
            summary: "Execution completed. Waiting for final transcript reconciliation and execution verification.",
            updatedAt: Date.now(),
          },
        };
        nextState = withEvent(nextState, {
          type: "execution_completed",
          zoneId: nextState.zone.zoneId!,
          subjectRef: actorId,
          subjectKind: "actor",
          requestId: turnRequestId,
          requestKind: "turn",
          runId,
          decision: null,
          reasonCode: null,
          summary: "Execution completed and returned control to the APSIX runtime.",
        });
        await commit(nextState);
        return;
      }

      if (activity.type === "error") {
        const turnRequestId = normalizedRequestId(activity.requestId) ?? activity.requestId;
        const runId = state.actors.find((actor) => actor.actorId === actorId)?.runId ?? null;
        let nextState = state;
        const assistantOutput = finalOutputForRequest(turnRequestId);
        if (assistantOutput.length > 0) {
          const citations = extractInlineCitationReferences(assistantOutput);
          nextState = await createArtifactAndAnchor(nextState, {
            requestId: turnRequestId,
            runId,
            artifactType: "final_output",
            summary: "Final assistant output captured before the run stopped.",
            body: buildFinalOutputArtifactBody(assistantOutput),
            citations,
            provenanceSource: "assistant_final",
          });
        }
        nextState = {
          ...nextState,
          actors: updateActor(nextState, actorId, (actor) => ({
            ...actor,
            status: "failed",
            updatedAt: Date.now(),
          })),
          zone: {
            ...nextState.zone,
            lifecycleState: "failed",
            phase: "failed",
            summary: activity.message,
            blockers: [activity.message],
            updatedAt: Date.now(),
          },
        };
        nextState = withEvent(nextState, {
          type: "zone_failed",
          zoneId: nextState.zone.zoneId!,
          subjectRef: actorId,
          subjectKind: "actor",
          requestId: turnRequestId,
          requestKind: "turn",
          runId,
          decision: null,
          reasonCode: null,
          summary: activity.message,
        });
        await commit(nextState);
        clearTransientStateForRequest(turnRequestId);
      }
    },
    async block(summary: string) {
      const state = get({ subscribe });
      if (state.zone.zoneId === null) {
        return;
      }
      const activeActor = state.actors.find((actor) => actor.actorId === state.zone.activeActorId) ?? null;
      const requestId = activeActor?.requestId ?? null;
      const runId = activeActor?.runId ?? null;
      let nextState = state;
      const assistantOutput = requestId === null ? "" : finalOutputForRequest(requestId);
      if (requestId !== null && assistantOutput.length > 0) {
        const citations = extractInlineCitationReferences(assistantOutput);
        nextState = await createArtifactAndAnchor(nextState, {
          requestId,
          runId,
          artifactType: "final_output",
          summary: "Final assistant output captured before the zone was blocked.",
          body: buildFinalOutputArtifactBody(assistantOutput),
          citations,
          provenanceSource: "assistant_final",
        });
      }
      nextState = {
        ...nextState,
        zone: {
          ...nextState.zone,
          lifecycleState: "blocked",
          summary,
          blockers: summary.length > 0 ? [summary] : state.zone.blockers,
          updatedAt: Date.now(),
        },
      };
      nextState = withEvent(nextState, {
        type: "zone_blocked",
        zoneId: state.zone.zoneId,
        subjectRef: state.zone.activeActorId ?? state.zone.zoneId,
        subjectKind: state.zone.activeActorId === null ? "zone" : "actor",
        requestId: state.zone.spawnRequestId,
        requestKind: "spawn",
        runId,
        decision: null,
        reasonCode: null,
        summary,
      });
      await commit(nextState);
      if (requestId !== null) {
        clearTransientStateForRequest(requestId);
      }
    },
    async reset() {
      resetTransientState();
      await commit(structuredClone(initialState));
    },
    async finalizeCompletedTurn(transcript: TranscriptEntry[]) {
      const state = get({ subscribe });
      if (state.zone.zoneId === null || state.zone.activeActorId === null) {
        return;
      }
      const activeActor = state.actors.find((actor) => actor.actorId === state.zone.activeActorId) ?? null;
      if (activeActor?.requestId === null) {
        return;
      }
      const assistantOutput = latestAssistantReplyFromTranscript(transcript);
      if (assistantOutput.length === 0) {
        return;
      }
      let nextState = await upsertFinalArtifactForRequest(state, {
        requestId: activeActor.requestId,
        runId: activeActor.runId,
        summary: "Final assistant output captured as an APSIX artifact.",
        assistantOutput,
      });
      const verification = await verifyExecutionEnvironment(nextState);
      nextState = {
        ...nextState,
        zone: {
          ...nextState.zone,
          environmentStatus: verification.decision === "allow" ? "verified" : "violated",
          environmentSummary: verification.summary,
          environmentVerifiedAt: Date.now(),
          authoritativeStateRef:
            verification.decision === "allow" ? nextState.zone.authoritativeStateRef : null,
        },
      };
      nextState = withEvent(nextState, {
        type: "execution_verified",
        zoneId: nextState.zone.zoneId!,
        subjectRef: state.zone.activeActorId,
        subjectKind: "actor",
        requestId: activeActor.requestId,
        requestKind: "turn",
        runId: activeActor.runId,
        decision: verification.decision,
        reasonCode: verification.reasonCode,
        summary: verification.summary,
      });
      if (verification.decision === "deny") {
        nextState = rejectArtifactsForRun(
          nextState,
          activeActor.requestId,
          activeActor.runId,
          verification.reasonCode,
        );
        nextState = {
          ...nextState,
          zone: {
            ...nextState.zone,
            lifecycleState: "blocked",
            phase: "failed",
            summary: verification.summary,
            blockers: [verification.summary],
            authoritativeStateRef: null,
            updatedAt: Date.now(),
          },
        };
        nextState = withEvent(nextState, {
          type: "zone_blocked",
          zoneId: nextState.zone.zoneId!,
          subjectRef: state.zone.activeActorId,
          subjectKind: "actor",
          requestId: activeActor.requestId,
          requestKind: "turn",
          runId: activeActor.runId,
          decision: "deny",
          reasonCode: verification.reasonCode,
          summary: verification.summary,
        });
        await commit(nextState);
        clearTransientStateForRequest(activeActor.requestId);
        return;
      }
      nextState = {
        ...nextState,
        zone: {
          ...nextState.zone,
          lifecycleState: "frozen",
          phase: "frozen",
          summary:
            nextState.zone.authoritativeStateRef === null
              ? "Zone frozen after completion. No authoritative artifact was admitted."
              : "Zone frozen after authoritative artifacts were anchored.",
          updatedAt: Date.now(),
        },
      };
      if (
        !hasEvent(nextState, {
          type: "zone_frozen",
          requestId: activeActor.requestId,
          runId: activeActor.runId,
          subjectRef: nextState.zone.zoneId,
        })
      ) {
        nextState = withEvent(nextState, {
          type: "zone_frozen",
          zoneId: nextState.zone.zoneId!,
          subjectRef: nextState.zone.zoneId!,
          subjectKind: "zone",
          requestId: activeActor.requestId,
          requestKind: "turn",
          runId: activeActor.runId,
          decision: null,
          reasonCode: null,
          summary: "Zone frozen after successful completion and execution verification.",
        });
      }
      await commit(nextState);
      clearTransientStateForRequest(activeActor.requestId);
    },
  };
  return store;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTargetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function excerptContent(content: unknown): string {
  return stringifyContent(content).replace(/\s+/g, " ").trim().slice(0, 280) || "no excerpt";
}

async function assessTargetAdmission(
  target: ApsixZoneSummary["target"],
  requestId: string,
  toolName: string | null,
): Promise<{
  decision: "allow" | "deny";
  reasonCode: string;
  citations: string[];
  summary: string;
  sources: ApsixCitationSourceSummary[];
  protectedWorkspaceRefs: string[];
}> {
  if (target === null) {
    return {
      decision: "deny",
      reasonCode: "missing_target",
      citations: [],
      summary: "Target denied before spawn because no target was available.",
      sources: [],
      protectedWorkspaceRefs: [],
    };
  }

  const workspace = await loadStoredWorkspaceSnapshot();
  const timestamp = Date.now();
  const citations = [`input:${requestId}`];
  const sources: ApsixCitationSourceSummary[] = [];
  const referencedPaths = extractWorkspacePathReferences(target.value);
  const missingPaths = referencedPaths.filter(
    (path) => !workspace.files.some((file) => file.path === normalizeWorkspaceFilePath(path)),
  );

  if (toolName !== null) {
    const toolEventRef = `tool-call:${toolName}`;
    const toolAvailableRef = `tool-available:${toolName}`;
    citations.push(`event:${toolEventRef}`);
    citations.push(`event:${toolAvailableRef}`);
    sources.push(
      buildCitationSource(null, "runtime_event", toolAvailableRef, {
        requestId,
        runId: null,
        sourceRef: toolAvailableRef,
        locator: toolName,
        excerpt: `Target admission confirmed that ${toolName} is available in the current runtime.`,
        createdAt: timestamp,
      }),
    );
    sources.push(
      buildCitationSource(null, "runtime_event", toolEventRef, {
        requestId,
        runId: null,
        sourceRef: toolEventRef,
        locator: toolName,
        excerpt: `Target admission observed task pressure through ${toolName}.`,
        createdAt: timestamp,
      }),
    );
  }

  if (missingPaths.length > 0) {
    for (const path of missingPaths) {
      const missingRef = `workspace-miss:${path}`;
      citations.push(`event:${missingRef}`);
      sources.push(
        buildCitationSource(null, "runtime_event", missingRef, {
          requestId,
          runId: null,
          sourceRef: missingRef,
          locator: path,
          excerpt: `Target referenced a workspace path that is not present: ${path}`,
          createdAt: timestamp,
        }),
      );
    }
    return {
      decision: "deny",
      reasonCode: "missing_workspace_references",
      citations,
      summary:
        missingPaths.length === 1
          ? `Target denied before spawn because the referenced workspace file is missing: ${missingPaths[0]}.`
          : `Target denied before spawn because ${missingPaths.length} referenced workspace files are missing.`,
      sources,
      protectedWorkspaceRefs: referencedPaths.filter((path) => !missingPaths.includes(path)),
    };
  }

  return {
    decision: "allow",
    reasonCode: toolName === null ? "target_normalized" : "task_pressure_detected",
    citations,
    summary:
      toolName === null
        ? "Target normalized and admitted for bounded browser work."
        : `Target normalized and admitted after browser-grounded task pressure via ${toolName}.`,
    sources,
    protectedWorkspaceRefs: referencedPaths,
  };
}

function extractWorkspacePathReferences(value: string): string[] {
  return Array.from(
    new Set(
      Array.from(value.matchAll(/\/workspace\/[^\s\],)"'`]+/g)).map((match) =>
        normalizeWorkspaceFilePath(match[0] ?? ""),
      ),
    ),
  );
}

function buildCitationSource(
  zoneId: string | null,
  kind: ApsixCitationSourceSummary["kind"],
  sourceId: string,
  input: Omit<ApsixCitationSourceSummary, "citationKey" | "zoneId" | "kind">,
): ApsixCitationSourceSummary {
  return {
    citationKey: createCitationKey(zoneId, kind, sourceId),
    zoneId,
    kind,
    ...input,
  };
}

function snapshotWorkspaceRefs(
  workspace: Awaited<ReturnType<typeof loadStoredWorkspaceSnapshot>>,
  refs: string[],
): string[] {
  return refs
    .map((ref) => normalizeWorkspaceFilePath(ref))
    .map((ref) => {
      const file = workspace.files.find((entry) => entry.path === ref);
      if (file === undefined) {
        return null;
      }
      return `${ref}#${digestText(file.content)}`;
    })
    .filter((ref): ref is string => ref !== null);
}

async function verifyExecutionEnvironment(state: ApsixZoneStoreState): Promise<{
  decision: "allow" | "deny";
  reasonCode: string;
  summary: string;
}> {
  const protectedRefs = state.zone.environmentProtectedRefs;
  if (protectedRefs.length === 0) {
    return {
      decision: "allow",
      reasonCode: "no_protected_refs",
      summary: "Execution verification passed. No protected workspace refs were registered during spawn preparation.",
    };
  }
  const workspace = await loadStoredWorkspaceSnapshot();
  const violations: string[] = [];
  for (const snapshotRef of protectedRefs) {
    const [path, digest] = splitSnapshotRef(snapshotRef);
    const file = workspace.files.find((entry) => entry.path === path);
    if (file === undefined || digestText(file.content) !== digest) {
      violations.push(path);
    }
  }
  if (violations.length > 0) {
    return {
      decision: "deny",
      reasonCode: "environment_boundary_violation",
      summary:
        violations.length === 1
          ? `Execution verification failed because a protected workspace ref changed during the run: ${violations[0]}.`
          : `Execution verification failed because ${violations.length} protected workspace refs changed during the run.`,
    };
  }
  return {
    decision: "allow",
    reasonCode: "environment_verified",
    summary:
      protectedRefs.length === 1
        ? "Execution verification passed. The protected workspace ref remained unchanged."
        : `Execution verification passed. ${protectedRefs.length} protected workspace refs remained unchanged.`,
  };
}

function rejectArtifactsForRun(
  state: ApsixZoneStoreState,
  requestId: string | null,
  runId: string | null,
  reasonCode: string,
): ApsixZoneStoreState {
  if (requestId === null) {
    return state;
  }
  const rejectedIds = new Set(
    state.artifacts
      .filter(
        (artifact) =>
          artifact.provenance.requestId === requestId &&
          (runId === null || artifact.provenance.runId === runId),
      )
      .map((artifact) => artifact.artifactId),
  );
  if (rejectedIds.size === 0) {
    return state;
  }
  return {
    ...state,
    artifacts: state.artifacts.map((artifact) =>
      rejectedIds.has(artifact.artifactId)
        ? {
            ...artifact,
            status: "rejected",
            updatedAt: Date.now(),
          }
        : artifact,
    ),
    anchors: state.anchors.map((anchor) =>
      rejectedIds.has(anchor.artifactId)
        ? {
            ...anchor,
            decision: "deny",
            reasonCode,
            timestamp: Date.now(),
          }
        : anchor,
    ),
  };
}

function splitSnapshotRef(value: string): [string, string] {
  const index = value.lastIndexOf("#");
  if (index === -1) {
    return [value, ""];
  }
  return [value.slice(0, index), value.slice(index + 1)];
}

function digestText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createCitationKey(
  zoneId: string | null,
  kind: ApsixCitationSourceSummary["kind"],
  sourceId: string,
): string {
  return `apsix:${zoneId ?? "pending"}:${kind}:${encodeURIComponent(sourceId)}`;
}

function citationSourceKindForTool(toolName: string | null): ApsixCitationSourceSummary["kind"] {
  if (toolName === null) {
    return "tool_output";
  }
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("browser") ||
    normalized.includes("page") ||
    normalized.includes("dom") ||
    normalized.includes("devtools")
  ) {
    return "page_observation";
  }
  if (
    normalized.includes("workspace") ||
    normalized.includes("file") ||
    normalized.includes("list") ||
    normalized.includes("grep") ||
    normalized.includes("search") ||
    normalized.includes("find")
  ) {
    return "workspace_doc";
  }
  return "tool_output";
}

function mutationArtifactTypeForTool(
  toolName: string | null,
  args: unknown,
): ApsixArtifactSummary["artifactType"] | null {
  if (toolName === null) {
    return null;
  }
  const normalized = toolName.toLowerCase();
  if (normalized.includes("apply_patch") || normalized.includes("patch")) {
    return "patch";
  }
  if (normalized.includes("delete") || normalized.includes("remove")) {
    return "file_delete";
  }
  if (normalized.includes("write") || normalized.includes("create")) {
    return "file_write";
  }
  if (normalized.includes("update") || normalized.includes("edit") || normalized.includes("replace")) {
    return "file_update";
  }
  if (normalized.includes("workspace") && workspaceArgumentsLookMutating(args)) {
    return "state_change";
  }
  if ((normalized.includes("shell") || normalized.includes("exec") || normalized.includes("command")) && commandLooksMutating(args)) {
    return "state_change";
  }
  return null;
}

function workspaceArgumentsLookMutating(args: unknown): boolean {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  const record = args as Record<string, unknown>;
  if (typeof record.patch === "string" && record.patch.trim().length > 0) {
    return true;
  }
  if (!Array.isArray(record.operations)) {
    return false;
  }
  return record.operations.some((operation) => {
    if (operation === null || typeof operation !== "object" || Array.isArray(operation)) {
      return false;
    }
    const type = (operation as Record<string, unknown>).type;
    return typeof type === "string" && ["create", "update", "delete", "write", "patch"].includes(type);
  });
}

function commandLooksMutating(args: unknown): boolean {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  const record = args as Record<string, unknown>;
  const command =
    typeof record.cmd === "string"
      ? record.cmd
      : typeof record.command === "string"
        ? record.command
        : null;
  if (command === null) {
    return false;
  }
  return /\b(apply_patch|rm|mv|cp|mkdir|touch|tee|sed -i|perl -pi|git add|git mv)\b/.test(command);
}

function locateCitation(toolName: string | null, args: unknown, output: unknown): string | null {
  const candidates = collectLocatorCandidates(args, output);
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  return toolName;
}

function collectLocatorCandidates(...values: unknown[]): string[] {
  const matches: string[] = [];
  for (const value of values) {
    collectLocatorCandidatesInto(value, matches);
    if (matches.length >= 6) {
      break;
    }
  }
  return matches;
}

function collectLocatorCandidatesInto(value: unknown, matches: string[]) {
  if (matches.length >= 6 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith("/workspace/") || value.startsWith("http") || value.startsWith("selector:")) {
      matches.push(value);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLocatorCandidatesInto(entry, matches);
      if (matches.length >= 6) {
        return;
      }
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["path", "url", "selector", "target", "file"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      matches.push(key === "selector" ? `selector:${candidate}` : candidate);
      if (matches.length >= 6) {
        return;
      }
    }
  }
  for (const nested of Object.values(record)) {
    collectLocatorCandidatesInto(nested, matches);
    if (matches.length >= 6) {
      return;
    }
  }
}

function summarizeMutationArtifact(
  toolName: string | null,
  artifactType: ApsixArtifactSummary["artifactType"],
): string {
  const source = toolName ?? "mutation tool";
  if (artifactType === "patch") {
    return `Patch artifact captured from ${source}.`;
  }
  if (artifactType === "file_write") {
    return `File write artifact captured from ${source}.`;
  }
  if (artifactType === "file_update") {
    return `File update artifact captured from ${source}.`;
  }
  if (artifactType === "file_delete") {
    return `File delete artifact captured from ${source}.`;
  }
  return `State change artifact captured from ${source}.`;
}

function buildMutationArtifactBody(
  toolName: string | null,
  args: unknown,
  output: unknown,
  citations: string[],
): string {
  return [
    "# Mutation Artifact",
    "",
    `tool: ${toolName ?? "unknown"}`,
    "",
    "## Citations",
    ...(citations.length > 0 ? citations.map((citation) => `- ${citation}`) : ["- none"]),
    "",
    "## Arguments",
    "```json",
    stringifyContent(args),
    "```",
    "",
    "## Output",
    "```json",
    stringifyContent(output),
    "```",
  ].join("\n");
}

function buildFinalOutputArtifactBody(content: string): string {
  return content.trim();
}

function latestAssistantReplyFromTranscript(transcript: TranscriptEntry[]): string {
  const assistantEntry = [...transcript].reverse().find((entry) => entry.role === "assistant");
  return assistantEntry?.text.trim() ?? "";
}

function extractInlineCitationReferences(content: string): string[] {
  return Array.from(
    new Set(
      Array.from(content.matchAll(/\[@([^\]]+)\]/g))
        .map((match) => match[1]?.trim() ?? "")
        .filter((citation) => citation.length > 0),
    ),
  );
}

function sourceMatchesCitationReference(
  source: ApsixCitationSourceSummary,
  reference: string,
): boolean {
  const normalizedReference = reference.trim();
  if (normalizedReference.length === 0) {
    return false;
  }
  if (source.citationKey === normalizedReference) {
    return true;
  }
  if (source.locator === normalizedReference) {
    return true;
  }
  if (source.kind === "workspace_doc" && source.locator === normalizedReference) {
    return true;
  }
  if (source.kind === "page_observation" && `tool:${source.sourceRef}` === normalizedReference) {
    return true;
  }
  if (source.kind === "user_input" && source.requestId !== null && `input:${source.requestId}` === normalizedReference) {
    return true;
  }
  if (source.kind === "runtime_event" && `event:${source.sourceRef}` === normalizedReference) {
    return true;
  }
  return false;
}

export const apsixZoneStore = createApsixZoneStore();
