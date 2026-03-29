import type { DemoInstructions } from "xcodex-embedded-client/types";
import { DEFAULT_DEMO_BASE_INSTRUCTIONS } from "./default-demo-instructions";

export const THREAD_SLOT_ID = "codex-browser-terminal-thread";
export const THREAD_BINDING_STORAGE_KEY = "codex.wasm.thread-binding.codex-browser-terminal";
export const RESPONSES_BINDING_STORAGE_KEY = "codex.wasm.responses-binding.codex-browser-terminal";
export const A2A_TASK_BINDING_STORAGE_KEY = "codex.wasm.a2a-task-binding.codex-browser-terminal";
export const PROTOCOL_MODE_STORAGE_KEY = "codex.wasm.protocol-mode.codex-browser-terminal";
export const TRANSPORT_MODE_STORAGE_KEY = "codex.wasm.transport-mode.codex-browser-terminal";
export const THREAD_RUNTIME_REVISION_STORAGE_KEY = "codex.wasm.thread-revision.codex-browser-terminal";
export const THREAD_RUNTIME_REVISION = "protocol-first-ledger-v2";
export const DB_NAME = "codex-wasm-browser-terminal";
export const DB_VERSION = 5;
export const INSTRUCTIONS_STORAGE_KEY = `codex.wasm.instructions.${THREAD_SLOT_ID}`;
export const UI_THEME_REVISION_STORAGE_KEY = "codex.wasm.ui-theme-revision.codex-browser-terminal";
export const UI_THEME_REVISION = "codex-terminal-v1";
export const DEFAULT_LOCAL_CODEX_BASE_URL = "http://localhost:5999";
export const ENABLE_PAGE_TELEMETRY = false;
export const CONNECTED_TOOL_NAMES = [
  "read_file",
  "list_dir",
  "grep_files",
  "apply_patch",
  "update_plan",
  "request_user_input",
] as const;

export const DEFAULT_DEMO_INSTRUCTIONS: DemoInstructions = {
  baseInstructions: DEFAULT_DEMO_BASE_INSTRUCTIONS,
  agentsDirectory: "/workspace",
  agentsInstructions: "",
  skillName: "browser-skill",
  skillPath: "skills/browser/SKILL.md",
  skillContents: "",
};
