import type { ThreadReadResponse } from "../../../../app-server-protocol/schema/typescript/v2/ThreadReadResponse";
import type { StoredThreadSession } from "xcodex-runtime/types";
import type {
  SearchStoredThreadSummariesResult,
  StoredThreadSummary,
} from "./types.ts";

export function toIsoDateTime(seconds: unknown): string {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

export function toStoredThreadSummary(session: StoredThreadSession): StoredThreadSummary {
  return {
    id: session.metadata.threadId,
    rolloutId: session.metadata.rolloutId,
    cwd: session.metadata.cwd,
    title: session.metadata.name?.trim() || session.metadata.preview || "Untitled thread",
    createdAtIso: toIsoDateTime(session.metadata.createdAt),
    updatedAtIso: toIsoDateTime(session.metadata.updatedAt),
    archived: session.metadata.archived,
    lastPreview: session.metadata.preview,
    modelProvider: session.metadata.modelProvider,
  };
}

export async function listStoredThreadSummaries(input: {
  storage: {
    listSessions(): Promise<StoredThreadSession["metadata"][]>;
  };
}): Promise<StoredThreadSummary[]> {
  const sessions = await input.storage.listSessions();
  return sessions
    .map((metadata) =>
      toStoredThreadSummary({
        metadata,
        items: [],
      }),
    )
    .sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso));
}

export async function searchStoredThreadSummaries(
  input: {
    storage: {
      listSessions(): Promise<StoredThreadSession["metadata"][]>;
    };
  },
  query: string,
  limit = 200,
): Promise<SearchStoredThreadSummariesResult> {
  const summaries = await listStoredThreadSummaries(input);
  const normalized = query.trim().toLowerCase();

  if (normalized.length === 0) {
    return {
      threadIds: summaries
        .filter((summary) => !summary.archived)
        .slice(0, limit)
        .map((summary) => summary.id),
      indexedThreadCount: summaries.length,
    };
  }

  return {
    threadIds: summaries
      .filter(
        (summary) =>
          !summary.archived &&
          (summary.title.toLowerCase().includes(normalized) ||
            summary.lastPreview.toLowerCase().includes(normalized)),
      )
      .slice(0, limit)
      .map((summary) => summary.id),
    indexedThreadCount: summaries.length,
  };
}

