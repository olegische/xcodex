import {
  WORKSPACE_ROOT,
  WORKSPACE_STORAGE_KEY,
} from "@browser-codex/wasm-browser-host/constants";
import type { CodexCompatibleConfig, DemoInstructions, XrouterProvider } from "./types";

export const THREAD_ID = "codex-browser-terminal-thread";
export const TURN_PREFIX = "codex-browser-terminal-turn";
export const DB_NAME = "codex-wasm-browser-terminal";
export const DB_VERSION = 4;
export const BUILD_MANIFEST_PATH = "/pkg/manifest.json";
export const XROUTER_MANIFEST_PATH = "/xrouter-browser/manifest.json";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const PREFERRED_API_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini"];
export const PROVIDER_CONFIG_KEY = "current";
export const USER_CONFIG_STORAGE_KEY = "current";
export const INSTRUCTIONS_STORAGE_KEY = "codex.wasm.instructions.codex-browser-terminal-thread";
export const UI_THEME_REVISION_STORAGE_KEY = "codex.wasm.ui-theme-revision.codex-browser-terminal";
export const UI_THEME_REVISION = "codex-terminal-v1";
export const ENABLE_PAGE_TELEMETRY = false;
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
    "You are operating inside the WASM Codex browser demo.",
    "This runtime is browser-native.",
    "Do not assume local shell access, git, native filesystem access, or local background processes.",
    "Use browser-safe workspace tools like `read_file`, `list_dir`, `grep_files`, `apply_patch`, `update_plan`, and `request_user_input` when available.",
    "Prefer browser-aware tools like `browser__page_context`, `browser__ai_surface_scan`, `browser__list_interactives`, `browser__click`, `browser__fill`, `browser__navigate`, `browser__wait_for`, `browser__event_stream`, `browser__extract_dom`, `browser__inspect_storage`, `browser__inspect_cookies`, `browser__probe_http`, `browser__page_resources`, `browser__performance_snapshot`, `browser__run_probe`, `browser__scan_dom_xss_surface`, `browser__scan_dangerous_sinks`, `browser__inspect_globals`, and `browser__probe_input_reflection` when the user asks about the current page, site structure, DOM, visible content, forms, links, UX, or client-side security.",
    "When the user asks about the current site or page, do not start with workspace file tools.",
    "For current-page investigation tasks, call `browser__page_context` first, then use the result to decide the next browser tool.",
    "Keep behavior aligned with Codex core semantics where the browser host supports it.",
    "If a requested action depends on native OS capabilities, explain plainly that this browser runtime cannot provide them.",
    "The terminal UI is only a shell-like surface. It is not a desktop terminal and should not claim to execute native shell commands.",
    "Prefer concise terminal-style output over chatty prose.",
    "Final assistant output is authoritative only when it contains explicit inline citations.",
    "Use the citation contract `[@reference]` directly inside the final answer, attached to the sentence or bullet it supports.",
    "Do not invent references. Cite only evidence that exists in the current browser environment or workspace.",
    "For workspace files, prefer exact workspace paths such as `[@/workspace/codex/sources.json]`.",
    "For browser observations or tool evidence, prefer stable tool or event references such as `[@tool:read_file]` or `[@event:tool-call:list_dir]` when that evidence supports the claim.",
    "Answers with missing or unresolvable `[@reference]` citations are not authoritative.",
    "If you refuse or report a missing file, capability, or observation, cite the evidence for that refusal inline with the same `[@reference]` contract.",
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
