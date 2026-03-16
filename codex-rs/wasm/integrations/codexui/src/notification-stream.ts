import type { CodexUiNotification } from "./types";

export class NotificationStream {
  private readonly listeners = new Set<(notification: CodexUiNotification) => void>();

  emit(notification: CodexUiNotification) {
    for (const listener of this.listeners) {
      listener(notification);
    }
  }

  subscribe(listener: (notification: CodexUiNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
