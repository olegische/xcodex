export type ModelTransportActivity =
  | { type: "delta"; requestId: string; text: string }
  | { type: "completed"; requestId: string; finishReason: string | null }
  | { type: "error"; requestId: string; message: string };

const listeners = new Set<(activity: ModelTransportActivity) => void>();

export function emitModelTransportActivity(activity: ModelTransportActivity) {
  for (const listener of listeners) {
    listener(activity);
  }
}

export function subscribeModelTransportActivity(
  listener: (activity: ModelTransportActivity) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
