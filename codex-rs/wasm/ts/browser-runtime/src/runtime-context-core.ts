import type { JsonValue, StoredThreadSession } from "./types/core.ts";
import {
  DEFAULT_BROWSER_CODEX_HOME,
  DEFAULT_BROWSER_WORKSPACE_ROOT,
  sanitizeStoredThreadSession,
  sanitizeStoredThreadSessionMetadata,
} from "./layout.ts";
import type {
  Account,
  AuthState,
  CodexCompatibleConfig,
  DemoInstructions,
  ModelPreset,
} from "./types/config.ts";
import type {
  BrowserRuntimeContext,
  BrowserRuntimeNotification,
  BrowserRuntimeStorage,
  CreateBrowserCodexRuntimeContextOptions,
} from "./types/runtime.ts";

export async function createBrowserCodexRuntimeContextWithDeps(
  options: CreateBrowserCodexRuntimeContextOptions,
  deps: RuntimeContextDeps,
): Promise<BrowserRuntimeContext> {
  const transport = {
    loadRuntimeModule: options.transport?.loadRuntimeModule ?? deps.loadRuntimeModule,
    loadXrouterRuntime: options.transport?.loadXrouterRuntime ?? deps.loadXrouterRuntime,
  };
  const storage = options.storage as BrowserRuntimeStorage<
    AuthState,
    CodexCompatibleConfig,
    StoredThreadSession
  >;
  const modelTransport = deps.createBrowserRuntimeModelTransportAdapter({
    loadXrouterRuntime: async () => await transport.loadXrouterRuntime(),
  });

  if (options.telemetry?.initializePageTelemetry !== false) {
    deps.initializePageTelemetry();
  }

  const host = deps.createBrowserRuntimeHostFromDeps({
    async loadBootstrap() {
      const [authState, config] = await Promise.all([
        storage.loadAuthState(),
        storage.loadConfig().catch(() => structuredClone(deps.defaultConfig)),
      ]);
      const provider = deps.getActiveProvider(config);
      const apiKey = fallbackApiKey(authState) || deps.activeProviderApiKey(config);
      return deps.buildBrowserRuntimeBootstrap({
        codexHome: options.codexHome ?? DEFAULT_BROWSER_CODEX_HOME,
        cwd: DEFAULT_BROWSER_WORKSPACE_ROOT,
        model: config.model.trim() || null,
        modelProviderId: config.modelProvider,
        modelProvider: {
          name: provider.name,
          baseUrl: provider.baseUrl,
          envKey: provider.envKey,
        },
        reasoningEffort: config.modelReasoningEffort,
        personality: config.personality,
        baseInstructions:
          options.bootstrap?.baseInstructions ??
          deps.defaultDemoInstructions.baseInstructions,
        developerInstructions: options.bootstrap?.developerInstructions ?? null,
        userInstructions: options.bootstrap?.userInstructions ?? null,
        apiKey: apiKey || null,
        ephemeral: options.bootstrap?.ephemeral ?? false,
      });
    },
    readFile: options.workspace.readFile,
    listDir: options.workspace.listDir,
    search: options.workspace.search,
    applyPatch: options.workspace.applyPatch,
    async loadUserConfig() {
          return (
        (await storage.loadUserConfig()) ?? {
          filePath: `${options.codexHome ?? DEFAULT_BROWSER_CODEX_HOME}/config.toml`,
          version: "0",
          content: "",
        }
      );
    },
    async saveUserConfig(request: unknown) {
      const record = asRecord(request);
      if (typeof record.content !== "string") {
        throw new Error("saveUserConfig requires string content");
      }
      return await storage.saveUserConfig({
        filePath: typeof record.filePath === "string" ? record.filePath : null,
        expectedVersion:
          typeof record.expectedVersion === "string" ? record.expectedVersion : null,
        content: record.content,
      });
    },
    async loadThreadSession(request: { threadId: string }) {
      const session = await storage.loadSession(request.threadId);
      if (session === null) {
        throw new Error(`thread session not found: ${request.threadId}`);
      }
      return { session: sanitizeStoredThreadSession(session) };
    },
    async saveThreadSession(request: { session: StoredThreadSession }) {
      await storage.saveSession(sanitizeStoredThreadSession(request.session));
      return null;
    },
    async deleteThreadSession(request: { threadId: string }) {
      await storage.deleteSession(request.threadId);
      return null;
    },
    async listThreadSessions() {
      return {
        sessions: (await storage.listSessions()).map(sanitizeStoredThreadSessionMetadata),
      };
    },
    async listDiscoverableApps() {
      return [];
    },
    runNormalizedModelTurn: deps.createNormalizedModelTurnRunner({
      scope: "browser-runtime",
      loadConfig: async () =>
        await storage.loadConfig().catch(() => structuredClone(deps.defaultConfig)),
      getProviderKind(config: CodexCompatibleConfig) {
        return deps.getActiveProvider(config).providerKind;
      },
      async runModelTurn(params: unknown) {
        return await modelTransport.runModelTurn(params);
      },
    }),
  });

  const runtime = await deps.createBrowserCodexRuntime({
    runtimeModule: await transport.loadRuntimeModule(),
    host,
    deps: {
      persistence: {
        loadAuthState: async () => await storage.loadAuthState(),
        saveAuthState: async (authState: AuthState) => await storage.saveAuthState(authState),
        clearAuthState: async () => await storage.clearAuthState(),
        loadConfig: async () =>
          await storage.loadConfig().catch(() => structuredClone(deps.defaultConfig)),
      },
      dynamicTools: options.dynamicTools ?? deps.createBrowserAwareToolExecutor(),
      async readAccount({
        authState,
        config,
        refreshToken,
      }: {
        authState: AuthState | null;
        config: CodexCompatibleConfig;
        refreshToken: boolean;
      }) {
        if (options.readAccount !== undefined) {
          return await options.readAccount({
            authState,
            config,
            allowRefresh: refreshToken,
          });
        }
        return defaultReadAccount({ authState, config }, deps);
      },
      async discoverModels({ config }: { config: CodexCompatibleConfig }) {
        return await modelTransport.discoverModels(config);
      },
      async refreshAuth() {
        throw new Error("Browser runtime context does not provide auth refresh.");
      },
      formatError: deps.formatError,
      async requestUserInput(request: {
        questions: Array<{
          id: string;
          header: string;
          question: string;
          options: Array<{ label: string; description: string }>;
        }>;
      }) {
        if (options.requestUserInput === undefined) {
          return { answers: [] };
        }
        const response = await options.requestUserInput(request);
        return {
          answers: response.answers.map((answer) => ({
            id: answer.id,
            value: normalizeJsonValue(answer.value),
          })),
        };
      },
      logScope: "browser-runtime",
    },
  });

  return {
    runtime,
    loadConfig: async () =>
      await storage.loadConfig().catch(() => structuredClone(deps.defaultConfig)),
    saveConfig: async (config) => await storage.saveConfig(config),
    subscribe(listener) {
      return runtime.subscribeToNotifications((notification: unknown) => {
        listener(toNotificationEnvelope(notification));
      });
    },
  };
}

