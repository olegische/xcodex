import type { JsonValue } from "./core.ts";

export type AuthState = {
  authMode: "apiKey" | "chatgpt" | "chatgptAuthTokens";
  openaiApiKey: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  chatgptAccountId: string | null;
  chatgptPlanType: string | null;
  lastRefreshAt: number | null;
};

export type Account = {
  email: string | null;
  planType: string | null;
  chatgptAccountId: string | null;
  authMode: AuthState["authMode"] | null;
};

export type DemoTransportMode =
  | "openai"
  | "xrouter-browser"
  | "openai-compatible";

export type XrouterProvider = "deepseek" | "openai" | "openrouter" | "zai";

export type ProviderKind = "openai" | "openai_compatible" | "xrouter_browser";

export type RuntimeMode = "default" | "demo" | "chaos";

export type CodexModelProviderConfig = {
  name: string;
  baseUrl: string;
  envKey: string;
  providerKind: ProviderKind;
  wireApi: "responses";
  metadata?: {
    xrouterProvider?: XrouterProvider | null;
  } | null;
};

export type CodexCompatibleConfig = {
  model: string;
  modelProvider: string;
  runtime_mode?: RuntimeMode | null;
  runtime_architecture?: string | null;
  modelReasoningEffort: string | null;
  personality: string | null;
  modelProviders: Record<string, CodexModelProviderConfig>;
  env: Record<string, string>;
};

export type ModelPreset = {
  id: string;
  displayName: string;
  description?: string | null;
  isDefault: boolean;
  showInPicker: boolean;
  supportsApi: boolean;
};

export type DemoInstructions = {
  baseInstructions: string;
  agentsDirectory: string;
  agentsInstructions: string;
  skillName: string;
  skillPath: string;
  skillContents: string;
};

export type StoredUserConfig = {
  filePath: string;
  version: string;
  content: string;
};

export type HostError = {
  code: string;
  message: string;
  retryable: boolean;
  data: JsonValue | null;
};
