import type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";

export function mapXrouterOutputItemToCodexResponseItem(item: JsonValue): JsonValue | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  if (record.type === "message") {
    return {
      type: "message",
      role: typeof record.role === "string" ? record.role : "assistant",
      content: Array.isArray(record.content) ? (record.content as JsonValue[]) : [],
      end_turn: true,
    };
  }
  if (record.type === "function_call" && typeof record.name === "string") {
    const callId =
      typeof record.call_id === "string" ? record.call_id : typeof record.id === "string" ? record.id : null;
    if (callId === null) {
      return null;
    }
    if (record.name === "tool_search") {
      return {
        type: "tool_search_call",
        id: typeof record.id === "string" ? record.id : undefined,
        call_id: callId,
        execution: "client",
        arguments:
          typeof record.arguments === "string"
            ? JSON.parse(record.arguments)
            : record.arguments ?? {},
      } as JsonValue;
    }
    return {
      type: "function_call",
      id: typeof record.id === "string" ? record.id : undefined,
      call_id: callId,
      ...(typeof record.namespace === "string" && record.namespace.length > 0
        ? { name: record.name, namespace: record.namespace }
        : splitQualifiedToolNameForCodex(record.name)),
      arguments:
        typeof record.arguments === "string"
          ? record.arguments
          : record.arguments !== undefined
            ? JSON.stringify(record.arguments)
            : "{}",
    } as JsonValue;
  }
  return null;
}

export function splitQualifiedToolNameForCodex(name: string): {
  name: string;
  namespace?: string;
} {
  if (name.startsWith("browser__")) {
    return {
      name: name.slice("browser__".length),
      namespace: "browser",
    };
  }
  if (name.startsWith("mcp__")) {
    const stripped = name.slice("mcp__".length);
    const separatorIndex = stripped.indexOf("__");
    if (separatorIndex !== -1) {
      const serverName = stripped.slice(0, separatorIndex);
      return {
        name: stripped.slice(separatorIndex + "__".length),
        namespace: `mcp__${serverName}__`,
      };
    }
  }
  return { name };
}
