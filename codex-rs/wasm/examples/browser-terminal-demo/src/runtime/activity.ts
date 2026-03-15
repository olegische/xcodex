import type { ActiveModelRequest, RuntimeActivity } from "./types";

let xrouterModulePromise: Promise<import("./types").XrouterRuntimeModule> | null = null;
const runtimeActivityListeners = new Set<(activity: RuntimeActivity) => void>();
const activeModelRequests = new Map<string, ActiveModelRequest>();

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

export function registerActiveModelRequest(request: ActiveModelRequest) {
  activeModelRequests.set(request.requestId, request);
}

export function unregisterActiveModelRequest(requestId: string) {
  activeModelRequests.delete(requestId);
}

export function cancelActiveModelRequests(requestId: string) {
  for (const [activeRequestId, activeRequest] of activeModelRequests.entries()) {
    if (activeRequestId === requestId || activeRequestId.startsWith(`${requestId}:`)) {
      activeRequest.cancel();
    }
  }
}
