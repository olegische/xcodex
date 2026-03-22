import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserDynamicToolExecutor } from "@browser-codex/wasm-browser-codex-runtime/types";
import { BrowserToolAuthorizationError, wrapBrowserToolExecutorWithAuthorization } from "../src/browser-tool-authorization.ts";

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

test("chaos mode exposes evaluate only for allowlisted current origins", async () => {
  const blocked = createWrappedExecutor("chaos");
  const blockedTools = await blocked.list();
  assert(!blockedTools.tools.some((tool) => tool.toolName === "evaluate"));

  const allowed = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://app.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/dashboard",
  });
  const allowedTools = await allowed.list();

  assert(allowedTools.tools.some((tool) => tool.toolName === "evaluate"));
  assert(allowedTools.tools.some((tool) => tool.toolName === "inspect_http"));
  assert(allowedTools.tools.some((tool) => tool.toolName === "navigate"));
});

test("invoke normalizes aliases through the canonical policy path", async () => {
  const calls: Array<{ toolName: string; input: unknown }> = [];
  const executor = wrapBrowserToolExecutorWithAuthorization(createRawExecutor(calls), {
    async loadRuntimeMode() {
      return "default";
    },
  });

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
  const executor = wrapBrowserToolExecutorWithAuthorization(createRawExecutor(calls), {
    async loadRuntimeMode() {
      return "default";
    },
  });

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

test("browser.js:execute requires chaos and an allowlisted non-local origin", async () => {
  for (const runtimeMode of ["default", "demo"] as const) {
    const executor = createWrappedExecutor(runtimeMode, {
      browserSecurityPolicy: {
        allowedOrigins: ["https://app.example.test"],
        allowLocalhost: false,
        allowPrivateNetwork: false,
      },
      currentPageUrl: "https://app.example.test/page",
    });
    await assert.rejects(
      executor.invoke({
        callId: `call-${runtimeMode}`,
        toolName: "browser__run_probe",
        toolNamespace: "browser",
        input: { script: "return 1;" },
      }),
      (error: unknown) =>
        error instanceof BrowserToolAuthorizationError &&
        error.code === "insufficient_scope" &&
        error.runtimeMode === runtimeMode,
    );
  }

  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://app.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/page",
  });
  const result = await executor.invoke({
    callId: "call-chaos",
    toolName: "browser__run_probe",
    toolNamespace: "browser",
    input: { script: "return 1;" },
  });
  assert.deepEqual(result, { output: { ok: true } });
});

test("evaluate is blocked on localhost and private network origins by default", async () => {
  const localhostExecutor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["http://localhost:3000"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "http://localhost:3000",
  });
  await assert.rejects(
    localhostExecutor.invoke({
      callId: "call-local",
      toolName: "browser__evaluate",
      toolNamespace: "browser",
      input: { script: "return 1;" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "localhost_not_allowed" &&
      error.resolvedOrigin === "http://localhost:3000",
  );

  const privateExecutor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["http://192.168.1.20:8080"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "http://192.168.1.20:8080",
  });
  await assert.rejects(
    privateExecutor.invoke({
      callId: "call-private",
      toolName: "browser__evaluate",
      toolNamespace: "browser",
      input: { script: "return 1;" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "private_network_not_allowed" &&
      error.resolvedOrigin === "http://192.168.1.20:8080",
  );
});

test("evaluate can be explicitly enabled for localhost and private network origins", async () => {
  const localhostExecutor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["http://localhost:3000"],
      allowLocalhost: true,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "http://localhost:3000",
  });
  assert.deepEqual(
    await localhostExecutor.invoke({
      callId: "call-local-allow",
      toolName: "browser__evaluate",
      toolNamespace: "browser",
      input: { script: "return 1;" },
    }),
    { output: { ok: true } },
  );

  const privateExecutor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["http://10.0.0.5:5173"],
      allowLocalhost: false,
      allowPrivateNetwork: true,
    },
    currentPageUrl: "http://10.0.0.5:5173",
  });
  assert.deepEqual(
    await privateExecutor.invoke({
      callId: "call-private-allow",
      toolName: "browser__evaluate",
      toolNamespace: "browser",
      input: { script: "return 1;" },
    }),
    { output: { ok: true } },
  );
});

test("navigate and inspect_http require allowlisted target origins", async () => {
  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://allowed.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/current",
  });

  await assert.rejects(
    executor.invoke({
      callId: "call-nav-deny",
      toolName: "browser__navigate",
      toolNamespace: "browser",
      input: { url: "https://denied.example.test/path" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "origin_not_allowlisted" &&
      error.resolvedOrigin === "https://denied.example.test",
  );

  assert.deepEqual(
    await executor.invoke({
      callId: "call-nav-allow",
      toolName: "browser__navigate",
      toolNamespace: "browser",
      input: { url: "https://allowed.example.test/path" },
    }),
    { output: { ok: true } },
  );

  assert.deepEqual(
    await executor.invoke({
      callId: "call-http-allow",
      toolName: "browser__probe_http",
      toolNamespace: "browser",
      input: { url: "https://allowed.example.test/api" },
    }),
    { output: { ok: true } },
  );
});

function createWrappedExecutor(
  runtimeMode: "default" | "demo" | "chaos",
  options?: {
    browserSecurityPolicy?: {
      allowedOrigins: string[];
      allowLocalhost: boolean;
      allowPrivateNetwork: boolean;
    };
    currentPageUrl?: string | null;
  },
) {
  return wrapBrowserToolExecutorWithAuthorization(createRawExecutor([]), {
    async loadRuntimeMode() {
      return runtimeMode;
    },
    async loadBrowserSecurityPolicy() {
      return options?.browserSecurityPolicy ?? {
        allowedOrigins: [],
        allowLocalhost: false,
        allowPrivateNetwork: false,
      };
    },
    async getCurrentPageUrl() {
      return options?.currentPageUrl ?? "https://app.example.test/current";
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