export function toStoredThreadReadResponse(
  session: StoredThreadSession,
): ThreadReadResponse {
  const turns: Array<{
    id: string;
    status: "completed";
    error: null;
    items: Array<Record<string, unknown>>;
  }> = [];
  let currentTurn: (typeof turns)[number] | null = null;
  let currentTurnHasUserMessage = false;

  const pushTurn = (turnId: string) => {
    currentTurn = {
      id: turnId,
      status: "completed",
      error: null,
      items: [],
    };
    turns.push(currentTurn);
  };

  session.items.forEach((item, index) => {
    const record = asRecord(item);
    if (record === null) {
      return;
    }

    if (record.type === "turn_context") {
      const payload = asRecord(record.payload);
      const turnId =
        typeof payload?.turn_id === "string" && payload.turn_id.length > 0
          ? payload.turn_id
          : `${session.metadata.threadId}:turn:${turns.length}`;
      pushTurn(turnId);
      currentTurnHasUserMessage = false;
      return;
    }

    const payload = asRecord(record.payload);
    if (record.type === "event_msg" && payload?.type === "user_message") {
      const text = typeof payload.message === "string" ? payload.message.trim() : "";
      if (text.length === 0) {
        return;
      }
      if (currentTurn === null) {
        pushTurn(`${session.metadata.threadId}:turn:0`);
      }
      currentTurn?.items.push({
        id: `${session.metadata.threadId}:stored:user-event:${index}`,
        type: "userMessage",
        content: [{ type: "text", text, text_elements: [] }],
      });
      currentTurnHasUserMessage = true;
      return;
    }

    if (record.type === "event_msg" && payload?.type === "dynamic_tool_call_request") {
      const callId = typeof payload.callId === "string" ? payload.callId : "";
      const tool = typeof payload.tool === "string" ? payload.tool : "";
      if (callId.length === 0 || tool.length === 0) {
        return;
      }
      if (currentTurn === null) {
        pushTurn(`${session.metadata.threadId}:turn:0`);
      }
      const existingToolIndex =
        currentTurn?.items.findIndex(
          (entry) => entry.type === "dynamicToolCall" && entry.id === callId,
        ) ?? -1;
      if (existingToolIndex >= 0) {
        return;
      }
      currentTurn?.items.push({
        id: callId,
        type: "dynamicToolCall",
        tool,
        arguments: payload.arguments ?? null,
        status: "inProgress",
        contentItems: null,
        success: null,
        durationMs: null,
      });
      return;
    }

    if (record.type === "event_msg" && payload?.type === "dynamic_tool_call_response") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const tool = typeof payload.tool === "string" ? payload.tool : "";
      if (callId.length === 0 || tool.length === 0) {
        return;
      }
      if (currentTurn === null) {
        pushTurn(`${session.metadata.threadId}:turn:0`);
      }
      const existingToolIndex =
        currentTurn?.items.findIndex(
          (entry) => entry.type === "dynamicToolCall" && entry.id === callId,
        ) ?? -1;
      const completedTool = {
        id: callId,
        type: "dynamicToolCall",
        tool,
        arguments: payload.arguments ?? null,
        status: payload.success === false ? "failed" : "completed",
        contentItems: normalizeStoredDynamicToolContentItems(payload.content_items),
        success: typeof payload.success === "boolean" ? payload.success : null,
        durationMs: null,
      };
      if (existingToolIndex >= 0 && currentTurn !== null) {
        currentTurn.items[existingToolIndex] = completedTool;
      } else {
        currentTurn?.items.push(completedTool);
      }
      return;
    }

    if (record.type !== "response_item") {
      return;
    }

    const payloadType = typeof payload?.type === "string" ? payload.type : "";
    const payloadRecord = payload ?? {};

    if (
      payloadType === "function_call" &&
      isBrowserBuiltinTool(payloadRecord.name, payloadRecord.namespace)
    ) {
      const callId =
        typeof payloadRecord.call_id === "string"
          ? payloadRecord.call_id
          : `${session.metadata.threadId}:tool:${index}`;
      currentTurn?.items.push({
        id: callId,
        type: "dynamicToolCall",
        tool: payloadRecord.name,
        arguments: parseStoredToolArguments(payloadRecord.arguments),
        status: "inProgress",
        contentItems: null,
        success: null,
        durationMs: null,
      });
      return;
    }

    if (payloadType === "function_call_output") {
      const callId = typeof payloadRecord.call_id === "string" ? payloadRecord.call_id : "";
      if (callId.length === 0 || currentTurn === null) {
        return;
      }
      const itemIndex = currentTurn.items.findIndex(
        (entry) => entry.type === "dynamicToolCall" && entry.id === callId,
      );
      if (itemIndex < 0) {
        return;
      }
      const existing = currentTurn.items[itemIndex] as Record<string, unknown>;
      currentTurn.items[itemIndex] = {
        ...existing,
        status: "completed",
        contentItems: normalizeStoredToolOutput(payloadRecord.output),
        success: true,
      };
      return;
    }

    if (payloadType !== "message") {
      return;
    }

    if (currentTurn === null) {
      pushTurn(`${session.metadata.threadId}:turn:0`);
    }

    const messagePayload = payload as {
      role?: string;
      content?: Array<Record<string, unknown>>;
    };
    const content = Array.isArray(messagePayload.content) ? messagePayload.content : [];

    if (messagePayload.role === "user") {
      if (currentTurnHasUserMessage) {
        return;
      }
      const text = content
        .filter((part) => part.type === "input_text" && typeof part.text === "string")
        .map((part) => String(part.text))
        .join("\n")
        .trim();
      if (text.length === 0 || isBootstrapEnvironmentContextText(text)) {
        return;
      }
      currentTurn?.items.push({
        id: `${session.metadata.threadId}:stored:user:${index}`,
        type: "userMessage",
        content: [{ type: "text", text, text_elements: [] }],
      });
      currentTurnHasUserMessage = true;
      return;
    }

    if (messagePayload.role === "assistant") {
      const text = content
        .filter((part) => part.type === "output_text" && typeof part.text === "string")
        .map((part) => String(part.text))
        .join("\n")
        .trim();
      if (text.length === 0) {
        return;
      }
      currentTurn?.items.push({
        id: `${session.metadata.threadId}:stored:assistant:${index}`,
        type: "agentMessage",
        text,
      });
    }
  });

  return {
    thread: {
      id: session.metadata.threadId,
      preview: session.metadata.preview,
      name: session.metadata.name ?? null,
      ephemeral: false,
      modelProvider: session.metadata.modelProvider,
      createdAt: session.metadata.createdAt,
      updatedAt: session.metadata.updatedAt,
      status: { type: "idle" },
      path: null,
      cwd: session.metadata.cwd,
      cliVersion: "",
      source: "unknown",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      turns,
    },
  } as ThreadReadResponse;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isBootstrapEnvironmentContextText(value: string): boolean {
  return /^<environment_context>\s*[\s\S]*<\/environment_context>$/u.test(value.trim());
}

function parseStoredToolArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isBrowserBuiltinTool(name: unknown, namespace?: unknown): name is string {
  if (typeof name !== "string") {
    return false;
  }
  if (namespace !== undefined && namespace !== null && namespace !== "browser") {
    return false;
  }
  return ["read_file", "list_dir", "grep_files", "apply_patch", "update_plan", "request_user_input"].includes(name);
}

function normalizeStoredToolOutput(output: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(output)) {
    return null;
  }
  const items: Array<Record<string, unknown>> = [];
  output.forEach((entry) => {
    const record = asRecord(entry);
    if (record === null) {
      return;
    }
    if (record.type === "input_text" && typeof record.text === "string") {
      items.push({ type: "inputText", text: record.text });
      return;
    }
    if (record.type === "input_image" && typeof record.image_url === "string") {
      items.push({ type: "inputImage", imageUrl: record.image_url });
    }
  });
  return items.length > 0 ? items : null;
}

function normalizeStoredDynamicToolContentItems(
  contentItems: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(contentItems)) {
    return null;
  }
  const items: Array<Record<string, unknown>> = [];
  contentItems.forEach((entry) => {
    const record = asRecord(entry);
    if (record === null) {
      return;
    }
    if (record.type === "inputText" && typeof record.text === "string") {
      items.push({ type: "inputText", text: record.text });
      return;
    }
    if (record.type === "inputImage" && typeof record.imageUrl === "string") {
      items.push({ type: "inputImage", imageUrl: record.imageUrl });
    }
  });
  return items.length > 0 ? items : null;
}