export type RuntimeContextDeps = {
  createBrowserCodexRuntime(params: {
    runtimeModule: unknown;
    host: unknown;
    deps: Record<string, unknown>;
  }): Promise<BrowserRuntimeContext["runtime"]>;
  buildBrowserRuntimeBootstrap(args: Record<string, unknown>): unknown;
  createBrowserRuntimeHostFromDeps(deps: Record<string, unknown>): unknown;
  createNormalizedModelTurnRunner(args: {
    scope: string;
    loadConfig(): Promise<CodexCompatibleConfig>;
    getProviderKind(config: CodexCompatibleConfig): string;
    runModelTurn(params: unknown): Promise<unknown>;
  }): (request: unknown) => Promise<unknown>;
  createBrowserAwareToolExecutor(): unknown;
  initializePageTelemetry(): void;
  activeProviderApiKey(config: CodexCompatibleConfig): string;
  createBrowserRuntimeModelTransportAdapter(deps: {
    loadXrouterRuntime(): Promise<unknown>;
  }): {
    runModelTurn(params: unknown): Promise<unknown>;
    discoverModels(
      config: CodexCompatibleConfig,
    ): Promise<{ data: ModelPreset[]; nextCursor: string | null }>;
  };
  defaultConfig: CodexCompatibleConfig;
  defaultDemoInstructions: DemoInstructions;
  formatError(error: unknown): string;
  getActiveProvider(config: CodexCompatibleConfig): {
    name: string;
    baseUrl: string;
    envKey: string;
    providerKind: string;
  };
  loadRuntimeModule(): Promise<unknown>;
  loadXrouterRuntime(): Promise<unknown>;
};

function defaultReadAccount(
  input: {
    authState: AuthState | null;
    config: CodexCompatibleConfig;
  },
  deps: RuntimeContextDeps,
): {
  account: Account | null;
  requiresOpenaiAuth: boolean;
} {
  const provider = deps.getActiveProvider(input.config);
  const apiKey = fallbackApiKey(input.authState) || deps.activeProviderApiKey(input.config);
  if (apiKey.length === 0) {
    return {
      account: null,
      requiresOpenaiAuth: provider.providerKind === "openai",
    };
  }
  return {
    account: {
      email: null,
      planType: input.authState?.chatgptPlanType ?? null,
      chatgptAccountId: input.authState?.chatgptAccountId ?? null,
      authMode: input.authState?.authMode ?? null,
    },
    requiresOpenaiAuth: false,
  };
}

function fallbackApiKey(authState: AuthState | null): string {
  if (authState?.authMode !== "apiKey") {
    return "";
  }
  return authState.openaiApiKey?.trim() ?? "";
}

function toNotificationEnvelope(notification: unknown): BrowserRuntimeNotification {
  const record = asRecord(notification);
  return {
    method: typeof record.method === "string" ? record.method : "",
    params: record.params,
  };
}

function normalizeJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeJsonValue(entry)]),
    );
  }
  return value === undefined ? null : String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
