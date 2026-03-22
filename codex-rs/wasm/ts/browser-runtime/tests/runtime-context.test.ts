import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserCodexRuntimeContextWithDeps } from "../src/runtime-context-core.ts";
import { DEFAULT_CODEX_CONFIG, DEFAULT_DEMO_INSTRUCTIONS } from "../src/config.ts";
import { createIndexedDbCodexStorage } from "../src/storage.ts";
import type {
  AuthState,
  BrowserDynamicToolExecutor,
  BrowserRuntimeStorage,
  CodexCompatibleConfig,
  JsonValue,
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from "../src/types.ts";

test("createBrowserCodexRuntimeContext wires bootstrap defaults and config persistence", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();

  const context = await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: createWorkspaceAdapter(),
    },
    captured.deps,
  );

  assert.equal(captured.telemetryCalls, 1);
  await captured.hostDeps.loadBootstrap();
  assert.equal(captured.bootstrapArgs?.codexHome, "/codex-home");
  assert.equal(captured.bootstrapArgs?.cwd, "/workspace");
  assert.equal(
    captured.bootstrapArgs?.baseInstructions,
    DEFAULT_DEMO_INSTRUCTIONS.baseInstructions,
  );
  assert.deepEqual(await context.loadConfig(), DEFAULT_CODEX_CONFIG);

  const nextConfig: CodexCompatibleConfig = {
    ...DEFAULT_CODEX_CONFIG,
    model: "gpt-5",
  };
  await context.saveConfig(nextConfig);

  assert.deepEqual(await storage.loadConfig(), nextConfig);
});

test("createBrowserCodexRuntimeContext exposes opaque notification envelope", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();

  const context = await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: createWorkspaceAdapter(),
    },
    captured.deps,
  );

  let observed: { method: string; params: unknown } | null = null;
  const unsubscribe = context.subscribe((notification) => {
    observed = notification;
  });

  captured.emitNotification({
    method: "thread/updated",
    params: { threadId: "thread-1" },
    extra: "ignored",
  });

  assert.deepEqual(observed, {
    method: "thread/updated",
    params: { threadId: "thread-1" },
  });

  unsubscribe();
});

test("createBrowserCodexRuntimeContext respects readAccount override and allowRefresh mapping", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();
  const calls: Array<{
    authState: AuthState | null;
    config: CodexCompatibleConfig;
    allowRefresh: boolean;
  }> = [];

  await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: createWorkspaceAdapter(),
      readAccount: async (args) => {
        calls.push(args);
        return {
          account: null,
          requiresOpenaiAuth: false,
        };
      },
    },
    captured.deps,
  );

  await captured.runtimeDeps.readAccount({
    authState: null,
    config: DEFAULT_CODEX_CONFIG,
    refreshToken: true,
  });

  assert.deepEqual(calls, [
    {
      authState: null,
      config: DEFAULT_CODEX_CONFIG,
      allowRefresh: true,
    },
  ]);
});

test("createBrowserCodexRuntimeContext respects dynamicTools override", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();
  let listed = false;
  let invoked = false;
  const customTools: BrowserDynamicToolExecutor = {
    async list() {
      listed = true;
      return { tools: [] };
    },
    async invoke() {
      invoked = true;
      return { output: null };
    },
  };

  await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: createWorkspaceAdapter(),
      dynamicTools: customTools,
    },
    captured.deps,
  );

  await captured.runtimeDeps.dynamicTools.list();
  await captured.runtimeDeps.dynamicTools.invoke({
    callId: "call-1",
    toolName: "browser__inspect_page",
    toolNamespace: "browser",
    input: null,
  });

  assert.equal(listed, true);
  assert.equal(invoked, true);
  assert.notEqual(captured.runtimeDeps.dynamicTools, customTools);
});

test("createBrowserCodexRuntimeContext normalizes requestUserInput answers into JsonValue", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();

  await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: createWorkspaceAdapter(),
      requestUserInput: async () => ({
        answers: [
          {
            id: "approval",
            value: undefined,
          },
          {
            id: "config",
            value: {
              nested: ["ok", 1, true],
            },
          },
        ],
      }),
    },
    captured.deps,
  );

  const actual = await captured.runtimeDeps.requestUserInput({
    questions: [],
  });

  assert.deepEqual(actual, {
    answers: [
      {
        id: "approval",
        value: null,
      },
      {
        id: "config",
        value: {
          nested: ["ok", 1, true],
        },
      },
    ],
  });
});

