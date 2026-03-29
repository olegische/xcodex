import OpenAI from "openai";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import {
  asRecord,
  formatErrorMessage,
  SSE_HEADERS,
  unixTimestampSeconds,
} from "./shared.ts";

type OpenAiResponseCreateParams = OpenAI.Responses.ResponseCreateParams;
type OpenAiResponse = OpenAI.Responses.Response;
type OpenAiResponseInputItem = OpenAI.Responses.ResponseInputItem;
type OpenAiResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent;

export type OpenAiClientOptions = ConstructorParameters<typeof OpenAI>[0];
export type OpenAiFetch = NonNullable<OpenAiClientOptions["fetch"]>;
export type { OpenAiResponseCreateParams, OpenAiResponse, OpenAiResponseInputItem, OpenAiResponseStreamEvent };

export type ActiveTurnState = {
  responseId: string;
  threadId: string;
  turnId: string | null;
  requestBody: OpenAiResponseCreateParams;
  inputItems: OpenAiResponseInputItem[];
  response: OpenAiResponse;
  sequenceNumber: number;
  assistantOutputIndex: number | null;
  assistantItemId: string | null;
  assistantText: string;
  unsubscribe: (() => void) | null;
  completed: boolean;
  cancelled: boolean;
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
  writeChain: Promise<void>;
  resolveDone?: () => void;
  rejectDone?: (error: unknown) => void;
  donePromise: Promise<void>;
};

export function createInitialResponseSnapshot(args: {
  responseId: string;
  model: string;
  requestBody: OpenAiResponseCreateParams;
}): OpenAiResponse {
  const createdAt = unixTimestampSeconds();
  return {
    id: args.responseId,
    created_at: createdAt,
    output_text: "",
    error: null,
    incomplete_details: null,
    instructions:
      typeof args.requestBody.instructions === "string" ? args.requestBody.instructions : null,
    metadata: (args.requestBody.metadata ?? null) as Record<string, string> | null,
    model: args.model,
    object: "response",
    output: [],
    parallel_tool_calls: args.requestBody.parallel_tool_calls ?? false,
    temperature: args.requestBody.temperature ?? null,
    tool_choice: args.requestBody.tool_choice ?? "auto",
    tools: args.requestBody.tools ?? [],
    top_p: args.requestBody.top_p ?? null,
    background: args.requestBody.background ?? null,
    status: "in_progress",
    text: args.requestBody.text ?? { format: { type: "text" } },
    truncation: args.requestBody.truncation ?? "disabled",
    usage: null,
    user: args.requestBody.user ?? null,
    max_output_tokens:
      typeof args.requestBody.max_output_tokens === "number"
        ? args.requestBody.max_output_tokens
        : null,
    max_tool_calls:
      typeof args.requestBody.max_tool_calls === "number" ? args.requestBody.max_tool_calls : null,
    previous_response_id: args.requestBody.previous_response_id ?? null,
    reasoning: args.requestBody.reasoning ?? null,
    safety_identifier: args.requestBody.safety_identifier ?? null,
    service_tier: args.requestBody.service_tier ?? "auto",
  } as OpenAiResponse;
}

export function finalizeSnapshot(
  state: ActiveTurnState,
  status: "completed" | "cancelled",
): OpenAiResponse {
  const snapshot = structuredClone(state.response);
  if (state.assistantOutputIndex !== null) {
    const assistantItem = asRecord(snapshot.output[state.assistantOutputIndex]);
    const content = Array.isArray(assistantItem?.content) ? assistantItem.content : [];
    const firstPart = asRecord(content[0]);
    if (firstPart !== null && typeof firstPart.text === "string" && firstPart.text.length === 0) {
      firstPart.text = state.assistantText;
    }
  }
  snapshot.status = status;
  snapshot.completed_at = unixTimestampSeconds();
  snapshot.output_text = snapshot.output
    .flatMap((item) => {
      const record = asRecord(item);
      if (record?.type !== "message" || !Array.isArray(record.content)) {
        return [];
      }
      return record.content.flatMap((contentItem) => {
        const contentRecord = asRecord(contentItem);
        return contentRecord?.type === "output_text" && typeof contentRecord.text === "string"
          ? [contentRecord.text]
          : [];
      });
    })
    .join("");
  return snapshot;
}

