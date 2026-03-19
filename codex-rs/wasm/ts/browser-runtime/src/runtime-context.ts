import { createBrowserCodexRuntime } from "@browser-codex/wasm-browser-codex-runtime";
import {
  buildBrowserRuntimeBootstrap,
  createBrowserRuntimeHostFromDeps,
  createNormalizedModelTurnRunner,
} from "@browser-codex/wasm-browser-host";
import {
  createBrowserAwareToolExecutor,
  initializePageTelemetry,
} from "@browser-codex/wasm-browser-tools";
import {
  activeProviderApiKey,
  createBrowserRuntimeModelTransportAdapter,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_DEMO_INSTRUCTIONS,
  formatError,
  getActiveProvider,
  loadRuntimeModule,
  loadXrouterRuntime,
} from "@browser-codex/wasm-runtime-client";
import { createBrowserCodexRuntimeContextWithDeps } from "./runtime-context-core";
import type { BrowserRuntimeContext, CreateBrowserCodexRuntimeContextOptions } from "./types/runtime";

export async function createBrowserCodexRuntimeContext(
  options: CreateBrowserCodexRuntimeContextOptions,
): Promise<BrowserRuntimeContext> {
  return await createBrowserCodexRuntimeContextWithDeps(options, {
    createBrowserCodexRuntime,
    buildBrowserRuntimeBootstrap,
    createBrowserRuntimeHostFromDeps,
    createNormalizedModelTurnRunner,
    createBrowserAwareToolExecutor,
    initializePageTelemetry,
    activeProviderApiKey,
    createBrowserRuntimeModelTransportAdapter,
    defaultConfig: DEFAULT_CODEX_CONFIG,
    defaultDemoInstructions: DEFAULT_DEMO_INSTRUCTIONS,
    formatError,
    getActiveProvider,
    loadRuntimeModule,
    loadXrouterRuntime,
  });
}

export { createBrowserCodexRuntimeContextWithDeps } from "./runtime-context-core";
