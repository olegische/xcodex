import {
  createBrowserRuntimeModelTransportAdapter,
  loadXrouterRuntime,
  type CodexCompatibleConfig,
  type JsonValue,
  type ModelPreset,
} from "xcodex-runtime";
import type { ModelTransportAdapter } from "@browser-codex/wasm-model-transport";

export const webUiModelTransportAdapter: ModelTransportAdapter<
  CodexCompatibleConfig,
  ModelPreset,
  JsonValue
> = createBrowserRuntimeModelTransportAdapter({
  loadXrouterRuntime,
});
