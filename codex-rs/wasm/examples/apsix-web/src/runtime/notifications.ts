import { emitRuntimeActivity } from "./activity";
import type { JsonValue, RuntimeDispatch, RuntimeEvent, RuntimeActivity } from "./types";

export function emitActivitiesFromDispatch(dispatch: RuntimeDispatch) {
  emitActivitiesFromNotifications(dispatch.events);
}

export function emitActivitiesFromNotifications(events: RuntimeEvent[]) {
  for (const event of events) {
    const activity = mapNotificationToActivity(event);
    if (activity !== null) {
      emitRuntimeActivity(activity);
    }
  }
}

function mapNotificationToActivity(event: RuntimeEvent): RuntimeActivity | null {
  if (event === null || typeof event !== "object" || typeof event.method !== "string") {
    return null;
  }

  const params =
    event.params !== null && typeof event.params === "object" && !Array.isArray(event.params)
      ? (event.params as Record<string, unknown>)
      : null;
  if (params === null) {
    return null;
  }

  switch (event.method) {
    case "item/started":
      return mapItemStarted(params);
    case "item/completed":
      return mapItemCompleted(params);
    case "error":
      return mapError(params);
    default:
      return null;
  }
}

function mapItemStarted(params: Record<string, unknown>): RuntimeActivity | null {
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const item = params.item !== null && typeof params.item === "object" && !Array.isArray(params.item)
    ? (params.item as Record<string, unknown>)
    : null;
  if (turnId === null || item === null || typeof item.type !== "string") {
    return null;
  }

  if (item.type === "dynamicToolCall") {
    return {
      type: "toolCall",
      requestId: turnId,
      callId: typeof item.id === "string" ? item.id : null,
      toolName: typeof item.tool === "string" ? item.tool : null,
      arguments: (item.arguments as JsonValue | undefined) ?? null,
    };
  }

  if (item.type === "mcpToolCall") {
    const toolName =
      typeof item.server === "string" && typeof item.tool === "string"
        ? `${normalizeMcpServerNamespace(item.server)}${item.tool}`
        : typeof item.tool === "string"
          ? item.tool
          : null;
    return {
      type: "toolCall",
      requestId: turnId,
      callId: typeof item.id === "string" ? item.id : null,
      toolName,
      arguments: (item.arguments as JsonValue | undefined) ?? null,
    };
  }

  return null;
}

function normalizeMcpServerNamespace(server: string): string {
  if (server.startsWith("mcp__") && server.endsWith("__")) {
    return server;
  }
  return `mcp__${server}__`;
}

function mapItemCompleted(params: Record<string, unknown>): RuntimeActivity | null {
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const item = params.item !== null && typeof params.item === "object" && !Array.isArray(params.item)
    ? (params.item as Record<string, unknown>)
    : null;
  if (turnId === null || item === null || typeof item.type !== "string") {
    return null;
  }

  if (item.type === "dynamicToolCall") {
    return {
      type: "toolOutput",
      requestId: turnId,
      callId: typeof item.id === "string" ? item.id : null,
      output:
        (item.contentItems as JsonValue | undefined) ??
        (item.success as JsonValue | undefined) ??
        null,
    };
  }

  if (item.type === "mcpToolCall") {
    return {
      type: "toolOutput",
      requestId: turnId,
      callId: typeof item.id === "string" ? item.id : null,
      output:
        (item.result as JsonValue | undefined) ??
        (item.error as JsonValue | undefined) ??
        null,
    };
  }

  if (item.type === "agentMessage") {
    return {
      type: "assistantMessage",
      requestId: turnId,
      content: item.text as JsonValue,
    };
  }

  return null;
}

function mapError(params: Record<string, unknown>): RuntimeActivity | null {
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const error =
    params.error !== null && typeof params.error === "object" && !Array.isArray(params.error)
      ? (params.error as Record<string, unknown>)
      : null;
  if (turnId === null || error === null || typeof error.message !== "string") {
    return null;
  }
  return {
    type: "error",
    requestId: turnId,
    message: error.message,
  };
}
