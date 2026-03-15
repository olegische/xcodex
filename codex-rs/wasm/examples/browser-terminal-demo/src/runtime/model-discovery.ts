import { loadXrouterRuntime } from "./assets";
import { activeProviderApiKey, createHostError, getActiveProvider, modelIdToDisplayName, normalizeDiscoveredModels, normalizeHostValue } from "./utils";
import type { CodexCompatibleConfig, ModelPreset, XrouterBrowserClient } from "./types";

export async function discoverModelsForConfig(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  return provider.providerKind === "xrouter_browser"
    ? discoverRouterModels(codexConfig)
    : discoverProviderModels(codexConfig);
}

async function discoverProviderModels(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  const response = await sendJsonRequestWithFallback({
    urls: candidateApiUrls(provider.baseUrl, "models"),
    method: "GET",
    apiKey: activeProviderApiKey(codexConfig),
    fallbackMessage: "failed to list models",
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    data: normalizeDiscoveredModels(payload, provider.providerKind === "openai"),
    nextCursor: null,
  };
}

async function discoverRouterModels(
  codexConfig: CodexCompatibleConfig,
): Promise<{ data: ModelPreset[]; nextCursor: string | null }> {
  const provider = getActiveProvider(codexConfig);
  console.info("[webui] xrouter.discover-models:start", {
    provider: provider.metadata?.xrouterProvider ?? "deepseek",
    baseUrl: provider.baseUrl,
    hasApiKey: activeProviderApiKey(codexConfig).length > 0,
  });
  const client = await createXrouterClient(codexConfig);
  const modelIds = normalizeHostValue(await client.fetchModelIds());
  console.info("[webui] xrouter.discover-models:done", modelIds);
  if (!Array.isArray(modelIds)) {
    throw new Error("xrouter-browser returned an invalid model id list");
  }
  return {
    data: modelIds
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((id, index) => ({
        id,
        displayName: modelIdToDisplayName(id),
        description: provider.name,
        isDefault: index === 0,
        showInPicker: true,
        supportsApi: true,
      })),
    nextCursor: null,
  };
}

async function createXrouterClient(codexConfig: CodexCompatibleConfig): Promise<XrouterBrowserClient> {
  const runtime = await loadXrouterRuntime();
  const provider = getActiveProvider(codexConfig);
  return new runtime.WasmBrowserClient(
    provider.metadata?.xrouterProvider ?? "deepseek",
    provider.baseUrl.length === 0 ? null : provider.baseUrl,
    activeProviderApiKey(codexConfig).length === 0 ? null : activeProviderApiKey(codexConfig),
  );
}

async function sendJsonRequestWithFallback(params: {
  urls: string[];
  method: "GET" | "POST";
  apiKey: string;
  fallbackMessage: string;
  body?: Record<string, unknown>;
}): Promise<Response> {
  let lastError: unknown = null;

  for (const url of params.urls) {
    try {
      const response = await fetch(url, {
        method: params.method,
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
      });

      if (response.ok) {
        return response;
      }

      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        throw new Error(
          typeof payload === "object" &&
            payload !== null &&
            "message" in payload &&
            typeof payload.message === "string"
            ? `provider responded with HTTP 401: ${payload.message}`
            : "provider responded with HTTP 401",
        );
      }

      lastError = createHostError(
        "unavailable",
        typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
          ? payload.message
          : params.fallbackMessage,
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(params.fallbackMessage);
}

function candidateApiUrls(baseUrl: string, resource: "models" | "responses"): string[] {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  if (normalizedBaseUrl.length === 0) {
    return [];
  }
  if (normalizedBaseUrl.endsWith("/v1")) {
    return [`${normalizedBaseUrl}/${resource}`];
  }
  return [`${normalizedBaseUrl}/${resource}`, `${normalizedBaseUrl}/v1/${resource}`];
}
