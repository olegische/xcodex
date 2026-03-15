import type { CodexCompatibleConfig, DemoInstructions, XrouterProvider } from "./types";

export const THREAD_ID = "codex-browser-terminal-thread";
export const TURN_PREFIX = "codex-browser-terminal-turn";
export const DB_NAME = "codex-wasm-browser-terminal";
export const DB_VERSION = 2;
export const BUILD_MANIFEST_PATH = "/pkg/manifest.json";
export const XROUTER_MANIFEST_PATH = "/xrouter-browser/manifest.json";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const PREFERRED_API_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini"];
export const PROVIDER_CONFIG_KEY = "current";
export const INSTRUCTIONS_STORAGE_KEY = "codex.wasm.instructions.codex-browser-terminal-thread";
export const WORKSPACE_STORAGE_KEY = "codex.wasm.workspace.codex-browser-terminal";
export const UI_THEME_REVISION_STORAGE_KEY = "codex.wasm.ui-theme-revision.codex-browser-terminal";
export const UI_THEME_REVISION = "codex-terminal-v1";
export const ENABLE_PAGE_TELEMETRY = false;
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
    "You are operating inside the Codex Browser Terminal demo.",
    "This runtime is browser-native.",
    "Do not assume local shell access, git, native filesystem access, or local background processes.",
    "Use browser-safe workspace tools like `read_file`, `list_dir`, `grep_files`, `apply_patch`, `update_plan`, and `request_user_input` when available.",
    "Keep behavior aligned with Codex core semantics where the browser host supports it.",
    "If a requested action depends on native OS capabilities, explain plainly that this browser runtime cannot provide them.",
    "The terminal UI is only a shell-like surface. It is not a desktop terminal and should not claim to execute native shell commands.",
    "Prefer concise terminal-style output over chatty prose.",
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
