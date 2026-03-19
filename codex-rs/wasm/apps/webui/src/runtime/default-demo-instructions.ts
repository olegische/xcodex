import corePromptWithApplyPatchInstructions from "../../../../core/prompt_with_apply_patch_instructions.md?raw";
import browserDemoOverrides from "./browser-demo-overrides.md?raw";

export const DEFAULT_DEMO_BASE_INSTRUCTIONS = [
  corePromptWithApplyPatchInstructions.trim(),
  browserDemoOverrides.trim(),
].join("\n\n");
