import test from "node:test";
import assert from "node:assert/strict";
import { prepareXrouterResponsesRequest } from "@browser-codex/wasm-model-transport";

test("prepareXrouterResponsesRequest converts function_call_output content items to plain text", () => {
  const requestBody = {
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "inspect storage" }],
      },
      {
        type: "function_call",
        name: "inspect_storage",
        namespace: "browser",
        call_id: "call_1",
        arguments: "{\"includeValues\":true}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: [
          {
            type: "input_text",
            text: "ok",
          },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        name: "browser__inspect_storage",
        description: "Inspect storage",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  };

  const actual = prepareXrouterResponsesRequest(requestBody);

  assert.deepEqual(actual.input, [
    requestBody.input[0],
    requestBody.input[1],
    {
      type: "function_call_output",
      call_id: "call_1",
      output: "ok",
    },
  ]);
});

test("prepareXrouterResponsesRequest keeps tool_search tool normalization", () => {
  const requestBody = {
    input: [],
    tools: [
      {
        type: "tool_search",
        description: "Find tools",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  };

  const actual = prepareXrouterResponsesRequest(requestBody);

  assert.deepEqual(actual.tools, [
    {
      type: "function",
      name: "tool_search",
      description: "Find tools",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ]);
});
