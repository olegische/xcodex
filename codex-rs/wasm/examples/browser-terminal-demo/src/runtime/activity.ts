import type { RuntimeActivity } from "./types";

let xrouterModulePromise: Promise<import("./types").XrouterRuntimeModule> | null = null;
const runtimeActivityListeners = new Set<(activity: RuntimeActivity) => void>();
const activeModelCancels = new Map<string, () => void>();
export function getXrouterModulePromise() {
  return xrouterModulePromise;
}

export function setXrouterModulePromise(promise: Promise<import("./types").XrouterRuntimeModule>) {
  xrouterModulePromise = promise;
}

export function emitRuntimeActivity(activity: RuntimeActivity) {
  for (const listener of runtimeActivityListeners) {
    listener(activity);
  }
}

export function subscribeRuntimeActivity(listener: (activity: RuntimeActivity) => void): () => void {
  runtimeActivityListeners.add(listener);
  return () => {
    runtimeActivityListeners.delete(listener);
  };
}

export function registerActiveModelRequest(request: {
  requestId: string;
  cancel: () => void;
}) {
  activeModelCancels.set(request.requestId, request.cancel);
}

export function unregisterActiveModelRequest(requestId: string) {
  activeModelCancels.delete(requestId);
}

export function cancelActiveModelRequests(requestId: string) {
  for (const [activeRequestId, cancel] of activeModelCancels.entries()) {
    if (activeRequestId === requestId || activeRequestId.startsWith(`${requestId}:`)) {
      cancel();
    }
  }
}
