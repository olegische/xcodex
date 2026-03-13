import { get, writable } from "svelte/store";

export type BootPhase = "shell" | "ui" | "runtime" | "workspace" | "ready" | "error";

export type BootState = {
  phase: BootPhase;
  message: string;
};

const initialState: BootState = {
  phase: "shell",
  message: "Rendering shell",
};

function createBootStore() {
  const { subscribe, set } = writable<BootState>(initialState);

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    reset() {
      set(initialState);
    },
    setPhase(phase: BootPhase, message: string) {
      set({ phase, message });
    },
  };
}

export const bootStore = createBootStore();
