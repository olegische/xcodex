import { createBrowserRuntimeHostFromDeps } from "@browser-codex/wasm-browser-host/runtime-host";
import type { BrowserRuntimeHost } from "@browser-codex/wasm-runtime-core/types";
import type { CodexUiRuntimeHostOptions } from "./types";

export function createCodexUiBrowserRuntimeHost<TConfig>(
  options: CodexUiRuntimeHostOptions<TConfig>,
): BrowserRuntimeHost {
  return createBrowserRuntimeHostFromDeps({
    loadBootstrap: async () => options.bootstrap,
    readFile: options.readFile,
    listDir: options.listDir,
    search: options.search,
    applyPatch: options.applyPatch,
    async loadUserConfig() {
      const stored = await options.persistence.loadUserConfig();
      if (stored !== null) {
        return stored;
      }
      return {
        filePath: "/codex-home/config.toml",
        version: "0",
        content: "",
      };
    },
    async saveUserConfig(request) {
      const record =
        request !== null && typeof request === "object" && !Array.isArray(request)
          ? (request as Record<string, unknown>)
          : {};
      if (typeof record.content !== "string") {
        throw new Error("saveUserConfig requires string content");
      }
      return await options.persistence.saveUserConfig({
        filePath: typeof record.filePath === "string" ? record.filePath : null,
        expectedVersion: typeof record.expectedVersion === "string" ? record.expectedVersion : null,
        content: record.content,
      });
    },
    runNormalizedModelTurn: options.runNormalizedModelTurn,
    listDiscoverableApps: options.listDiscoverableApps,
  });
}
