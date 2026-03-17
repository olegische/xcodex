import { candidateApiUrls, sendJsonRequestWithFallback } from "./http";
import { createXrouterBrowserClient } from "./xrouter-executor";
import type {
  ModelDiscoveryResult,
  ModelTransportAdapter,
  ModelTransportTurnParams,
} from "./types";

export type BrowserTransportProvider = {
  name: string;
  baseUrl: string;
  envKey: string;
  providerKind: "openai" | "openai_compatible" | "xrouter_browser";
  metadata?: {
    xrouterProvider?: string | null;
  } | null;
};

export type XrouterBrowserClient = {
  fetchModelIds(): Promise<unknown>;
  runResponsesStream(
    requestId: string,
    request: unknown,
    onEvent: (event: unknown) => void,
  ): Promise<unknown>;
  cancel(requestId: string): void;
};

export type XrouterRuntimeModule = {
  WasmBrowserClient: new (
    provider: string,
    baseUrl?: string | null,
    apiKey?: string | null,
  ) => XrouterBrowserClient;
};

export type BrowserModelTransportAdapterDeps<TConfig, TModel, TResult> = {
  getProvider(config: TConfig): BrowserTransportProvider;
  getApiKey(config: TConfig): string;
  normalizeDiscoveredModels(
    payload: Record<string, unknown>,
    preferOpenAiOrdering: boolean,
  ): TModel[];
  modelIdToDisplayName(id: string): string;
  createError(
    code: string,
    message: string,
    data?: unknown,
  ): unknown;
  loadXrouterRuntime(): Promise<XrouterRuntimeModule>;
  runResponsesTurn(params: ModelTransportTurnParams<TConfig>): Promise<TResult>;
  runXrouterTurn(params: ModelTransportTurnParams<TConfig>): Promise<TResult>;
};

export type ResolvedBrowserModelTransportTurnParams<TConfig> =
  ModelTransportTurnParams<TConfig> & {
    provider: BrowserTransportProvider;
    apiKey: string;
  };

export type ResolvedBrowserModelTransportAdapterDeps<TConfig, TModel, TResult> = Omit<
  BrowserModelTransportAdapterDeps<TConfig, TModel, TResult>,
  "runResponsesTurn" | "runXrouterTurn"
> & {
  runResponsesTurn(
    params: ResolvedBrowserModelTransportTurnParams<TConfig>,
  ): Promise<TResult>;
  runXrouterTurn(
    params: ResolvedBrowserModelTransportTurnParams<TConfig>,
  ): Promise<TResult>;
};

export function createBrowserModelTransportAdapter<TConfig, TModel, TResult>(
  deps: BrowserModelTransportAdapterDeps<TConfig, TModel, TResult>,
): ModelTransportAdapter<TConfig, TModel, TResult> {
  return {
    async discoverModels(config: TConfig): Promise<ModelDiscoveryResult<TModel>> {
      const provider = deps.getProvider(config);
      if (provider.providerKind === "xrouter_browser") {
        const client = await createXrouterClient(config, deps);
        const modelIds = await client.fetchModelIds();
        if (!Array.isArray(modelIds)) {
          throw new Error("xrouter-browser returned an invalid model id list");
        }
        return {
          data: modelIds
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((id, index) => ({
              id,
              displayName: deps.modelIdToDisplayName(id),
              description: provider.name,
              isDefault: index === 0,
              showInPicker: true,
              supportsApi: true,
            }) as TModel),
          nextCursor: null,
        };
      }

      const response = await sendJsonRequestWithFallback({
        urls: candidateApiUrls(provider.baseUrl, "models"),
        method: "GET",
        apiKey: deps.getApiKey(config),
        fallbackMessage: "failed to list models",
        createError: deps.createError,
      });
      const payload = (await response.json()) as Record<string, unknown>;
      return {
        data: deps.normalizeDiscoveredModels(payload, provider.providerKind === "openai"),
        nextCursor: null,
      };
    },

    async runModelTurn(params: ModelTransportTurnParams<TConfig>): Promise<TResult> {
      const provider = deps.getProvider(params.config);
      if (provider.providerKind === "xrouter_browser") {
        return await deps.runXrouterTurn(params);
      }
      return await deps.runResponsesTurn(params);
    },
  };
}

export function createResolvedBrowserModelTransportAdapter<TConfig, TModel, TResult>(
  deps: ResolvedBrowserModelTransportAdapterDeps<TConfig, TModel, TResult>,
): ModelTransportAdapter<TConfig, TModel, TResult> {
  return createBrowserModelTransportAdapter({
    ...deps,
    async runResponsesTurn(params) {
      const provider = deps.getProvider(params.config);
      return await deps.runResponsesTurn({
        ...params,
        provider,
        apiKey: deps.getApiKey(params.config),
      });
    },
    async runXrouterTurn(params) {
      const provider = deps.getProvider(params.config);
      return await deps.runXrouterTurn({
        ...params,
        provider,
        apiKey: deps.getApiKey(params.config),
      });
    },
  });
}

async function createXrouterClient<TConfig>(
  config: TConfig,
  deps: BrowserModelTransportAdapterDeps<TConfig, unknown, unknown>,
): Promise<XrouterBrowserClient> {
  const runtime = await deps.loadXrouterRuntime();
  const provider = deps.getProvider(config);
  const apiKey = deps.getApiKey(config);
  return createXrouterBrowserClient({ runtime, provider, apiKey });
}
