import type OpenAI from "openai";
import type { JsonValue } from "../../../../app-server-protocol/schema/typescript/serde_json/JsonValue";

export function prepareXrouterResponsesRequest(
  requestBody: OpenAI.Responses.ResponseCreateParams,
): OpenAI.Responses.ResponseCreateParams {
  const normalizedInput = Array.isArray(requestBody.input)
    ? requestBody.input.map((item: unknown) =>
        normalizeResponsesInputItemForXrouter(item as JsonValue),
      )
    : requestBody.input;
  const normalizedTools = Array.isArray(requestBody.tools)
    ? requestBody.tools
        .map((tool: unknown) => normalizeTransportToolForXrouter(tool as JsonValue))
        .filter((tool: JsonValue | null): tool is JsonValue => tool !== null)
    : requestBody.tools;
  return {
    ...requestBody,
    ...(normalizedInput === undefined ? {} : { input: normalizedInput }),
    ...(normalizedTools === undefined ? {} : { tools: normalizedTools }),
  } as OpenAI.Responses.ResponseCreateParams;
}

function normalizeResponsesInputItemForXrouter(item: JsonValue): JsonValue {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return item;
  }

  const record = item as Record<string, unknown>;
  if (record.type !== "function_call_output" && record.type !== "custom_tool_call_output") {
    return item;
  }

  return {
    ...record,
    output: normalizeFunctionCallOutputForXrouter(record.output as JsonValue),
  };
}

function normalizeFunctionCallOutputForXrouter(output: JsonValue): JsonValue {
  if (!Array.isArray(output)) {
    return output;
  }

  const textParts = output.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const content = entry as Record<string, unknown>;
    if (content.type !== "input_text" || typeof content.text !== "string") {
      return [];
    }
    const text = content.text.trim();
    return text.length > 0 ? [text] : [];
  });

  if (textParts.length === 0) {
    return output;
  }

  return textParts.join("\n");
}

function normalizeTransportToolForXrouter(tool: JsonValue): JsonValue | null {
  if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
    return null;
  }

  const record = tool as Record<string, unknown>;
  if (record.type !== "tool_search") {
    return tool;
  }

  return {
    type: "function",
    name: "tool_search",
    description: typeof record.description === "string" ? record.description : "",
    parameters:
      record.parameters !== undefined && record.parameters !== null
        ? record.parameters
        : {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
  };
}
