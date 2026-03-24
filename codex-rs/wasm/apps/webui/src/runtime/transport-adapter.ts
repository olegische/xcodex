import {
  createBrowserRuntimeModelTransportAdapter,
} from "xcodex-embedded-client/transport";
import {
  loadXrouterRuntime,
} from "xcodex-embedded-client/assets";
import type {
  CodexCompatibleConfig,
  JsonValue,
  ModelPreset,
} from "xcodex-embedded-client/types";
import type { ModelTransportAdapter } from "@browser-codex/wasm-model-transport";

export const webUiModelTransportAdapter: ModelTransportAdapter<
  CodexCompatibleConfig,
  ModelPreset,
  JsonValue
> = createBrowserRuntimeModelTransportAdapter({
  loadXrouterRuntime,
});
