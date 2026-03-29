import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserDynamicToolExecutor } from "@browser-codex/wasm-browser-codex-runtime/types";
import {
  BrowserToolAuthorizationError,
  type BrowserRuntimeMode,
  createBrowserToolAuthorizationContext,
  wrapBrowserToolExecutorWithAuthorization,
} from "../src/browser-tool-authorization.ts";

test("chat mode hides the browser tool surface", async () => {
  const executor = createWrappedExecutor("chat");
  const { tools } = await executor.list();

  assert.deepEqual(tools, []);
});

test("inspect mode exposes the read-only page inspection surface", async () => {
  const executor = createWrappedExecutor("inspect");
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
      "browser__inspect_resources",
    ],
  );
});

test("interact mode adds click and fill without navigate or workspace patch", async () => {
  const executor = createWrappedExecutor("interact");
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
      "browser__inspect_resources",
      "browser__click",
      "browser__fill",
    ],
  );
});

test("agent mode adds workspace patch without navigate or evaluate", async () => {
  const executor = createWrappedExecutor("agent");
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
      "browser__inspect_resources",
      "browser__submit_patch",
    ],
  );
});

test("chaos mode exposes evaluate only for allowlisted current origins", async () => {
  const blocked = createWrappedExecutor("chaos");
  const blockedTools = await blocked.list();
  assert(!blockedTools.tools.some((tool) => tool.toolName === "evaluate"));
  assert(blockedTools.tools.some((tool) => tool.toolName === "inspect_http"));
  assert(blockedTools.tools.some((tool) => tool.toolName === "navigate"));

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
});

test("tool_search in inspect returns only tools visible in list()", async () => {
  const { createBrowserAwareToolExecutor } = await loadBrowserAwareToolExecutor();
  const executor = createBrowserAwareToolExecutor({
    async loadRuntimeMode(): Promise<BrowserRuntimeMode> {
      return "inspect";
    },
    async loadBrowserSecurityPolicy() {
      return {
        allowedOrigins: [],
        allowLocalhost: false,
        allowPrivateNetwork: false,
      };
    },
    async getCurrentPageUrl() {
      return "https://app.example.test/current";
    },
  });

  const { tools } = await executor.list();
  const listedToolNames = new Set(tools.map((tool) => `browser__${tool.toolName}`));
  const result = await executor.invoke({
    callId: "call-search-inspect",
    toolName: "tool_search",
    toolNamespace: "browser",
    input: {
      query: "inspect page dom resources performance",
      limit: 20,
    },
  });
  const searchToolNames = ((result.output as { tools?: Array<{ toolName?: string }> }).tools ?? [])
    .map((tool) => tool.toolName)
    .filter((toolName): toolName is string => typeof toolName === "string");

  assert(searchToolNames.length > 0);
  assert.deepEqual(
    searchToolNames.filter((toolName) => !listedToolNames.has(toolName)),
    [],
  );
});

test("tool_search in agent returns browser patch but not interact or chaos-only tools", async () => {
  const { createBrowserAwareToolExecutor } = await loadBrowserAwareToolExecutor();
  const executor = createBrowserAwareToolExecutor({
    async loadRuntimeMode(): Promise<BrowserRuntimeMode> {
      return "agent";
    },
    async loadBrowserSecurityPolicy() {
      return {
        allowedOrigins: [],
        allowLocalhost: false,
        allowPrivateNetwork: false,
      };
    },
    async getCurrentPageUrl() {
      return "https://app.example.test/current";
    },
  });

  const result = await executor.invoke({
    callId: "call-search-agent",
    toolName: "tool_search",
    toolNamespace: "browser",
    input: {
      query: "click fill evaluate inspect_storage inspect_cookies inspect_resources inspect_http navigate submit_patch",
      limit: 20,
    },
  });
  const searchToolNames = ((result.output as { tools?: Array<{ toolName?: string }> }).tools ?? [])
    .map((tool) => tool.toolName)
    .filter((toolName): toolName is string => typeof toolName === "string");

  assert(!searchToolNames.includes("browser__click"));
  assert(!searchToolNames.includes("browser__fill"));
  assert(!searchToolNames.includes("browser__evaluate"));
  assert(!searchToolNames.includes("browser__inspect_http"));
  assert(!searchToolNames.includes("browser__navigate"));
  assert(searchToolNames.includes("browser__inspect_resources"));
  assert(searchToolNames.includes("browser__submit_patch"));
});