test("createBrowserCodexRuntimeContext wires browser tool approval callback and clears turn grants", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();
  const approvalCalls: unknown[] = [];

  await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: createWorkspaceAdapter(),
      requestBrowserToolApproval: async (request) => {
        approvalCalls.push(request);
        return { decision: "allow_once" };
      },
    },
    captured.deps,
  );

  const approvalResponse = await captured.runtimeDeps.requestBrowserToolApproval?.({
    approvalId: "approval-1",
    toolName: "browser__navigate",
    canonicalToolName: "browser__navigate",
    requiredScopes: ["browser.page:navigate"],
    runtimeMode: "default",
    origin: "https://example.test",
    displayOrigin: "https://example.test",
    targetOrigin: "https://example.test",
    targetUrl: "https://example.test/path",
    approvalKind: "navigation",
    reason: "Navigate the current page to the requested URL.",
    grantOptions: ["allow_once", "deny"],
  });

  captured.runtimeDeps.onTurnStart?.();
  captured.runtimeDeps.onTurnStart?.();

  assert.deepEqual(approvalResponse, { decision: "allow_once" });
  assert.equal(approvalCalls.length, 1);
});

test("createBrowserCodexRuntimeContext keeps stored thread cwd on workspace root", async () => {
  const storage = createMemoryStorage();
  const captured = createCapturedDeps();
  const staleSession: StoredThreadSession = {
    metadata: {
      threadId: "thread-1",
      rolloutId: "rollout-1",
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      name: "Thread",
      preview: "Preview",
      cwd: "/codex-home",
      modelProvider: "openai",
    },
    items: [],
  };
  await storage.saveSession(staleSession);

  await createBrowserCodexRuntimeContextWithDeps(
    {
      cwd: "/codex-home",
      storage,
      workspace: createWorkspaceAdapter(),
    },
    captured.deps,
  );

  assert.deepEqual(await captured.hostDeps.loadThreadSession({ threadId: "thread-1" }), {
    session: {
      ...staleSession,
      metadata: {
        ...staleSession.metadata,
        cwd: "/workspace",
      },
    },
  });
  assert.deepEqual(await captured.hostDeps.listThreadSessions(), {
    sessions: [
      {
        ...staleSession.metadata,
        cwd: "/workspace",
      },
    ],
  });

  await captured.hostDeps.saveThreadSession({ session: staleSession });
  assert.deepEqual((await storage.loadSession("thread-1"))?.metadata.cwd, "/workspace");
  await captured.hostDeps.loadBootstrap();
  assert.equal(captured.bootstrapArgs?.cwd, "/workspace");
});

test("createIndexedDbCodexStorage persists auth, config, sessions and user config", async () => {
  installIndexedDbMock();

  type Session = StoredThreadSession;
  type Metadata = StoredThreadSessionMetadata;

  const storage = createIndexedDbCodexStorage<
    AuthState,
    CodexCompatibleConfig,
    Session,
    Metadata
  >({
    dbName: `xcodex-runtime-test-${Date.now()}`,
    dbVersion: 1,
    defaultConfig: DEFAULT_CODEX_CONFIG,
    normalizeConfig(config) {
      return config;
    },
    getSessionId(session) {
      return session.metadata.threadId;
    },
    getSessionMetadata(session) {
      return session.metadata;
    },
  });

  const authState: AuthState = {
    authMode: "apiKey",
    openaiApiKey: "sk-test",
    accessToken: null,
    refreshToken: null,
    chatgptAccountId: null,
    chatgptPlanType: null,
    lastRefreshAt: null,
  };
  const config: CodexCompatibleConfig = {
    ...DEFAULT_CODEX_CONFIG,
    model: "gpt-5",
  };
  const session: Session = {
    metadata: {
      threadId: "thread-1",
      rolloutId: "rollout-1",
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      name: "Thread",
      preview: "Preview",
      cwd: "/workspace",
      modelProvider: "openai",
    },
    items: [],
  };

  await storage.saveAuthState(authState);
  await storage.saveConfig(config);
  await storage.saveSession(session);
  const userConfig = await storage.saveUserConfig({
    content: "model = \"gpt-5\"",
  });

  assert.deepEqual(await storage.loadAuthState(), authState);
  assert.deepEqual(await storage.loadConfig(), config);
  assert.deepEqual(await storage.loadSession("thread-1"), session);
  assert.deepEqual(await storage.listSessions(), [session.metadata]);
  assert.equal(userConfig.content, "model = \"gpt-5\"");
  assert.equal((await storage.loadUserConfig())?.content, "model = \"gpt-5\"");

  await storage.deleteSession("thread-1");
  await storage.clearAuthState();
  await storage.clearConfig();

  assert.equal(await storage.loadSession("thread-1"), null);
  assert.equal(await storage.loadAuthState(), null);
  assert.deepEqual(await storage.loadConfig(), DEFAULT_CODEX_CONFIG);
});

