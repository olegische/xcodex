import type { CodexCompatibleConfig, DemoInstructions, XrouterProvider } from "./types";

export const THREAD_ID = "codex-webui-runtime-profiles-thread";
export const TURN_PREFIX = "codex-webui-runtime-profiles-turn";
export const DB_NAME = "codex-wasm-webui-runtime-profiles";
export const DB_VERSION = 2;
export const BUILD_MANIFEST_PATH = "/pkg/manifest.json";
export const XROUTER_MANIFEST_PATH = "/xrouter-browser/manifest.json";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const PREFERRED_API_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini"];
export const PROVIDER_CONFIG_KEY = "current";
export const INSTRUCTIONS_STORAGE_KEY = "codex.wasm.instructions.codex-webui-runtime-profiles-thread";
export const WORKSPACE_STORAGE_KEY = "codex.wasm.workspace.codex-webui-runtime-profiles";
export const WORKSPACE_ROOT = "/workspace";
export const OPENAI_PROVIDER_ID = "openai";
export const XROUTER_BROWSER_PROVIDER_ID = "xrouter-browser";
export const OPENAI_COMPATIBLE_PROVIDER_ID = "external";
export const OPENAI_ENV_KEY = "OPENAI_API_KEY";
export const XROUTER_ENV_KEY = "XROUTER_API_KEY";
export const OPENAI_COMPATIBLE_ENV_KEY = "OPENAI_COMPATIBLE_API_KEY";
export const CONNECTED_TOOL_NAMES = [
  "read_file",
  "list_dir",
  "grep_files",
  "apply_patch",
  "update_plan",
  "request_user_input",
] as const;

export const DEFAULT_CODEX_CONFIG: CodexCompatibleConfig = {
  model: "",
  modelProvider: XROUTER_BROWSER_PROVIDER_ID,
  modelReasoningEffort: "medium",
  personality: "pragmatic",
  modelProviders: {
    [XROUTER_BROWSER_PROVIDER_ID]: {
      name: "DeepSeek via XRouter Browser",
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
    "You are operating inside the Runtime UI Profiles browser example.",
    "The browser workspace UI source of truth is split into four JSON files:",
    "- `/workspace/ui/tokens.json` for base theme tokens",
    "- `/workspace/ui/profiles.json` for named profiles and token overrides",
    "- `/workspace/ui/layout.json` for shell areas and widget placement",
    "- `/workspace/ui/widgets.json` for widget-level configuration",
    "When the user asks to restyle or rearrange the UI, inspect and edit those files directly using `read_file`, `write_file`, or `apply_patch`.",
    "Keep all JSON valid and preserve each file's top-level shape.",
    "Prefer changing schema files over inventing new runtime code.",
    "If the user wants a profile activated, update `activeProfileId` in `/workspace/ui/profiles.json`.",
  ].join("\n"),
  agentsDirectory: WORKSPACE_ROOT,
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
    displayName: "DeepSeek via XRouter Browser",
    baseUrl: DEEPSEEK_API_BASE_URL,
  },
  {
    value: "openai",
    label: "OpenAI",
    displayName: "OpenAI via XRouter Browser",
    baseUrl: OPENAI_API_BASE_URL,
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    displayName: "OpenRouter via XRouter Browser",
    baseUrl: OPENROUTER_API_BASE_URL,
  },
  {
    value: "zai",
    label: "ZAI",
    displayName: "ZAI via XRouter Browser",
    baseUrl: ZAI_API_BASE_URL,
  },
];
