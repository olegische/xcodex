import { WORKSPACE_ROOT } from "@browser-codex/wasm-browser-host/constants";
import {
  createNormalizedModelTurnRunner,
  createBrowserRuntimeHostFromDeps,
} from "@browser-codex/wasm-browser-host/runtime-host";
import { buildBrowserRuntimeBootstrap } from "@browser-codex/wasm-browser-host";
import { DEFAULT_DEMO_INSTRUCTIONS } from "./constants";
import {
  loadStoredAuthState,
  loadStoredCodexConfig,
  loadStoredDemoInstructions,
  loadStoredUserConfig,
  saveStoredUserConfig,
} from "./storage";
import { webUiModelTransportAdapter } from "./transport-adapter";
import { applyWorkspacePatch, listWorkspaceDir, readWorkspaceFile, searchWorkspace } from "./workspace";
import { activeProviderApiKey, getActiveProvider } from "./utils";
import type { BrowserRuntimeHost } from "./types";

export function createBrowserRuntimeHost(): BrowserRuntimeHost {
  return createBrowserRuntimeHostFromDeps({
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

      return buildBrowserRuntimeBootstrap({
        codexHome: "/codex-home",
        cwd: WORKSPACE_ROOT,
        model: codexConfig.model.trim() || null,
        modelProviderId: codexConfig.modelProvider,
        modelProvider: {
          name: provider.name,
          baseUrl: provider.baseUrl,
          envKey: provider.envKey,
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
      });
    },
    readFile: readWorkspaceFile,
    listDir: listWorkspaceDir,
    search: searchWorkspace,
    applyPatch: applyWorkspacePatch,
    async loadUserConfig() {
      const stored = await loadStoredUserConfig();
      if (stored === null) {
        return {
          filePath: "/codex-home/config.toml",
          version: "0",
          content: "",
        };
      }
      return {
        filePath: stored.filePath,
        version: stored.version,
        content: stored.content,
      };
    },
    async saveUserConfig(request) {
      const requestRecord =
        request !== null && typeof request === "object" && !Array.isArray(request)
          ? (request as Record<string, unknown>)
          : {};
      if (typeof requestRecord.content !== "string") {
        throw new Error("saveUserConfig requires string content");
      }
      const saved = await saveStoredUserConfig({
        filePath: typeof requestRecord.filePath === "string" ? requestRecord.filePath : null,
        expectedVersion:
          typeof requestRecord.expectedVersion === "string"
            ? requestRecord.expectedVersion
            : null,
        content: requestRecord.content,
      });
      return {
        filePath: saved.filePath,
        version: saved.version,
      };
    },
    async listDiscoverableApps() {
      return [];
    },
    runNormalizedModelTurn: createNormalizedModelTurnRunner({
      scope: "nullops",
      loadConfig: loadStoredCodexConfig,
      getProviderKind(config) {
        return getActiveProvider(config).providerKind;
      },
      async runModelTurn(params) {
        return await webUiModelTransportAdapter.runModelTurn(params);
      },
    }),
  });
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
