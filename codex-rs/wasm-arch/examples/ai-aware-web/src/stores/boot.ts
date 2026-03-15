import { get, writable } from "svelte/store";

export type BootPhase =
  | "mount"
  | "theme"
  | "ui"
  | "runtime"
  | "subscriptions"
  | "workspace_browser"
  | "web_signals"
  | "page_runtime"
  | "mission_control"
  | "ready"
  | "error";

export type BootStepStatus = "pending" | "active" | "done" | "error";

export type BootStep = {
  id: Exclude<BootPhase, "ready" | "error">;
  label: string;
  status: BootStepStatus;
  detail: string;
};

export type BootState = {
  phase: BootPhase;
  message: string;
  errorDetail: string | null;
  steps: BootStep[];
};

const INITIAL_STEPS: BootStep[] = [
  { id: "mount", label: "Mount shell", status: "pending", detail: "Waiting to mount Svelte app" },
  { id: "theme", label: "Apply base theme", status: "pending", detail: "Waiting to seed visual baseline" },
  { id: "ui", label: "Load UI system", status: "pending", detail: "Waiting to load views and dashboards" },
  { id: "runtime", label: "Bootstrap runtime", status: "pending", detail: "Waiting to load WASM runtime" },
  { id: "subscriptions", label: "Wire subscriptions", status: "pending", detail: "Waiting to connect stores and activity feeds" },
  { id: "workspace_browser", label: "Load workspace browser", status: "pending", detail: "Waiting to read workspace files" },
  { id: "web_signals", label: "Load web signals", status: "pending", detail: "Waiting to scan AI-readable signals" },
  { id: "page_runtime", label: "Load page telemetry", status: "pending", detail: "Waiting to attach page observers" },
  { id: "mission_control", label: "Load mission control", status: "pending", detail: "Waiting to connect mission state" },
] as const;

const initialState: BootState = {
  phase: "mount",
  message: "Mounting shell",
  errorDetail: null,
  steps: structuredClone(INITIAL_STEPS),
};

function createBootStore() {
  const { subscribe, set, update } = writable<BootState>(initialState);

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    reset() {
      set({
        ...initialState,
        steps: structuredClone(INITIAL_STEPS),
      });
    },
    setPhase(phase: BootPhase, message: string) {
      update((state) => ({
        ...state,
        phase,
        message,
        errorDetail: phase === "error" ? state.errorDetail : null,
      }));
    },
    beginStep(phase: Exclude<BootPhase, "ready" | "error">, detail: string) {
      update((state) => ({
        ...state,
        phase,
        message: detail,
        errorDetail: null,
        steps: state.steps.map((step) =>
          step.id === phase
            ? { ...step, status: "active", detail }
            : step.status === "active"
              ? { ...step, status: "done" }
              : step,
        ),
      }));
    },
    completeStep(phase: Exclude<BootPhase, "ready" | "error">, detail: string) {
      update((state) => ({
        ...state,
        phase,
        message: detail,
        steps: state.steps.map((step) => (step.id === phase ? { ...step, status: "done", detail } : step)),
      }));
    },
    failStep(phase: BootPhase, message: string, errorDetail: string) {
      update((state) => ({
        ...state,
        phase: "error",
        message,
        errorDetail,
        steps: state.steps.map((step) =>
          step.id === phase ? { ...step, status: "error", detail: errorDetail } : step,
        ),
      }));
    },
  };
}

export const bootStore = createBootStore();
