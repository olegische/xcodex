import { DEFAULT_WORKSPACE_ROOT } from "./workspace.ts";
import type {
  CodexCompatibleConfig,
  CodexModelProviderConfig,
  DemoInstructions,
  DemoTransportMode,
  JsonValue,
  ModelPreset,
  RuntimeMode,
  XrouterProvider,
} from "./types.ts";

export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const PREFERRED_API_MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
];
export const BUILD_MANIFEST_PATH = "/pkg/manifest.json";
export const XROUTER_MANIFEST_PATH = "/xrouter-browser/manifest.json";
export const PROVIDER_CONFIG_KEY = "current";
export const USER_CONFIG_STORAGE_KEY = "current";
export const OPENAI_PROVIDER_ID = "openai";
export const XROUTER_BROWSER_PROVIDER_ID = "xrouter-browser";
export const OPENAI_COMPATIBLE_PROVIDER_ID = "external";
export const OPENAI_ENV_KEY = "OPENAI_API_KEY";
export const XROUTER_ENV_KEY = "XROUTER_API_KEY";
export const OPENAI_COMPATIBLE_ENV_KEY = "OPENAI_COMPATIBLE_API_KEY";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "default";

export const DEFAULT_CODEX_CONFIG: CodexCompatibleConfig = {
  model: "",
  modelProvider: XROUTER_BROWSER_PROVIDER_ID,
  runtime_mode: DEFAULT_RUNTIME_MODE,
  modelReasoningEffort: "medium",
  personality: "pragmatic",
  modelProviders: {
    [XROUTER_BROWSER_PROVIDER_ID]: {
      name: "DeepSeek via Browser Runtime",
      baseUrl: DEEPSEEK_API_BASE_URL,
      envKey: XROUTER_ENV_KEY,
      providerKind: "xrouter_browser",
      wireApi: "responses",
      metadata: {
        xrouterProvider: "deepseek",
      },
    },
  },
  env: {
    [XROUTER_ENV_KEY]: "",
  },
};

export const DEFAULT_DEMO_INSTRUCTIONS: DemoInstructions = {
  baseInstructions: [
    "You are operating inside the WASM Codex browser runtime.",
    "This runtime is browser-native.",
    "Do not assume local shell access, git, native filesystem access, or local background processes.",
    "Use browser-safe workspace tools like `read_file`, `list_dir`, `grep_files`, `apply_patch`, `update_plan`, and `request_user_input` when available.",
    "Keep behavior aligned with Codex core semantics where the browser host supports it.",
    "If a requested action depends on native OS capabilities, explain plainly that this browser runtime cannot provide them.",
    "The terminal UI is only a shell-like surface. It is not a desktop terminal and should not claim to execute native shell commands.",
    "Prefer concise terminal-style output over chatty prose.",
  ].join("\n"),
  agentsDirectory: DEFAULT_WORKSPACE_ROOT,
  agentsInstructions: "",
  skillName: "browser-skill",
  skillPath: "skills/browser/SKILL.md",
  skillContents: "",
};

export const XROUTER_PROVIDER_OPTIONS: ReadonlyArray<{
  value: XrouterProvider;
  label: string;
  displayName: string;
  baseUrl: string;
}> = [
  {
    value: "deepseek",
    label: "DeepSeek",
    displayName: "DeepSeek via Browser Runtime",
    baseUrl: DEEPSEEK_API_BASE_URL,
  },
  {
    value: "openai",
    label: "OpenAI",
    displayName: "OpenAI via Browser Runtime",
    baseUrl: OPENAI_API_BASE_URL,
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    displayName: "OpenRouter via Browser Runtime",
    baseUrl: OPENROUTER_API_BASE_URL,
  },
  {
    value: "zai",
    label: "ZAI",
    displayName: "ZAI via Browser Runtime",
    baseUrl: ZAI_API_BASE_URL,
  },
];

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const code =
      "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    const data =
      "data" in error && error.data != null ? ` ${JSON.stringify(error.data)}` : "";
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