function createWorkspaceAdapter() {
  return {
    async readFile(request: JsonValue) {
      return request;
    },
    async listDir(request: JsonValue) {
      return request;
    },
    async search(request: JsonValue) {
      return request;
    },
    async applyPatch(request: JsonValue) {
      return request;
    },
  };
}

function createMemoryStorage(): BrowserRuntimeStorage<
  AuthState,
  CodexCompatibleConfig,
  StoredThreadSession,
  StoredThreadSessionMetadata
> {
  let authState: AuthState | null = null;
  let config = structuredClone(DEFAULT_CODEX_CONFIG);
  let userConfig: { filePath: string; version: string; content: string } | null = null;
  const sessions = new Map<string, StoredThreadSession>();

  return {
    async loadSession(threadId) {
      return sessions.get(threadId) ?? null;
    },
    async saveSession(session) {
      sessions.set(session.metadata.threadId, session);
    },
    async deleteSession(threadId) {
      sessions.delete(threadId);
    },
    async listSessions() {
      return [...sessions.values()].map((session) => session.metadata);
    },
    async loadAuthState() {
      return authState;
    },
    async saveAuthState(nextAuthState) {
      authState = nextAuthState;
    },
    async clearAuthState() {
      authState = null;
    },
    async loadConfig() {
      return config;
    },
    async saveConfig(nextConfig) {
      config = nextConfig;
    },
    async clearConfig() {
      config = structuredClone(DEFAULT_CODEX_CONFIG);
    },
    async loadUserConfig() {
      return userConfig;
    },
    async saveUserConfig(input) {
      userConfig = {
        filePath: input.filePath ?? "/codex-home/config.toml",
        version: input.expectedVersion ?? "1",
        content: input.content,
      };
      return userConfig;
    },
  };
}

function createCapturedDeps() {
  let listener: ((notification: unknown) => void) | null = null;
  let telemetryCalls = 0;
  let bootstrapArgs: Record<string, unknown> | null = null;
  let runtimeDeps: Record<string, unknown> | null = null;
  let hostDeps: Record<string, unknown> | null = null;

  return {
    get telemetryCalls() {
      return telemetryCalls;
    },
    get bootstrapArgs() {
      return bootstrapArgs;
    },
    get runtimeDeps() {
      return runtimeDeps as {
        dynamicTools: BrowserDynamicToolExecutor;
        readAccount(args: {
          authState: AuthState | null;
          config: CodexCompatibleConfig;
          refreshToken: boolean;
        }): Promise<unknown>;
        requestBrowserToolApproval?(request: unknown): Promise<unknown>;
        requestUserInput(args: {
          questions: unknown[];
        }): Promise<unknown>;
        onTurnStart?(): void;
      };
    },
    get hostDeps() {
      return hostDeps as {
        loadBootstrap(): Promise<unknown>;
        loadThreadSession(args: { threadId: string }): Promise<unknown>;
        saveThreadSession(args: { session: StoredThreadSession }): Promise<unknown>;
        listThreadSessions(): Promise<unknown>;
      };
    },
    emitNotification(notification: unknown) {
      listener?.(notification);
    },
    deps: {
      async createBrowserCodexRuntime(params: {
        deps: Record<string, unknown>;
      }) {
        runtimeDeps = params.deps;
        return {
          async loadAuthState() {
            return null;
          },
          async saveAuthState() {},
          async clearAuthState() {},
          async listModels() {
            return {
              data: [],
              nextCursor: null,
            };
          },
          subscribeToNotifications(nextListener: (notification: unknown) => void) {
            listener = nextListener;
            return () => {
              listener = null;
            };
          },
        };
      },
      buildBrowserRuntimeBootstrap(args: Record<string, unknown>) {
        bootstrapArgs = args;
        return args;
      },
      createBrowserRuntimeHostFromDeps(nextHostDeps: Record<string, unknown>) {
        hostDeps = nextHostDeps;
        return nextHostDeps;
      },
      createNormalizedModelTurnRunner() {
        return async () => null;
      },
      createBrowserAwareToolExecutor(_args: {
        getAuthorizationContext(): Promise<unknown>;
        requestApproval?(request: unknown): Promise<unknown>;
      }) {
        return {
          async list() {
            return { tools: [] };
          },
          async invoke() {
            return { output: null };
          },
        };
      },
      initializePageTelemetry() {
        telemetryCalls += 1;
      },
      activeProviderApiKey(config: CodexCompatibleConfig) {
        return config.env.OPENAI_API_KEY ?? "";
      },
      createBrowserRuntimeModelTransportAdapter() {
        return {
          async runModelTurn() {
            return null;
          },
          async discoverModels() {
            return {
              data: [],
              nextCursor: null,
            };
          },
        };
      },
      defaultConfig: DEFAULT_CODEX_CONFIG,
      defaultDemoInstructions: DEFAULT_DEMO_INSTRUCTIONS,
      formatError(error: unknown) {
        return error instanceof Error ? error.message : String(error);
      },
      getActiveProvider(config: CodexCompatibleConfig) {
        return (
          config.modelProviders[config.modelProvider] ??
          DEFAULT_CODEX_CONFIG.modelProviders[DEFAULT_CODEX_CONFIG.modelProvider]
        );
      },
      async loadRuntimeModule() {
        return {
          default: async () => {},
        };
      },
      async loadXrouterRuntime() {
        return {
          default: async () => {},
        };
      },
    },
  };
}

