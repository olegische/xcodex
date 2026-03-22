import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserDynamicToolExecutor } from "@browser-codex/wasm-browser-codex-runtime/types";
import { wrapBrowserToolExecutorWithAuthorization, BrowserToolAuthorizationError } from "../src/browser-tool-authorization.ts";

test("list filters tools by runtime mode and fails closed for unmapped tools", async () => {
  const executor = createWrappedExecutor("default");
  const { tools } = await executor.list();

  assert.deepEqual(
    tools.map((tool) => `${tool.toolNamespace}__${tool.toolName}`),
    [
      "browser__inspect_page",
      "browser__inspect_dom",
      "browser__list_interactives",
      "browser__wait_for",
      "browser__inspect_performance",
      "browser__tool_search",
    ],
  );
});

test("demo mode exposes broader read-only inspection surface", async () => {
  const executor = createWrappedExecutor("demo");
  const { tools } = await executor.list();

  assert(tools.some((tool) => tool.toolName === "inspect_resources"));
  assert(tools.some((tool) => tool.toolName === "inspect_dom"));
  assert(!tools.some((tool) => tool.toolName === "click"));
  assert(!tools.some((tool) => tool.toolName === "inspect_http"));
});

test("chaos mode exposes network and mutation tools but still hides evaluate", async () => {
  const executor = createWrappedExecutor("chaos");
  const { tools } = await executor.list();

  assert(tools.some((tool) => tool.toolName === "click"));
  assert(tools.some((tool) => tool.toolName === "inspect_http"));
  assert(tools.some((tool) => tool.toolName === "inspect_storage"));
  assert(!tools.some((tool) => tool.toolName === "evaluate"));
});

test("invoke normalizes aliases through the canonical policy path", async () => {
  const calls: Array<{ toolName: string; input: unknown }> = [];
  const executor = wrapBrowserToolExecutorWithAuthorization(
    createRawExecutor(calls),
    {
      async loadRuntimeMode() {
        return "default";
      },
    },
  );

  const result = await executor.invoke({
    callId: "call-1",
    toolName: "browser__page_context",
    toolNamespace: "browser",
    input: { includeSelection: true },
  });

  assert.deepEqual(result, { output: { ok: true } });
  assert.deepEqual(calls, [
    {
      toolName: "browser__inspect_page",
      input: { includeSelection: true },
    },
  ]);
});

test("invoke denies unknown tools by default", async () => {
  const executor = createWrappedExecutor("chaos");

  await assert.rejects(
    executor.invoke({
      callId: "call-1",
      toolName: "browser__custom_tool",
      toolNamespace: "browser",
      input: null,
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "unknown_tool" &&
      error.originalToolName === "browser__custom_tool",
  );
});

test("DOM inspection policy is input-sensitive", async () => {
  const calls: Array<{ toolName: string; input: unknown }> = [];
  const executor = wrapBrowserToolExecutorWithAuthorization(
    createRawExecutor(calls),
    {
      async loadRuntimeMode() {
        return "default";
      },
    },
  );

  await executor.invoke({
    callId: "call-1",
    toolName: "browser__inspect_dom",
    toolNamespace: "browser",
    input: { selector: "#app" },
  });

  await assert.rejects(
    executor.invoke({
      callId: "call-2",
      toolName: "browser__inspect_dom",
      toolNamespace: "browser",
      input: { selector: "#app", includeHtml: true },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "insufficient_scope" &&
      error.requiredScopes.includes("browser.dom.html:read"),
  );

  assert.deepEqual(calls, [
    {
      toolName: "browser__inspect_dom",
      input: { selector: "#app" },
    },
  ]);
});

test("browser.js:execute is denied in every runtime mode", async () => {
  for (const runtimeMode of ["default", "demo", "chaos"] as const) {
    const executor = createWrappedExecutor(runtimeMode);
    await assert.rejects(
      executor.invoke({
        callId: `call-${runtimeMode}`,
        toolName: "browser__run_probe",
        toolNamespace: "browser",
        input: { script: "return 1;" },
      }),
      (error: unknown) =>
        error instanceof BrowserToolAuthorizationError &&
        error.code === "unsupported_capability" &&
        error.runtimeMode === runtimeMode,
    );
  }
});

function createWrappedExecutor(runtimeMode: "default" | "demo" | "chaos") {
  return wrapBrowserToolExecutorWithAuthorization(createRawExecutor([]), {
    async loadRuntimeMode() {
      return runtimeMode;
    },
  });
}

function createRawExecutor(calls: Array<{ toolName: string; input: unknown }>): BrowserDynamicToolExecutor {
  return {
    async list() {
      return {
        tools: [
          tool("inspect_page"),
          tool("inspect_dom"),
          tool("list_interactives"),
          tool("wait_for"),
          tool("inspect_performance"),
          tool("tool_search"),
          tool("inspect_resources"),
          tool("inspect_http"),
          tool("inspect_storage"),
          tool("inspect_cookies"),
          tool("click"),
          tool("fill"),
          tool("navigate"),
          tool("evaluate"),
          tool("custom_tool"),
        ],
      };
    },
    async invoke(params) {
      calls.push({
        toolName: params.toolName,
        input: params.input,
      });
      return { output: { ok: true } };
    },
  };
}

function tool(toolName: string) {
  return {
    toolName,
    toolNamespace: "browser",
    description: toolName,
    inputSchema: {},
  };
}
