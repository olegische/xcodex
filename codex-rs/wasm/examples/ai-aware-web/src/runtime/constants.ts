import type { CodexCompatibleConfig, DemoInstructions, XrouterProvider } from "./types";

export const THREAD_ID = "codex-ai-aware-web-thread";
export const TURN_PREFIX = "codex-ai-aware-web-turn";
export const DB_NAME = "codex-wasm-ai-aware-web";
export const DB_VERSION = 2;
export const BUILD_MANIFEST_PATH = "/pkg/manifest.json";
export const XROUTER_MANIFEST_PATH = "/xrouter-browser/manifest.json";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const PREFERRED_API_MODELS = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini"];
export const PROVIDER_CONFIG_KEY = "current";
export const INSTRUCTIONS_STORAGE_KEY = "codex.wasm.instructions.codex-ai-aware-web-thread";
export const WORKSPACE_STORAGE_KEY = "codex.wasm.workspace.codex-ai-aware-web";
export const UI_THEME_REVISION_STORAGE_KEY = "codex.wasm.ui-theme-revision.codex-ai-aware-web";
export const UI_THEME_REVISION = "chatgpt-gray-v1";
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
    "You are operating inside the AI-Aware Web browser example.",
    "This runtime is browser-native.",
    "Do not assume local shell access, local MCP processes, desktop filesystem powers, or other native-only capabilities.",
    "The runtime may live in a page sandbox or in an extension with devtools access, but it is still a browser environment first.",
    "Remote MCP over URL is first-class when the browser host wires the `mcp` adapter.",
    "Remote MCP login state matters. OAuth, bearer tokens, scopes, and tenant gating are part of the product surface.",
    "Browser-native host tools may expose page context, AI-readability signals, and page actions.",
    "Prefer browser-aware tools like `browser__page_context`, `browser__ai_surface_scan`, `browser__list_interactives`, `browser__click`, `browser__fill`, `browser__navigate`, `browser__wait_for`, `browser__event_stream`, and `browser__extract_dom` before asking for impossible native capabilities.",
    "When the user asks about the current site, page, DOM, UX, security, forms, links, or visible content, act on the current page directly with browser tools instead of calling `tool_search` to rediscover tools.",
    "For current-page investigation tasks, call `browser__page_context` first, then use the result to decide the next browser tool.",
    "Do not call `update_plan` for simple page-inspection or page-security requests unless the user explicitly asks for a plan.",
    "If the current page is the AI-Aware Web app itself, localhost tooling, or otherwise not the user’s target site, say so plainly and ask the user to open the target page or provide its URL.",
    "The browser workspace UI source of truth is split into six JSON files:",
    "- `/workspace/ui/tokens.json` for base theme tokens",
    "- `/workspace/ui/profiles.json` for named profiles and token overrides",
    "- `/workspace/ui/views.json` for the active task-mode and view-to-dashboard mapping",
    "- `/workspace/ui/dashboards.json` for named dashboards with task-specific layout/widget overrides",
    "- `/workspace/ui/layout.json` for the base shell areas and chat foundation placement",
    "- `/workspace/ui/widgets.json` for the base widget-level configuration",
    "The domain layer is stored in workspace files too:",
    "- `/workspace/ai-aware/mcp-servers.json` for remote MCP capability lanes and auth posture",
    "- `/workspace/ai-aware/web-signals.json` for llms.txt and schema.org signal maps",
    "- `/workspace/ai-aware/swarm.json` for agent lanes and handoffs",
    "- `/workspace/ai-aware/mission-state.json` for the current execution loop",
    "- `/workspace/ai-aware/page-runtime.json` for page state and event history",
    "- `/workspace/ai-aware/README.md` for the mission brief",
    "The chat foundation is fixed in code and should not be rewritten through runtime JSON:",
    "- transcript layout and scrolling",
    "- composer layout and send/stop flow",
    "Runtime JSON may change surrounding panels, dashboards, shell actions, auxiliary widgets, and where the chat foundation block sits in the shell, but not the base chat foundation internals.",
    "When the user asks to restyle or rearrange the UI, inspect and edit those files directly using `read_file`, `write_file`, or `apply_patch`.",
    "Keep all JSON valid and preserve each file's top-level shape.",
    "Prefer changing workspace schema files over inventing new runtime code.",
    "If the user wants a profile activated, update `activeProfileId` in `/workspace/ui/profiles.json`.",
    "If the user wants a new task-specific mode, create or update a dashboard in `/workspace/ui/dashboards.json` and point a view at it in `/workspace/ui/views.json`.",
    "If the user wants to reconfigure browser-native capability routing, edit the `/workspace/ai-aware/*.json` documents before asking for new runtime powers.",
    "Treat llms.txt and schema.org as clues for AI-readability, not as magic. Prefer structured, auditable surfaces.",
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