export function ensureAssistantOutputItem(state: ActiveTurnState): {
  outputIndex: number;
  created: boolean;
} {
  if (state.assistantOutputIndex !== null) {
    return {
      outputIndex: state.assistantOutputIndex,
      created: false,
    };
  }
  const itemId = `${state.responseId}:assistant`;
  state.assistantItemId = itemId;
  const item = {
    id: itemId,
    type: "message",
    role: "assistant",
    status: "in_progress",
    content: [
      {
        type: "output_text",
        text: "",
        annotations: [],
      },
    ],
  };
  const outputIndex = state.response.output.push(item as never) - 1;
  state.assistantOutputIndex = outputIndex;
  return {
    outputIndex,
    created: true,
  };
}

export function normalizeRawResponseItem(
  value: unknown,
  state: ActiveTurnState,
): { kind: "assistant_message" | "other"; item: Record<string, unknown> } | null {
  const item = asRecord(value);
  if (item === null || typeof item.type !== "string") {
    return null;
  }

  switch (item.type) {
    case "message":
      return {
        kind: "assistant_message",
        item: {
          id: state.assistantItemId ?? `${state.responseId}:assistant`,
          type: "message",
          role: "assistant",
          status: "completed",
          phase: item.phase ?? null,
          content: normalizeOutputContent(item.content),
        },
      };
    case "reasoning":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:reasoning:${state.response.output.length}`,
          type: "reasoning",
          status: "completed",
          encrypted_content:
            typeof item.encrypted_content === "string" ? item.encrypted_content : null,
          summary: Array.isArray(item.summary)
            ? item.summary
                .filter((entry): entry is string => typeof entry === "string")
                .map((text) => ({ type: "summary_text", text }))
            : [],
          content: Array.isArray(item.content)
            ? item.content
                .filter((entry): entry is string => typeof entry === "string")
                .map((text) => ({ type: "reasoning_text", text }))
            : [],
        },
      };
    case "function_call":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:function:${String(item.call_id ?? state.response.output.length)}`,
          type: "function_call",
          status: "completed",
          name: item.name,
          namespace: item.namespace,
          arguments: item.arguments,
          call_id: item.call_id,
        },
      };
    case "function_call_output":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:function-output:${String(item.call_id ?? state.response.output.length)}`,
          type: "function_call_output",
          status: "completed",
          call_id: item.call_id,
          output: normalizeFunctionOutput(item.output),
        },
      };
    case "local_shell_call":
      return {
        kind: "other",
        item: {
          id: `${state.responseId}:local-shell:${String(item.call_id ?? state.response.output.length)}`,
          type: "local_shell_call",
          status: normalizeLocalShellStatus(item.status),
          call_id:
            typeof item.call_id === "string"
              ? item.call_id
              : `${state.responseId}:local-shell-call`,
          action: item.action,
        },
      };
    default:
      return null;
  }
}

export function normalizeOpenAiInputItems(
  input: OpenAiResponseCreateParams["input"],
): OpenAiResponseInputItem[] {
  if (typeof input === "string") {
    return [createTextInputItem(input)];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((entry) => normalizeOpenAiInputItem(entry));
}

export function normalizeUserInput(
  inputItems: OpenAiResponseInputItem[],
): Array<Record<string, unknown>> {
  const userInput: Array<Record<string, unknown>> = [];
  for (const item of inputItems) {
    const record = asRecord(item);
    if (record === null) {
      continue;
    }
    if (record.type === "message" && Array.isArray(record.content)) {
      for (const entry of record.content) {
        const content = asRecord(entry);
        if (content?.type === "input_text" && typeof content.text === "string") {
          userInput.push({
            type: "text",
            text: content.text,
            text_elements: [],
          });
        } else if (content?.type === "input_image" && typeof content.image_url === "string") {
          userInput.push({
            type: "image",
            url: content.image_url,
          });
        }
      }
    }
  }
  return userInput;
}

export function normalizeInstructions(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

export function normalizeOutputSchema(requestBody: OpenAiResponseCreateParams): JsonValue | null {
  const text = asRecord(requestBody.text);
  const format = asRecord(text?.format);
  if (format?.type !== "json_schema") {
    return null;
  }
  return (format.schema ?? null) as JsonValue | null;
}

export function assertSupportedRequest(requestBody: OpenAiResponseCreateParams): void {
  if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
    throw new Error("Responses tools are not supported by the Codex adapter yet.");
  }
  const instructions = requestBody.instructions;
  if (Array.isArray(instructions)) {
    throw new Error("Array-based responses instructions are not supported yet.");
  }
}

export async function writeSseEvent(
  state: ActiveTurnState,
  event: OpenAiResponseStreamEvent,
): Promise<void> {
  if (state.streamWriter === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  state.writeChain = state.writeChain.then(async () => {
    if (state.streamWriter === undefined) {
      return;
    }
    await state.streamWriter.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  });
  await state.writeChain;
}

export async function closeStream(state: ActiveTurnState): Promise<void> {
  if (state.streamWriter === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  state.writeChain = state.writeChain.then(async () => {
    if (state.streamWriter === undefined) {
      return;
    }
    await state.streamWriter.write(encoder.encode("data: [DONE]\n\n"));
    await state.streamWriter.close();
  });
  await state.writeChain;
  state.streamWriter = undefined;
}

export function nextSequenceNumber(state: ActiveTurnState): number {
  const value = state.sequenceNumber;
  state.sequenceNumber += 1;
  return value;
}

export function extractOutputText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((entry) => {
      const record = asRecord(entry);
      return record?.type === "output_text" && typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

export async function createReplayStreamResponse(response: OpenAiResponse): Promise<Response> {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const replayResponse = new Response(stream.readable, {
    status: 200,
    headers: SSE_HEADERS,
  });
  void (async () => {
    const encoder = new TextEncoder();
    let sequenceNumber = 0;
    const write = async (event: OpenAiResponseStreamEvent) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    };

    await write({
      type: "response.created",
      sequence_number: sequenceNumber++,
      response: structuredClone(response),
    } satisfies OpenAiResponseStreamEvent);

    for (const [index, item] of response.output.entries()) {
      await write({
        type: "response.output_item.added",
        sequence_number: sequenceNumber++,
        output_index: index,
        item,
      } as OpenAiResponseStreamEvent);
      await write({
        type: "response.output_item.done",
        sequence_number: sequenceNumber++,
        output_index: index,
        item,
      } as OpenAiResponseStreamEvent);
    }

    await write({
      type: "response.completed",
      sequence_number: sequenceNumber++,
      response: structuredClone(response),
    } satisfies OpenAiResponseStreamEvent);
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
  })();

  return replayResponse;
}

export function normalizeRoute(url: URL): {
  pathname: string;
  responseId: string | null;
} {
  const rawPathname = url.pathname.replace(/\/+$/, "");
  const pathname = rawPathname.startsWith("/v1/") ? rawPathname.slice(3) : rawPathname;
  const match = pathname.match(/^\/responses\/([^/]+)(?:\/.*)?$/);
  return {
    pathname,
    responseId: match?.[1] ?? null,
  };
}

function normalizeOutputContent(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (item === null) {
      return [];
    }
    if (item.type === "output_text" && typeof item.text === "string") {
      return [{ type: "output_text", text: item.text, annotations: [] }];
    }
    if (item.type === "input_text" && typeof item.text === "string") {
      return [{ type: "output_text", text: item.text, annotations: [] }];
    }
    return [];
  });
}

function normalizeFunctionOutput(value: unknown): string | Array<Record<string, unknown>> {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return JSON.stringify(value ?? null);
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (item === null) {
      return [];
    }
    if (item.type === "inputText" && typeof item.text === "string") {
      return [{ type: "input_text", text: item.text }];
    }
    return [];
  });
}

function normalizeLocalShellStatus(value: unknown): "in_progress" | "completed" | "incomplete" {
  return value === "completed" ? "completed" : value === "in_progress" ? "in_progress" : "incomplete";
}

function normalizeOpenAiInputItem(value: OpenAiResponseInputItem): OpenAiResponseInputItem[] {
  if (typeof value === "string") {
    return [createTextInputItem(value)];
  }
  const item = asRecord(value);
  if (item === null) {
    return [];
  }
  if (item.type === "message" && Array.isArray(item.content)) {
    return item.content.flatMap((entry) => {
      const content = asRecord(entry);
      if (content?.type === "input_text" && typeof content.text === "string") {
        return [createTextInputItem(content.text)];
      }
      if (content?.type === "input_image" && typeof content.image_url === "string") {
        return [
          {
            id: crypto.randomUUID(),
            type: "input_image",
            detail: content.detail ?? "auto",
            image_url: content.image_url,
          } as OpenAiResponseInputItem,
        ];
      }
      return [];
    });
  }
  if (item.type === "input_text" && typeof item.text === "string") {
    return [value];
  }
  return [];
}

function createTextInputItem(text: string): OpenAiResponseInputItem {
  return {
    id: crypto.randomUUID(),
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text,
      },
    ],
  } as OpenAiResponseInputItem;
}
