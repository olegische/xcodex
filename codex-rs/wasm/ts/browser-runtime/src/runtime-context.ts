import { createBrowserCodexRuntime } from "@browser-codex/wasm-browser-codex-runtime";
import {
  createBrowserAwareToolExecutor,
  initializePageTelemetry,
} from "@browser-codex/wasm-browser-tools";
import {
  buildBrowserRuntimeBootstrap,
} from "./bootstrap.ts";
import {
  createBrowserRuntimeHostFromDeps,
  createNormalizedModelTurnRunner,
} from "./runtime-host.ts";
import {
  activeProviderApiKey,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_DEMO_INSTRUCTIONS,
  formatError,
  getActiveProvider,
} from "./config.ts";
import { loadRuntimeModule, loadXrouterRuntime } from "./assets.ts";
import { createBrowserRuntimeModelTransportAdapter } from "./transport.ts";
import { createBrowserCodexRuntimeContextWithDeps } from "./runtime-context-core.ts";
import type {
  BrowserRuntimeContext,
  CreateBrowserCodexRuntimeContextOptions,
} from "./types/runtime.ts";

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

export { createBrowserCodexRuntimeContextWithDeps } from "./runtime-context-core.ts";
