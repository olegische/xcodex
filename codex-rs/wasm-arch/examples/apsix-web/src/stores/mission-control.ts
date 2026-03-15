import { get, writable } from "svelte/store";
import { saveMissionStateSnapshot } from "../aiAware/workspace";
import { subscribeRuntimeActivity } from "../runtime";
import { emitRuntimeActivity } from "../runtime/activity";
import type { RuntimeActivity } from "../runtime";
import type { MissionPhase, MissionStateSummary, MissionStep } from "../types";

const DEFAULT_STEPS: MissionStep[] = [
  {
    id: "observe",
    title: "Observe page context",
    status: "pending",
    detail: "Inspect current page state, AI signals, and interactive surfaces.",
  },
  {
    id: "plan",
    title: "Plan the route",
    status: "pending",
    detail: "Decide whether to use browser actions, MCP bridges, or workspace artifacts.",
  },
  {
    id: "act",
    title: "Act through tools",
    status: "pending",
    detail: "Run browser or remote MCP tools to move the mission.",
  },
  {
    id: "persist",
    title: "Persist artifacts",
    status: "pending",
    detail: "Capture durable outputs, notes, and state into the workspace.",
  },
];

const initialState: MissionStateSummary = {
  goal: "No mission running yet.",
  phase: "idle",
  lane: "idle",
  summary: "Set a mission goal in the command theater to begin the runtime loop.",
  blockers: [],
  steps: structuredClone(DEFAULT_STEPS),
  updatedAt: null,
};

function createMissionControlStore() {
  const { subscribe, set, update } = writable<MissionStateSummary>(initialState);

  function persist(state: MissionStateSummary) {
    void saveMissionStateSnapshot(state);
  }

  function commit(nextState: MissionStateSummary, emit = true) {
    set(nextState);
    persist(nextState);
    if (emit) {
      emitRuntimeActivity({
        type: "missionState",
        phase: nextState.phase,
        lane: nextState.lane,
        goal: nextState.goal,
        summary: nextState.summary,
      });
    }
  }

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    initialize() {
      persist(initialState);
      const unsubscribeRuntime = subscribeRuntimeActivity((activity) => {
        if (activity.type === "missionState") {
          return;
        }
        const current = get({ subscribe });
        const next = reduceMissionState(current, activity);
        if (next !== current) {
          commit(next, next.phase !== current.phase || next.summary !== current.summary);
        }
      });
      return () => {
        unsubscribeRuntime();
      };
    },
    startMission(goal: string) {
      const normalizedGoal = goal.trim();
      if (normalizedGoal.length === 0) {
        return;
      }
      commit({
        goal: normalizedGoal,
        phase: "observing",
        lane: "page",
        summary: "Mission started. Observing page state before planning.",
        blockers: [],
        steps: structuredClone(DEFAULT_STEPS).map((step, index) =>
          index === 0 ? { ...step, status: "in_progress" } : step,
        ),
        updatedAt: Date.now(),
      });
    },
    block(summary: string) {
      const current = get({ subscribe });
      commit({
        ...current,
        phase: "blocked",
        lane: current.lane === "idle" ? "tools" : current.lane,
        summary,
        blockers: summary.length > 0 ? [summary] : current.blockers,
        updatedAt: Date.now(),
      });
    },
    reset() {
      commit(structuredClone(initialState));
    },
  };
}

function reduceMissionState(state: MissionStateSummary, activity: RuntimeActivity): MissionStateSummary {
  if (activity.type === "turnStart") {
    return withPhase(state, "planning", "page", "Model turn started. Building an execution route.");
  }
  if (activity.type === "planUpdate") {
    return {
      ...withPhase(state, "planning", "page", activity.explanation ?? "Plan updated."),
      steps:
        activity.plan.length > 0
          ? activity.plan.map((step, index) => ({
              id: `plan-${index + 1}`,
              title: step.step,
              status: normalizeStepStatus(step.status, index === 0),
              detail: step.status,
            }))
          : state.steps,
    };
  }
  if (activity.type === "toolCall") {
    const lane = activity.toolName?.startsWith("mcp__") ? "tools" : "page";
    return updateActingState(
      state,
      lane,
      activity.toolName === null ? "Tool call started." : `Running ${activity.toolName}.`,
    );
  }
  if (activity.type === "toolOutput") {
    return {
      ...advanceStep(state, "act", "completed"),
      phase: "planning",
      summary: "Tool returned output. Re-evaluating the next move.",
      updatedAt: Date.now(),
    };
  }
  if (activity.type === "assistantMessage") {
    return {
      ...advanceStep(advanceStep(state, "persist", "completed"), "act", "completed"),
      phase: "completed",
      lane: "artifacts",
      summary: "Assistant committed a response. Mission loop completed for this turn.",
      blockers: [],
      updatedAt: Date.now(),
    };
  }
  if (activity.type === "completed") {
    return {
      ...state,
      phase: state.phase === "failed" ? "failed" : "completed",
      lane: state.phase === "failed" ? state.lane : "artifacts",
      summary: state.phase === "failed" ? state.summary : "Turn completed. Outputs are ready in transcript and workspace.",
      updatedAt: Date.now(),
    };
  }
  if (activity.type === "error") {
    return {
      ...state,
      phase: "failed",
      summary: activity.message,
      blockers: [activity.message],
      updatedAt: Date.now(),
      steps: state.steps.map((step) =>
        step.status === "in_progress" ? { ...step, status: "blocked", detail: activity.message } : step,
      ),
    };
  }
  if (activity.type === "pageEvent") {
    if (activity.kind === "navigation") {
      return withPhase(state, "waiting", "page", "Navigation detected. Waiting for the next stable surface.");
    }
    if (activity.kind === "tool" && activity.summary === "browser__wait_for") {
      return withPhase(state, "observing", "page", "Page element became available. Observing the new state.");
    }
    return state;
  }
  return state;
}

function updateActingState(
  state: MissionStateSummary,
  lane: MissionStateSummary["lane"],
  summary: string,
): MissionStateSummary {
  return {
    ...advanceStep(advanceStep(state, "observe", "completed"), "act", "in_progress"),
    phase: "acting",
    lane,
    summary,
    blockers: [],
    updatedAt: Date.now(),
  };
}

function withPhase(
  state: MissionStateSummary,
  phase: MissionPhase,
  lane: MissionStateSummary["lane"],
  summary: string,
): MissionStateSummary {
  const stepId =
    phase === "observing" || phase === "waiting"
      ? "observe"
      : phase === "planning"
        ? "plan"
        : phase === "acting"
          ? "act"
          : phase === "completed"
            ? "persist"
            : null;
  return {
    ...state,
    phase,
    lane,
    summary,
    updatedAt: Date.now(),
    steps: state.steps.map((step) => {
      if (stepId === null) {
        return step;
      }
      if (step.id === stepId) {
        return {
          ...step,
          status: phase === "completed" ? "completed" : "in_progress",
          detail: summary,
        };
      }
      return step;
    }),
  };
}

function advanceStep(
  state: MissionStateSummary,
  stepId: string,
  status: MissionStep["status"],
): MissionStateSummary {
  return {
    ...state,
    steps: state.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status,
            detail: state.summary,
          }
        : step,
    ),
  };
}

function normalizeStepStatus(status: string, fallbackInProgress: boolean): MissionStep["status"] {
  if (status === "completed") {
    return "completed";
  }
  if (status === "in_progress") {
    return "in_progress";
  }
  if (status === "blocked") {
    return "blocked";
  }
  return fallbackInProgress ? "in_progress" : "pending";
}

export const missionControlStore = createMissionControlStore();
