import { DEFAULT_DEMO_INSTRUCTIONS, WORKSPACE_ROOT } from "./constants";
import { loadStoredAuthState, loadStoredCodexConfig, loadStoredDemoInstructions } from "./storage";
import { runResponsesApiTurn, runXrouterTurn } from "./transports";
import { applyWorkspacePatch, listWorkspaceDir, readWorkspaceFile, searchWorkspace } from "./workspace";
import { activeProviderApiKey, getActiveProvider, normalizeHostValue } from "./utils";
import type { BrowserRuntimeHost, JsonValue } from "./types";

export function createBrowserRuntimeHost(): BrowserRuntimeHost {
  return {
    async loadBootstrap() {
      const [authState, codexConfig, demoInstructions] = await Promise.all([
        loadStoredAuthState(),
        loadStoredCodexConfig(),
        loadStoredDemoInstructions().catch(() => structuredClone(DEFAULT_DEMO_INSTRUCTIONS)),
      ]);
      const provider = getActiveProvider(codexConfig);
      const apiKey = activeProviderApiKey(codexConfig);
      const developerInstructions = demoInstructions.agentsInstructions.trim();
      const userInstructions = buildSkillInstructions(demoInstructions);

      return {
        codexHome: "/codex-home",
        cwd: WORKSPACE_ROOT,
        model: codexConfig.model.trim() || null,
        modelProviderId: codexConfig.modelProvider,
        modelProvider: {
          name: provider.name,
          base_url: provider.baseUrl,
          env_key: provider.envKey,
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
        reasoningEffort: codexConfig.modelReasoningEffort,
        personality: codexConfig.personality,
        baseInstructions: demoInstructions.baseInstructions,
        developerInstructions: developerInstructions.length > 0 ? developerInstructions : null,
        userInstructions,
        apiKey:
          authState?.authMode === "apiKey" && authState.openaiApiKey !== null
            ? authState.openaiApiKey
            : apiKey || null,
        ephemeral: false,
      };
    },
    readFile: readWorkspaceFile,
    listDir: listWorkspaceDir,
    search: searchWorkspace,
    applyPatch: applyWorkspacePatch,
    async listDiscoverableApps() {
      return [];
    },
    async runModelTurn(request) {
      const requestRecord = asJsonRecord(normalizeHostValue(request));
      const codexConfig = await loadStoredCodexConfig();
      const provider = getActiveProvider(codexConfig);
      const requestId =
        typeof requestRecord.requestId === "string" ? requestRecord.requestId : crypto.randomUUID();
      const requestBody = asJsonRecord(normalizeHostValue(requestRecord.requestBody));
      const transportOptions = asJsonRecord(normalizeHostValue(requestRecord.transportOptions));
      const extraHeaders = extraHeadersFromTransportOptions(transportOptions);
      const responseInputItems = Array.isArray(requestBody.input)
        ? (requestBody.input as JsonValue[])
        : null;
      console.info("[webui] host.run-model-turn", {
        requestId,
        providerKind: provider.providerKind,
        requestBodyKeys: Object.keys(requestBody),
        inputSummary: summarizeHostInput(responseInputItems),
        transportOptions: transportOptions,
      });
      console.info(
        "[webui] host.run-model-turn:json",
        JSON.stringify(
          {
            requestId,
            providerKind: provider.providerKind,
            requestBody,
            transportOptions,
          },
          null,
          2,
        ),
      );

      if (provider.providerKind === "xrouter_browser") {
        return runXrouterTurn({
          requestId,
          codexConfig,
          requestBody,
          extraHeaders,
        });
      }

      return runResponsesApiTurn({
        requestId,
        baseUrl: provider.baseUrl,
        apiKey: activeProviderApiKey(codexConfig),
        requestBody: requestBody as Record<string, JsonValue>,
        extraHeaders,
      });
    },
  };
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function extraHeadersFromTransportOptions(
  transportOptions: Record<string, unknown>,
): Record<string, string> | null {
  const extraHeaders = asJsonRecord(transportOptions.extraHeaders);
  const entries = Object.entries(extraHeaders).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries);
}

function buildSkillInstructions(demoInstructions: Awaited<ReturnType<typeof loadStoredDemoInstructions>>): string | null {
  const skillContents = demoInstructions.skillContents.trim();
  if (skillContents.length === 0) {
    return null;
  }
  return [
    `Skill: ${demoInstructions.skillName}`,
    `Path: ${demoInstructions.skillPath}`,
    "",
    skillContents,
  ].join("\n");
}

function summarizeHostInput(input: JsonValue[] | null): Record<string, unknown> | null {
  if (input === null) {
    return null;
  }
  return {
    count: input.length,
    itemTypes: input.map((item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).type === "string"
        ? ((item as Record<string, unknown>).type as string)
        : "<invalid>",
    ),
  };
}
