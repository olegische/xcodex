import type { RuntimeEvent } from "./types";

const runtimeEventListeners = new Set<(event: RuntimeEvent) => void>();

export function emitRuntimeEvent(event: RuntimeEvent) {
  for (const listener of runtimeEventListeners) {
    listener(event);
  }
}

export function emitRuntimeEvents(events: RuntimeEvent[]) {
  for (const event of events) {
    emitRuntimeEvent(event);
  }
}

export function subscribeRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void {
  runtimeEventListeners.add(listener);
  return () => {
    runtimeEventListeners.delete(listener);
  };
}
