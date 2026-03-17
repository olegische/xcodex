import { normalizeHostValuePreservingStrings } from "@browser-codex/wasm-runtime-core/host-values";
import type { BrowserRuntimeHost, JsonValue } from "@browser-codex/wasm-runtime-core/types";

export type BrowserHostFileSystem = Pick<
  BrowserRuntimeHost,
  "readFile" | "listDir" | "search" | "applyPatch"
>;

export type NormalizedModelTurnRequest = {
  requestId: string;
  requestBody: Record<string, unknown>;
  transportOptions: Record<string, unknown>;
  rawRequest: unknown;
  emitModelEvent?: (event: JsonValue) => void | Promise<void>;
};

export type BrowserRuntimeHostDeps = BrowserHostFileSystem & {
  loadBootstrap(): Promise<Awaited<ReturnType<BrowserRuntimeHost["loadBootstrap"]>>>;
  loadUserConfig?: BrowserRuntimeHost["loadUserConfig"];
  saveUserConfig?: BrowserRuntimeHost["saveUserConfig"];
  listDiscoverableApps?: BrowserRuntimeHost["listDiscoverableApps"];
  runNormalizedModelTurn?: (request: NormalizedModelTurnRequest) => Promise<JsonValue>;
  resolveMcpOauthRedirectUri?: BrowserRuntimeHost["resolveMcpOauthRedirectUri"];
  waitForMcpOauthCallback?: BrowserRuntimeHost["waitForMcpOauthCallback"];
};

export type NormalizedModelTurnRunnerParams<TConfig> = {
  requestId: string;
  config: TConfig;
  requestBody: Record<string, JsonValue>;
  transportOptions: Record<string, unknown>;
  extraHeaders: Record<string, string> | null;
  emitModelEvent?: (event: JsonValue) => void | Promise<void>;
};

export type CreateNormalizedModelTurnRunnerDeps<TConfig, TResult> = {
  scope?: string;
  loadConfig(): Promise<TConfig>;
  getProviderKind(config: TConfig): string;
  runModelTurn(params: NormalizedModelTurnRunnerParams<TConfig>): Promise<TResult>;
};

export function createBrowserRuntimeHostFromDeps(
  deps: BrowserRuntimeHostDeps,
): BrowserRuntimeHost {
  return {
    async loadBootstrap(_request: unknown) {
      return await deps.loadBootstrap();
    },
    readFile: deps.readFile,
    listDir: deps.listDir,
    search: deps.search,
    applyPatch: deps.applyPatch,
    async loadUserConfig(request: JsonValue) {
      if (deps.loadUserConfig === undefined) {
        throw new Error("Browser runtime host does not provide user config loading");
      }
      return await deps.loadUserConfig(request);
    },
    async saveUserConfig(request: JsonValue) {
      if (deps.saveUserConfig === undefined) {
        throw new Error("Browser runtime host does not provide user config persistence");
      }
      return await deps.saveUserConfig(request);
    },
    async listDiscoverableApps(request: JsonValue) {
      if (deps.listDiscoverableApps === undefined) {
        return [];
      }
      return await deps.listDiscoverableApps(request);
    },
    async runModelTurn(this: BrowserRuntimeHost, request: JsonValue, onEvent?: (event: unknown) => void) {
      if (deps.runNormalizedModelTurn === undefined) {
        throw new Error("Browser runtime host does not provide model transport execution");
      }
      return await deps.runNormalizedModelTurn(
        normalizeModelTurnRequest(request, onEvent),
      );
    },
    async resolveMcpOauthRedirectUri(request: JsonValue) {
      if (deps.resolveMcpOauthRedirectUri === undefined) {
        throw new Error("Browser runtime host does not provide MCP OAuth redirect resolution");
      }
      return await deps.resolveMcpOauthRedirectUri(request);
    },
    async waitForMcpOauthCallback(request: JsonValue) {
      if (deps.waitForMcpOauthCallback === undefined) {
        throw new Error("Browser runtime host does not provide MCP OAuth callback handling");
      }
      return await deps.waitForMcpOauthCallback(request);
    },
  };
}

export function normalizeModelTurnRequest(
  request: unknown,
  emitModelEvent?: (event: unknown) => void,
): NormalizedModelTurnRequest {
  const requestRecord = asJsonRecord(normalizeHostValuePreservingStrings(request));
  return {
    requestId:
      typeof requestRecord.requestId === "string" ? requestRecord.requestId : crypto.randomUUID(),
    requestBody: asJsonRecord(normalizeHostValuePreservingStrings(requestRecord.requestBody)),
    transportOptions: asJsonRecord(
      normalizeHostValuePreservingStrings(requestRecord.transportOptions),
    ),
    rawRequest: request,
    emitModelEvent:
      emitModelEvent === undefined
        ? undefined
        : async (event: JsonValue) => {
            emitModelEvent(event);
          },
  };
}

export function extraHeadersFromTransportOptions(
  transportOptions: Record<string, unknown>,
): Record<string, string> | null {
  const extraHeaders = asJsonRecord(transportOptions.extraHeaders);
  const entries = Object.entries(extraHeaders).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries);
}

export function createNormalizedModelTurnRunner<TConfig, TResult>(
  deps: CreateNormalizedModelTurnRunnerDeps<TConfig, TResult>,
): (request: NormalizedModelTurnRequest) => Promise<TResult> {
  return async (request: NormalizedModelTurnRequest) => {
    const config = await deps.loadConfig();
    const scope = deps.scope ?? "browser-host";
    const extraHeaders = extraHeadersFromTransportOptions(request.transportOptions);
    console.info(`[${scope}] host.run-model-turn`, {
      requestId: request.requestId,
      providerKind: deps.getProviderKind(config),
      requestBodyKeys: Object.keys(request.requestBody),
      inputSummary: summarizeNormalizedModelTurnInput(request.requestBody),
      transport: summarizeTransportOptions(request.transportOptions),
    });

    return await deps.runModelTurn({
      requestId: request.requestId,
      config,
      requestBody: request.requestBody as Record<string, JsonValue>,
      transportOptions: request.transportOptions,
      extraHeaders,
      emitModelEvent: request.emitModelEvent,
    });
  };
}

export function summarizeNormalizedModelTurnInput(
  requestBody: Record<string, unknown>,
): Record<string, unknown> | null {
  const input = Array.isArray(requestBody.input) ? requestBody.input : null;
  if (input === null) {
    return null;
  }
  return {
    count: input.length,
    itemTypes: input.map((item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).type === "string"
        ? ((item as Record<string, unknown>).type as string)
        : "<invalid>",
    ),
  };
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function summarizeTransportOptions(
  transportOptions: Record<string, unknown>,
): Record<string, unknown> {
  const extraHeaders = extraHeadersFromTransportOptions(transportOptions);
  return {
    keys: Object.keys(transportOptions),
    extraHeaderKeys: extraHeaders === null ? [] : Object.keys(extraHeaders),
  };
}