function installIndexedDbMock(): void {
  if ("indexedDB" in globalThis) {
    return;
  }

  const databases = new Map<string, MockDatabase>();

  Object.assign(globalThis, {
    indexedDB: {
      open(name: string, _version?: number) {
        const request = new MockOpenRequest();
        queueMicrotask(() => {
          const db = databases.get(name) ?? new MockDatabase();
          databases.set(name, db);
          request.result = db as unknown as IDBDatabase;
          request.transaction = {
            objectStore(name: string) {
              return db.ensureStore(name);
            },
          } as IDBTransaction;
          request.onupgradeneeded?.(new Event("upgradeneeded"));
          request.onsuccess?.(new Event("success"));
        });
        return request as unknown as IDBOpenDBRequest;
      },
    },
  });
}

class MockOpenRequest {
  result!: IDBDatabase;
  error: Error | null = null;
  transaction: IDBTransaction | null = null;
  onerror: ((event: Event) => void) | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: Event) => void) | null = null;
}

class MockRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
}

class MockObjectStore {
  private readonly values: Map<string, unknown>;

  constructor(values: Map<string, unknown>) {
    this.values = values;
  }

  get(key: string) {
    const request = new MockRequest<unknown>();
    queueMicrotask(() => {
      request.result = this.values.get(key);
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBRequest;
  }

  getAll() {
    const request = new MockRequest<unknown[]>();
    queueMicrotask(() => {
      request.result = [...this.values.values()];
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBRequest;
  }

  put(value: unknown, key: string) {
    const request = new MockRequest<undefined>();
    queueMicrotask(() => {
      this.values.set(key, value);
      request.result = undefined;
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBRequest;
  }

  delete(key: string) {
    const request = new MockRequest<undefined>();
    queueMicrotask(() => {
      this.values.delete(key);
      request.result = undefined;
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBRequest;
  }
}

class MockDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  private readonly stores = new Map<string, Map<string, unknown>>();

  createObjectStore(name: string) {
    this.ensureStoreMap(name);
    return this.ensureStore(name);
  }

  deleteObjectStore(name: string) {
    this.stores.delete(name);
  }

  transaction(name: string, _mode: string) {
    return {
      objectStore: () => this.ensureStore(name),
    } as IDBTransaction;
  }

  ensureStore(name: string) {
    return new MockObjectStore(this.ensureStoreMap(name));
  }

  private ensureStoreMap(name: string) {
    const existing = this.stores.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, unknown>();
    this.stores.set(name, created);
    return created;
  }
}