test("tool_search honors getAuthorizationContext and matches agent list surface", async () => {
  const { createBrowserAwareToolExecutor } = await loadBrowserAwareToolExecutor();
  const executor = createBrowserAwareToolExecutor({
    async getAuthorizationContext() {
      return createBrowserToolAuthorizationContext({
        runtimeMode: "agent",
        browserSecurityPolicy: {
          allowedOrigins: [],
          allowLocalhost: false,
          allowPrivateNetwork: false,
        },
      });
    },
    async getCurrentPageUrl() {
      return "https://app.example.test/current";
    },
  });

  const listed = await executor.list();
  const listedToolNames = listed.tools.map((tool) => `browser__${tool.toolName}`);
  const result = await executor.invoke({
    callId: "call-search-agent-context",
    toolName: "tool_search",
    toolNamespace: "browser",
    input: {
      query: "submit_patch inspect_resources inspect_http navigate click fill",
      limit: 20,
    },
  });
  const searchToolNames = ((result.output as { tools?: Array<{ toolName?: string }> }).tools ?? [])
    .map((tool) => tool.toolName)
    .filter((toolName): toolName is string => typeof toolName === "string");

  assert.deepEqual(listedToolNames, [
    "browser__tool_search",
    "browser__inspect_page",
    "browser__inspect_dom",
    "browser__list_interactives",
    "browser__wait_for",
    "browser__inspect_resources",
    "browser__inspect_performance",
    "browser__submit_patch",
  ]);
  assert(!searchToolNames.includes("browser__inspect_http"));
  assert(!searchToolNames.includes("browser__navigate"));
  assert(!searchToolNames.includes("browser__click"));
  assert(!searchToolNames.includes("browser__fill"));
  assert(searchToolNames.includes("browser__inspect_resources"));
  assert(searchToolNames.includes("browser__submit_patch"));
  assert.deepEqual(
    searchToolNames.filter((toolName) => !listedToolNames.includes(toolName)),
    [],
  );
});

test("inspect mode blocks mutation and chaos-only tools policy-wise", async () => {
  const approvals: string[] = [];
  const executor = createWrappedExecutor("inspect", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://allowed.example.test", "https://app.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/current",
    requestApproval: async (request) => {
      approvals.push(request.canonicalToolName);
      return { decision: "allow_once" };
    },
  });

  for (const [toolName, input] of [
    ["browser__inspect_http", { url: "https://allowed.example.test/api" }],
    ["browser__navigate", { url: "https://allowed.example.test/path" }],
    ["browser__click", {}],
    ["browser__fill", { selector: "#name", value: "inspect" }],
    ["browser__submit_patch", { patch: "*** Begin Patch\n*** End Patch\n" }],
    ["browser__evaluate", { script: "return 1;" }],
  ] as const) {
    await assert.rejects(
      executor.invoke({
        callId: `call-${toolName}`,
        toolName,
        toolNamespace: "browser",
        input,
      }),
      (error: unknown) =>
        error instanceof BrowserToolAuthorizationError &&
        error.code === "insufficient_scope" &&
        error.runtimeMode === "inspect",
    );
  }

  assert.deepEqual(approvals, []);
});