export function defaultXrouterProviderBaseUrl(
  provider: XrouterProvider,
): string {
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

export function normalizeDemoInstructions(
  instructions: DemoInstructions,
): DemoInstructions {
  return {
    baseInstructions: instructions.baseInstructions.trim(),
    agentsDirectory:
      instructions.agentsDirectory.trim() || DEFAULT_DEMO_INSTRUCTIONS.agentsDirectory,
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
        envKey: OPENAI_ENV_KEY,
        providerKind: "openai",
        wireApi: "responses",
        metadata: null,
      };
    case "xrouter-browser":
      return {
        name:
          displayName.trim() || `${toProviderLabel(xrouterProvider)} via XRouter Browser`,
        baseUrl: normalizedBaseUrl || defaultXrouterProviderBaseUrl(xrouterProvider),
        envKey: XROUTER_ENV_KEY,
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
        envKey: OPENAI_COMPATIBLE_ENV_KEY,
        providerKind: "openai_compatible",
        wireApi: "responses",
        metadata: null,
      };
  }
}

export function getActiveProvider(
  config: CodexCompatibleConfig,
): CodexModelProviderConfig {
  return (
    config.modelProviders[config.modelProvider] ??
    DEFAULT_CODEX_CONFIG.modelProviders[DEFAULT_CODEX_CONFIG.modelProvider]
  );
}

export function activeProviderApiKey(config: CodexCompatibleConfig): string {
  const provider = getActiveProvider(config);
  return (config.env[provider.envKey] ?? "").trim();
}

export function detectTransportMode(
  config: CodexCompatibleConfig,
): DemoTransportMode {
  switch (getActiveProvider(config).providerKind) {
    case "openai":
      return "openai";
    case "xrouter_browser":
      return "xrouter-browser";
    case "openai_compatible":
      return "openai-compatible";
  }
}

export function normalizeCodexConfig(
  config: CodexCompatibleConfig,
): CodexCompatibleConfig {
  const transportMode = detectTransportMode(config);
  const activeProvider = getActiveProvider(config);
  const runtimeMode = normalizeRuntimeMode(config.runtime_mode);
  const runtimeArchitecture = normalizeOptionalString(config.runtime_architecture);
  return materializeCodexConfig({
    transportMode,
    model: config.model.trim(),
    runtimeMode,
    runtimeArchitecture,
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
  runtimeMode?: RuntimeMode | null;
  runtimeArchitecture?: string | null;
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
      ? OPENAI_PROVIDER_ID
      : params.transportMode === "xrouter-browser"
        ? XROUTER_BROWSER_PROVIDER_ID
        : OPENAI_COMPATIBLE_PROVIDER_ID;

  return {
    model: params.model,
    modelProvider,
    runtime_mode: normalizeRuntimeMode(params.runtimeMode),
    runtime_architecture: normalizeOptionalString(params.runtimeArchitecture),
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

export function normalizeRuntimeMode(
  runtimeMode: string | null | undefined,
): RuntimeMode {
  switch (runtimeMode) {
    case "default":
    case "demo":
    case "chaos":
      return runtimeMode;
    default:
      return DEFAULT_RUNTIME_MODE;
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeDiscoveredModels(
  payload: Record<string, unknown>,
  preferOpenAiOrdering: boolean,
): ModelPreset[] {
  const data = Array.isArray(payload.data)
    ? payload.data.filter((entry) => entry !== null && typeof entry === "object")
    : [];

  const models = data
    .map((entry) => normalizeDiscoveredModelEntry(entry as Record<string, unknown>))
    .filter((entry): entry is ModelPreset => entry !== null);

  if (preferOpenAiOrdering) {
    const preferred = PREFERRED_API_MODELS
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is ModelPreset => model !== undefined);
    const remainder = models.filter(
      (model) => !preferred.some((preferredModel) => preferredModel.id === model.id),
    );
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

function normalizeDiscoveredModelEntry(
  entry: Record<string, unknown>,
): ModelPreset | null {
  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    return null;
  }

  const displayName =
    typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name
      : modelIdToDisplayName(entry.id);

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
    typeof entry.provider === "string" && entry.provider.trim().length > 0
      ? `provider: ${entry.provider}`
      : null,
    typeof entry.vendor === "string" && entry.vendor.trim().length > 0
      ? `vendor: ${entry.vendor}`
      : null,
    typeof entry.route === "string" && entry.route.trim().length > 0
      ? `route: ${entry.route}`
      : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(" | ");
}

export function createHostError(
  code: string,
  message: string,
  data: JsonValue | null = null,
): JsonValue {
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
