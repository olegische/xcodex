import type { BrowserRuntimeHost } from "@browser-codex/wasm-runtime-core/types";
import type { RuntimeMode } from "./types/config.ts";

export type BrowserRuntimeBootstrapPayload = Awaited<
  ReturnType<BrowserRuntimeHost["loadBootstrap"]>
>;

export type BrowserRuntimeBootstrapProvider = {
  name: string;
  baseUrl: string;
  envKey: string;
};

export type BrowserRuntimeCapabilities = {
  workspaceTools: boolean;
  planningTools: boolean;
  appTools: boolean;
};

export type BrowserRuntimeBootstrapParams = {
  codexHome: string;
  cwd: string;
  model: string | null;
  modelProviderId: string;
  modelProvider: BrowserRuntimeBootstrapProvider;
  reasoningEffort: string | null;
  personality: string | null;
  baseInstructions: string;
  developerInstructions: string | null;
  userInstructions: string | null;
  capabilities: BrowserRuntimeCapabilities;
  apiKey: string | null;
  ephemeral: boolean;
};

export function buildBrowserRuntimeBootstrap(
  params: BrowserRuntimeBootstrapParams,
): BrowserRuntimeBootstrapPayload {
  return {
    codexHome: params.codexHome,
    cwd: params.cwd,
    model: params.model,
    modelProviderId: params.modelProviderId,
    modelProvider: {
      name: params.modelProvider.name,
      base_url: params.modelProvider.baseUrl,
      env_key: params.modelProvider.envKey,
      env_key_instructions: null,
      experimental_bearer_token: null,
      wire_api: "responses",
      query_params: null,
      http_headers: null,
      env_http_headers: null,
      request_max_retries: null,
      stream_max_retries: null,
      stream_idle_timeout_ms: null,
      requires_openai_auth: false,
      supports_websockets: false,
    },
    reasoningEffort: params.reasoningEffort,
    personality: params.personality,
    baseInstructions: params.baseInstructions,
    developerInstructions: params.developerInstructions,
    userInstructions: params.userInstructions,
    workspaceTools: params.capabilities.workspaceTools,
    planningTools: params.capabilities.planningTools,
    appTools: params.capabilities.appTools,
    apiKey: params.apiKey,
    ephemeral: params.ephemeral,
  };
}

export function capabilitiesForRuntimeMode(
  runtimeMode: RuntimeMode,
): BrowserRuntimeCapabilities {
  switch (runtimeMode) {
    case "chat":
    case "inspect":
    case "interact":
      return {
        workspaceTools: false,
        planningTools: false,
        appTools: false,
      };
    case "agent":
    case "chaos":
      return {
        workspaceTools: true,
        planningTools: true,
        appTools: true,
      };
  }
}
