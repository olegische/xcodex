import { subscribeRuntimeEvent } from "./events";
import { emitRuntimeActivity } from "./activity";
import type { JsonValue, RuntimeDispatch, RuntimeEvent, RuntimeActivity } from "./types";

let notificationsBridgeInstalled = false;

export function emitActivitiesFromDispatch(dispatch: RuntimeDispatch) {
  emitActivitiesFromNotifications(dispatch.events);
}

export function emitActivitiesFromNotifications(events: RuntimeEvent[]) {
  for (const event of events) {
    const activity = runtimeActivityFromEvent(event);
    if (activity !== null) {
      emitRuntimeActivity(activity);
    }
  }
}

export function installRuntimeActivityBridge() {
  if (notificationsBridgeInstalled) {
    return;
  }
  notificationsBridgeInstalled = true;
  subscribeRuntimeEvent((event) => {
    emitActivitiesFromNotifications([event]);
  });
}

export function runtimeActivityFromEvent(event: RuntimeEvent): RuntimeActivity | null {
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
    case "turn/started":
      return mapTurnStarted(params);
    case "turn/completed":
      return mapTurnCompleted(params);
    case "item/agentMessage/delta":
      return mapAgentMessageDelta(params);
    case "item/plan/delta":
      return mapPlanDelta(params);
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

function mapTurnStarted(params: Record<string, unknown>): RuntimeActivity | null {
  const turn =
    params.turn !== null && typeof params.turn === "object" && !Array.isArray(params.turn)
      ? (params.turn as Record<string, unknown>)
      : null;
  if (turn === null || typeof turn.id !== "string") {
    return null;
  }
  return {
    type: "turnStart",
    requestId: turn.id,
    model: "active-turn",
  };
}

function mapTurnCompleted(params: Record<string, unknown>): RuntimeActivity | null {
  const turn =
    params.turn !== null && typeof params.turn === "object" && !Array.isArray(params.turn)
      ? (params.turn as Record<string, unknown>)
      : null;
  if (turn === null || typeof turn.id !== "string") {
    return null;
  }
  return {
    type: "completed",
    requestId: turn.id,
    finishReason: typeof turn.status === "string" ? turn.status : null,
  };
}

function mapAgentMessageDelta(params: Record<string, unknown>): RuntimeActivity | null {
  if (typeof params.turnId !== "string" || typeof params.delta !== "string") {
    return null;
  }
  return {
    type: "delta",
    requestId: params.turnId,
    text: params.delta,
  };
}

function mapPlanDelta(params: Record<string, unknown>): RuntimeActivity | null {
  if (typeof params.delta !== "string") {
    return null;
  }
  return {
    type: "planUpdate",
    explanation: params.delta,
    plan: [],
  };
}

function mapItemStarted(params: Record<string, unknown>): RuntimeActivity | null {
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const item = params.item !== null && typeof params.item === "object" && !Array.isArray(params.item)
    ? (params.item as Record<string, unknown>)
    : null;
  console.info("[webui] notifications:item-started", {
    turnId,
    itemType: typeof item?.type === "string" ? item.type : null,
  });
  if (turnId === null || item === null || typeof item.type !== "string") {
    return null;
  }

  if (item.type === "dynamicToolCall") {
    console.info("[webui] notifications:item-started:mapped-tool-call", {
      turnId,
      callId: typeof item.id === "string" ? item.id : null,
      toolName: typeof item.tool === "string" ? item.tool : null,
      hasArguments: item.arguments !== undefined,
    });
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
    console.info("[webui] notifications:item-started:mapped-mcp-tool-call", {
      turnId,
      callId: typeof item.id === "string" ? item.id : null,
      toolName,
      hasArguments: item.arguments !== undefined,
    });
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
  console.info("[webui] notifications:item-completed", {
    turnId,
    itemType: typeof item?.type === "string" ? item.type : null,
  });
  if (turnId === null || item === null || typeof item.type !== "string") {
    return null;
  }

  if (item.type === "dynamicToolCall") {
    console.info("[webui] notifications:item-completed:mapped-tool-output", {
      turnId,
      callId: typeof item.id === "string" ? item.id : null,
      success: typeof item.success === "boolean" ? item.success : null,
      hasContentItems: Array.isArray(item.contentItems),
    });
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
    console.info("[webui] notifications:item-completed:mapped-mcp-tool-output", {
      turnId,
      callId: typeof item.id === "string" ? item.id : null,
      hasResult: item.result !== undefined,
      hasError: item.error !== undefined,
    });
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
    if (typeof item.text !== "string" || item.text.trim().length === 0) {
      return null;
    }
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
