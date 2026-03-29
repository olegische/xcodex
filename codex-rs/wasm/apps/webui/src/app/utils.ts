export function isCancellationError(error: unknown): boolean {
  if (error !== null && typeof error === "object") {
    const maybeRecord = error as { code?: unknown; message?: unknown };
    if (maybeRecord.code === "cancelled") {
      return true;
    }
    if (typeof maybeRecord.message === "string") {
      const messageText = maybeRecord.message.toLowerCase();
      return messageText.includes("cancelled") || messageText.includes("canceled");
    }
  }
  return false;
}
