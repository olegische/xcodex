import type { DemoInstructions } from "xcodex-runtime/types";
import { DEFAULT_DEMO_BASE_INSTRUCTIONS } from "./default-demo-instructions";

export const THREAD_SLOT_ID = "nullops-thread";
export const THREAD_BINDING_STORAGE_KEY = "codex.wasm.thread-binding.nullops";
export const THREAD_RUNTIME_REVISION_STORAGE_KEY = "codex.wasm.thread-revision.nullops";
export const THREAD_RUNTIME_REVISION = "protocol-first-ledger-v2";
export const DB_NAME = "codex-wasm-nullops";
export const DB_VERSION = 5;
export const INSTRUCTIONS_STORAGE_KEY = `codex.wasm.instructions.${THREAD_SLOT_ID}`;
export const UI_THEME_REVISION_STORAGE_KEY = "codex.wasm.ui-theme-revision.nullops";
export const UI_THEME_REVISION = "nullops-v1";
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
