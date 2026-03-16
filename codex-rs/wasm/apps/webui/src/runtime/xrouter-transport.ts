import type OpenAI from "openai";
import type { JsonValue } from "./types";

export function prepareXrouterResponsesRequest(
  requestBody: OpenAI.Responses.ResponseCreateParams,
): OpenAI.Responses.ResponseCreateParams {
  const normalizedTools = Array.isArray(requestBody.tools)
    ? requestBody.tools
        .map((tool) => normalizeTransportToolForXrouter(tool as JsonValue))
        .filter((tool): tool is JsonValue => tool !== null)
    : requestBody.tools;
  return {
    ...requestBody,
    ...(normalizedTools === undefined ? {} : { tools: normalizedTools }),
  };
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