test("invoke normalizes aliases through the canonical policy path", async () => {
  const calls: Array<{ toolName: string; input: unknown }> = [];
  const executor = wrapBrowserToolExecutorWithAuthorization(createRawExecutor(calls), {
    async loadRuntimeMode(): Promise<BrowserRuntimeMode> {
      return "inspect";
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
    async loadRuntimeMode(): Promise<BrowserRuntimeMode> {
      return "inspect";
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

test("browser.js:execute remains chaos-only and requires explicit approval", async () => {
  for (const runtimeMode of ["inspect", "interact", "agent"] as const) {
    const executor = createWrappedExecutor(runtimeMode, {
      browserSecurityPolicy: {
        allowedOrigins: ["https://app.example.test"],
        allowLocalhost: false,
        allowPrivateNetwork: false,
      },
      currentPageUrl: "https://app.example.test/page",
      requestApproval: async () => ({ decision: "allow_once" }),
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

  const noMediator = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://app.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/page",
  });
  await assert.rejects(
    noMediator.invoke({
      callId: "call-chaos-deny",
      toolName: "browser__run_probe",
      toolNamespace: "browser",
      input: { script: "return 1;" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "approval_mediator_unavailable",
  );

  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://app.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/page",
    requestApproval: async (request) => {
      assert.equal(request.approvalKind, "code_execution");
      assert.equal(request.origin, "https://app.example.test");
      return { decision: "allow_once" };
    },
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
    requestApproval: async () => ({ decision: "allow_once" }),
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
    requestApproval: async () => ({ decision: "allow_once" }),
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

test("inspect_http on 127.0.0.1 with allow_localhost=true reaches approval-required path", async () => {
  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["http://127.0.0.1:4173"],
      allowLocalhost: true,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "http://127.0.0.1:4173",
  });

  await assert.rejects(
    executor.invoke({
      callId: "call-http-loopback",
      toolName: "browser__inspect_http",
      toolNamespace: "browser",
      input: { url: "http://127.0.0.1:4173/health" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "approval_mediator_unavailable" &&
      error.resolvedOrigin === "http://127.0.0.1:4173",
  );
});

test("navigate and inspect_http require approval when baseline scopes are absent", async () => {
  const calls: Array<{ toolName: string; input: unknown }> = [];
  const approvals: string[] = [];
  const executor = wrapBrowserToolExecutorWithAuthorization(createRawExecutor(calls), {
    getAuthorizationContext: async () =>
      createBrowserToolAuthorizationContext({
        runtimeMode: "chaos",
        browserSecurityPolicy: {
          allowedOrigins: ["https://allowed.example.test"],
          allowLocalhost: false,
          allowPrivateNetwork: false,
        },
      }),
    getCurrentPageUrl: async () => "https://app.example.test/current",
    requestApproval: async (request) => {
      approvals.push(`${request.canonicalToolName}:${request.targetOrigin}`);
      return { decision: "allow_once" };
    },
  });

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

  assert.deepEqual(approvals, [
    "browser__navigate:https://allowed.example.test",
    "browser__inspect_http:https://allowed.example.test",
  ]);
  assert.deepEqual(calls, [
    {
      toolName: "browser__navigate",
      input: { url: "https://allowed.example.test/path" },
    },
    {
      toolName: "browser__inspect_http",
      input: { url: "https://allowed.example.test/api" },
    },
  ]);
});

test("navigate allows public web targets without an explicit allowlist entry", async () => {
  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://allowed.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/current",
    requestApproval: async () => ({ decision: "allow_once" }),
  });

  assert.deepEqual(
    await executor.invoke({
      callId: "call-nav-public",
      toolName: "browser__navigate",
      toolNamespace: "browser",
      input: { url: "https://www.google.com/search?q=xcodex" },
    }),
    { output: { ok: true } },
  );
});

test("navigate still blocks localhost and private network targets by default", async () => {
  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: [],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/current",
    requestApproval: async () => ({ decision: "allow_once" }),
  });

  await assert.rejects(
    executor.invoke({
      callId: "call-nav-localhost",
      toolName: "browser__navigate",
      toolNamespace: "browser",
      input: { url: "http://127.0.0.1:4173/health" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "localhost_not_allowed" &&
      error.resolvedOrigin === "http://127.0.0.1:4173",
  );

  await assert.rejects(
    executor.invoke({
      callId: "call-nav-private",
      toolName: "browser__navigate",
      toolNamespace: "browser",
      input: { url: "http://192.168.1.20:8080/dashboard" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "private_network_not_allowed" &&
      error.resolvedOrigin === "http://192.168.1.20:8080",
  );
});

test("inspect_http still requires allowlisted target origins", async () => {
  const executor = createWrappedExecutor("chaos", {
    browserSecurityPolicy: {
      allowedOrigins: ["https://allowed.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
    currentPageUrl: "https://app.example.test/current",
    requestApproval: async () => ({ decision: "allow_once" }),
  });

  await assert.rejects(
    executor.invoke({
      callId: "call-http-deny",
      toolName: "browser__probe_http",
      toolNamespace: "browser",
      input: { url: "https://denied.example.test/api" },
    }),
    (error: unknown) =>
      error instanceof BrowserToolAuthorizationError &&
      error.code === "origin_not_allowlisted" &&
      error.resolvedOrigin === "https://denied.example.test",
  );
});

test("allow_once grants are cleared on new turn boundaries", async () => {
  const calls: Array<{ toolName: string; input: unknown }> = [];
  const authorizationContext = createBrowserToolAuthorizationContext({
    runtimeMode: "chaos",
    browserSecurityPolicy: {
      allowedOrigins: ["https://allowed.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
  });
  let approvals = 0;
  const executor = wrapBrowserToolExecutorWithAuthorization(createRawExecutor(calls), {
    getAuthorizationContext: async () => authorizationContext,
    getCurrentPageUrl: async () => "https://app.example.test/current",
    requestApproval: async () => {
      approvals += 1;
      return { decision: "allow_once" };
    },
  });

  await executor.invoke({
    callId: "call-1",
    toolName: "browser__navigate",
    toolNamespace: "browser",
    input: { url: "https://allowed.example.test/path" },
  });
  await executor.invoke({
    callId: "call-2",
    toolName: "browser__navigate",
    toolNamespace: "browser",
    input: { url: "https://allowed.example.test/again" },
  });
  authorizationContext.clearTurnGrants();
  await executor.invoke({
    callId: "call-3",
    toolName: "browser__navigate",
    toolNamespace: "browser",
    input: { url: "https://allowed.example.test/fresh-turn" },
  });

  assert.equal(approvals, 2);
});

test("allow_for_session grants survive turn resets", async () => {
  const authorizationContext = createBrowserToolAuthorizationContext({
    runtimeMode: "chaos",
    browserSecurityPolicy: {
      allowedOrigins: ["https://allowed.example.test"],
      allowLocalhost: false,
      allowPrivateNetwork: false,
    },
  });
  let approvals = 0;
  const executor = wrapBrowserToolExecutorWithAuthorization(createRawExecutor([]), {
    getAuthorizationContext: async () => authorizationContext,
    getCurrentPageUrl: async () => "https://app.example.test/current",
    requestApproval: async () => {
      approvals += 1;
      return { decision: "allow_for_session" };
    },
  });

  await executor.invoke({
    callId: "call-1",
    toolName: "browser__probe_http",
    toolNamespace: "browser",
    input: { url: "https://allowed.example.test/api" },
  });
  authorizationContext.clearTurnGrants();
  await executor.invoke({
    callId: "call-2",
    toolName: "browser__probe_http",
    toolNamespace: "browser",
    input: { url: "https://allowed.example.test/other" },
  });

  assert.equal(approvals, 1);
});

function createWrappedExecutor(
  runtimeMode: "chat" | "inspect" | "interact" | "agent" | "chaos",
  options?: {
    browserSecurityPolicy?: {
      allowedOrigins: string[];
      allowLocalhost: boolean;
      allowPrivateNetwork: boolean;
    };
    currentPageUrl?: string | null;
    requestApproval?: (request: {
      approvalKind: string;
      canonicalToolName: string;
      origin: string;
      targetOrigin: string | null;
    }) => Promise<{ decision: "allow_once" | "allow_for_session" | "deny" | "abort" }>;
  },
) {
  return wrapBrowserToolExecutorWithAuthorization(createRawExecutor([]), {
    async getAuthorizationContext() {
      return createBrowserToolAuthorizationContext({
        runtimeMode,
        browserSecurityPolicy: options?.browserSecurityPolicy ?? {
          allowedOrigins: [],
          allowLocalhost: false,
          allowPrivateNetwork: false,
        },
      });
    },
    async getCurrentPageUrl() {
      return options?.currentPageUrl ?? "https://app.example.test/current";
    },
    requestApproval: options?.requestApproval,
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
          tool("submit_patch"),
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

async function loadBrowserAwareToolExecutor() {
  installMinimalBrowserGlobals();
  return await import("../src/browser-tools.ts");
}

function installMinimalBrowserGlobals(): void {
  const globalScope = globalThis as Record<string, unknown>;
  if (globalScope.window !== undefined && globalScope.document !== undefined) {
    return;
  }

  const documentStub = {
    title: "Test Page",
    readyState: "complete",
    activeElement: null,
    documentElement: {},
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const windowStub = {
    location: {
      href: "https://app.example.test/current",
      origin: "https://app.example.test",
      hostname: "app.example.test",
    },
    history: {
      pushState: () => {},
      replaceState: () => {},
    },
    getSelection: () => ({ toString: () => "" }),
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  globalScope.document = documentStub;
  globalScope.window = windowStub;
}
