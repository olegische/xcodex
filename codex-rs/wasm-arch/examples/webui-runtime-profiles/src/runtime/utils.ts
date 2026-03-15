import { DEEPSEEK_API_BASE_URL, OPENAI_API_BASE_URL, OPENROUTER_API_BASE_URL, PREFERRED_API_MODELS, ZAI_API_BASE_URL } from "./constants";
import type {
  CodexCompatibleConfig,
  CodexModelProviderConfig,
  DemoInstructions,
  DemoTransportMode,
  JsonValue,
  ModelPreset,
  XrouterProvider,
} from "./types";
import { DEFAULT_CODEX_CONFIG, DEFAULT_DEMO_INSTRUCTIONS } from "./constants";

export function normalizeHostValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return normalizeHostValue(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(normalizeHostValue);
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, nested]) => [key, normalizeHostValue(nested)]));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normalizeHostValue(nested)]));
  }
  return value;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    const data = "data" in error && error.data != null ? ` ${JSON.stringify(error.data)}` : "";
    return `${code}${error.message}${data}`;
  }
  if (error !== null && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return String(error);
}

export function modelIdToDisplayName(id: string): string {
  return id
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

export function toProviderLabel(providerId: string): string {
  return modelIdToDisplayName(providerId.trim() || "provider");
}

export function defaultXrouterProviderBaseUrl(provider: XrouterProvider): string {
  switch (provider) {
    case "deepseek":
      return DEEPSEEK_API_BASE_URL;
    case "openai":
      return OPENAI_API_BASE_URL;
    case "openrouter":
      return OPENROUTER_API_BASE_URL;
    case "zai":
      return ZAI_API_BASE_URL;
  }
}

export function normalizeDemoInstructions(instructions: DemoInstructions): DemoInstructions {
  return {
    baseInstructions: instructions.baseInstructions.trim(),
    agentsDirectory: instructions.agentsDirectory.trim() || DEFAULT_DEMO_INSTRUCTIONS.agentsDirectory,
    agentsInstructions: instructions.agentsInstructions.trim(),
    skillName: instructions.skillName.trim() || DEFAULT_DEMO_INSTRUCTIONS.skillName,
    skillPath: instructions.skillPath.trim() || DEFAULT_DEMO_INSTRUCTIONS.skillPath,
    skillContents: instructions.skillContents.trim(),
  };
}

export function createProviderConfig(
  transportMode: DemoTransportMode,
  displayName: string,
  baseUrl: string,
  xrouterProvider: XrouterProvider,
): CodexModelProviderConfig {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  switch (transportMode) {
    case "openai":
      return {
        name: displayName.trim() || "OpenAI",
        baseUrl: normalizedBaseUrl || OPENAI_API_BASE_URL,
        envKey: "OPENAI_API_KEY",
        providerKind: "openai",
        wireApi: "responses",
        metadata: null,
      };
    case "xrouter-browser":
      return {
        name: displayName.trim() || `${toProviderLabel(xrouterProvider)} via XRouter Browser`,
        baseUrl: normalizedBaseUrl || defaultXrouterProviderBaseUrl(xrouterProvider),
        envKey: "XROUTER_API_KEY",
        providerKind: "xrouter_browser",
        wireApi: "responses",
        metadata: {
          xrouterProvider,
        },
      };
    case "openai-compatible":
      return {
        name: displayName.trim() || "OpenAI-Compatible Server",
        baseUrl: normalizedBaseUrl,
        envKey: "OPENAI_COMPATIBLE_API_KEY",
        providerKind: "openai_compatible",
        wireApi: "responses",
        metadata: null,
      };
  }
}

export function getActiveProvider(config: CodexCompatibleConfig): CodexModelProviderConfig {
  return config.modelProviders[config.modelProvider] ?? DEFAULT_CODEX_CONFIG.modelProviders[DEFAULT_CODEX_CONFIG.modelProvider];
}

export function activeProviderApiKey(config: CodexCompatibleConfig): string {
  const provider = getActiveProvider(config);
  return (config.env[provider.envKey] ?? "").trim();
}

export function detectTransportMode(config: CodexCompatibleConfig): DemoTransportMode {
  switch (getActiveProvider(config).providerKind) {
    case "openai":
      return "openai";
    case "xrouter_browser":
      return "xrouter-browser";
    case "openai_compatible":
      return "openai-compatible";
  }
}

export function normalizeCodexConfig(config: CodexCompatibleConfig): CodexCompatibleConfig {
  const transportMode = detectTransportMode(config);
  const activeProvider = getActiveProvider(config);
  return materializeCodexConfig({
    transportMode,
    model: config.model.trim(),
    modelReasoningEffort: config.modelReasoningEffort,
    personality: config.personality,
    displayName: activeProvider.name,
    baseUrl: activeProvider.baseUrl,
    apiKey: activeProviderApiKey(config),
    xrouterProvider: activeProvider.metadata?.xrouterProvider ?? "deepseek",
  });
}

export function materializeCodexConfig(params: {
  transportMode: DemoTransportMode;
  model: string;
  modelReasoningEffort: string | null;
  personality: string | null;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  xrouterProvider: XrouterProvider;
}): CodexCompatibleConfig {
  const provider = createProviderConfig(
    params.transportMode,
    params.displayName,
    params.baseUrl,
    params.xrouterProvider,
  );
  const modelProvider =
    params.transportMode === "openai"
      ? "openai"
      : params.transportMode === "xrouter-browser"
        ? "xrouter-browser"
        : "external";

  return {
    model: params.model,
    modelProvider,
    modelReasoningEffort: params.modelReasoningEffort,
    personality: params.personality,
    modelProviders: {
      [modelProvider]: provider,
    },
    env: {
      [provider.envKey]: params.apiKey.trim(),
    },
  };
}

export function normalizeDiscoveredModels(payload: Record<string, unknown>, preferOpenAiOrdering: boolean): ModelPreset[] {
  const data =
    Array.isArray(payload.data) ? payload.data.filter((entry) => entry !== null && typeof entry === "object") : [];

  const models = data
    .map((entry) => normalizeDiscoveredModelEntry(entry as Record<string, unknown>))
    .filter((entry): entry is ModelPreset => entry !== null);

  if (preferOpenAiOrdering) {
    const preferred = PREFERRED_API_MODELS
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is ModelPreset => model !== undefined);
    const remainder = models.filter((model) => !preferred.some((preferredModel) => preferredModel.id === model.id));
    return [...preferred, ...remainder].map((model, index) => ({
      ...model,
      isDefault: index === 0,
    }));
  }

  return models.map((model, index) => ({
    ...model,
    isDefault: index === 0,
  }));
}

function normalizeDiscoveredModelEntry(entry: Record<string, unknown>): ModelPreset | null {
  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    return null;
  }

  const displayName =
    typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name : modelIdToDisplayName(entry.id);

  return {
    id: entry.id,
    displayName,
    description: buildModelDescription(entry),
    isDefault: false,
    showInPicker: true,
    supportsApi: true,
  };
}

function buildModelDescription(entry: Record<string, unknown>): string | null {
  if (typeof entry.description === "string" && entry.description.trim().length > 0) {
    return entry.description;
  }

  const parts = [
    typeof entry.provider === "string" && entry.provider.trim().length > 0 ? `provider: ${entry.provider}` : null,
    typeof entry.vendor === "string" && entry.vendor.trim().length > 0 ? `vendor: ${entry.vendor}` : null,
    typeof entry.route === "string" && entry.route.trim().length > 0 ? `route: ${entry.route}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(" | ");
}

export function createHostError(code: string, message: string, data: JsonValue | null = null): JsonValue {
  return {
    code,
    message,
    retryable: false,
    data,
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
