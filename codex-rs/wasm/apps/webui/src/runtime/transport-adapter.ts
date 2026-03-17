import {
  createResolvedBrowserModelTransportAdapter,
  type ModelTransportAdapter,
} from "@browser-codex/wasm-model-transport";
import { loadXrouterRuntime } from "./assets";
import { runResponsesApiTurn, runXrouterTurn } from "./transports";
import {
  activeProviderApiKey,
  createHostError,
  getActiveProvider,
  modelIdToDisplayName,
  normalizeDiscoveredModels,
} from "./utils";
import type { CodexCompatibleConfig, JsonValue, ModelPreset } from "./types";

export const webUiModelTransportAdapter: ModelTransportAdapter<
  CodexCompatibleConfig,
  ModelPreset,
  JsonValue
> = createResolvedBrowserModelTransportAdapter({
  getProvider: getActiveProvider,
  getApiKey: activeProviderApiKey,
  normalizeDiscoveredModels,
  modelIdToDisplayName,
  createError: (code, message, data) => createHostError(code, message, data as JsonValue | undefined),
  loadXrouterRuntime,
  async runResponsesTurn(params) {
    return await runResponsesApiTurn({
      requestId: params.requestId,
      baseUrl: params.provider.baseUrl,
      apiKey: params.apiKey,
      requestBody: params.requestBody,
      extraHeaders: params.extraHeaders,
      transportOptions: params.transportOptions,
      emitModelEvent: params.emitModelEvent,
    });
  },
  async runXrouterTurn(params) {
    return await runXrouterTurn({
      requestId: params.requestId,
      codexConfig: params.config,
      requestBody: params.requestBody,
      extraHeaders: params.extraHeaders,
      transportOptions: params.transportOptions,
      emitModelEvent: params.emitModelEvent,
    });
  },
});
