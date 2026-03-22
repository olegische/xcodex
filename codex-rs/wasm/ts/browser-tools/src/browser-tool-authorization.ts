import type { BrowserDynamicToolCatalogEntry, BrowserDynamicToolExecutor } from "@browser-codex/wasm-browser-codex-runtime/types";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import { qualifyDynamicToolName } from "@browser-codex/wasm-runtime-core";

export type BrowserRuntimeMode = "default" | "demo" | "chaos";

export type BrowserToolAuthorizationPhase = "list" | "invoke";

export type BrowserToolAuthorizationDecision =
  | {
      decision: "allow";
      canonicalToolName: string;
      requiredScopes: string[];
      grantedScopes: string[];
      runtimeMode: BrowserRuntimeMode;
    }
  | {
      decision: "deny";
      canonicalToolName: string | null;
      reason:
        | "unknown_tool"
        | "invalid_runtime_mode"
        | "insufficient_scope"
        | "unsupported_capability";
      requiredScopes: string[];
      grantedScopes: string[];
      runtimeMode: BrowserRuntimeMode;
    };

type BrowserToolAuthorizationEntry = {
  canonicalToolName: string;
  aliases: string[];
  discoveryScopes: string[];
  resolveInvokeScopes(input: JsonValue): string[];
};

export class BrowserToolAuthorizationError extends Error {
  readonly code: string;
  readonly canonicalToolName: string | null;
  readonly originalToolName: string;
  readonly requestPhase: BrowserToolAuthorizationPhase;
  readonly requiredScopes: string[];
  readonly grantedScopes: string[];
  readonly runtimeMode: BrowserRuntimeMode;

  constructor(params: {
    code: "unknown_tool" | "invalid_runtime_mode" | "insufficient_scope" | "unsupported_capability";
    canonicalToolName: string | null;
    originalToolName: string;
    requestPhase: BrowserToolAuthorizationPhase;
    requiredScopes: string[];
    grantedScopes: string[];
    runtimeMode: BrowserRuntimeMode;
    message: string;
  }) {
    super(params.message);
    this.name = "BrowserToolAuthorizationError";
    this.code = params.code;
    this.canonicalToolName = params.canonicalToolName;
    this.originalToolName = params.originalToolName;
    this.requestPhase = params.requestPhase;
    this.requiredScopes = params.requiredScopes;
    this.grantedScopes = params.grantedScopes;
    this.runtimeMode = params.runtimeMode;
  }
}

export function wrapBrowserToolExecutorWithAuthorization(
  executor: BrowserDynamicToolExecutor,
  options?: {
    loadRuntimeMode?: () => BrowserRuntimeMode | Promise<BrowserRuntimeMode>;
  },
): BrowserDynamicToolExecutor {
  return {
    async list() {
      const runtimeMode = await loadRuntimeMode(options?.loadRuntimeMode);
      const { tools } = await executor.list();
      return {
        tools: tools.filter((tool) => {
          const decision = authorizeBrowserToolRequest({
            toolName: qualifyDynamicToolName(tool),
            input: null,
            requestPhase: "list",
            runtimeMode,
          });
          return decision.decision === "allow";
        }),
      };
    },
    async invoke(params) {
      const runtimeMode = await loadRuntimeMode(options?.loadRuntimeMode);
      const originalToolName = qualifyDynamicToolName(params);
      const decision = authorizeBrowserToolRequest({
        toolName: originalToolName,
        input: params.input,
        requestPhase: "invoke",
        runtimeMode,
      });
      if (decision.decision === "deny") {
        throw authorizationErrorFromDecision(decision, originalToolName, "invoke");
      }

      return await executor.invoke({
        ...params,
        toolName: decision.canonicalToolName,
      });
    },
  };
}

export function authorizeBrowserToolRequest(params: {
  toolName: string;
  input: JsonValue;
  requestPhase: BrowserToolAuthorizationPhase;
  runtimeMode: BrowserRuntimeMode;
}): BrowserToolAuthorizationDecision {
  const entry = findAuthorizationEntry(params.toolName);
  if (entry === null) {
    return {
      decision: "deny",
      canonicalToolName: null,
      reason: "unknown_tool",
      requiredScopes: [],
      grantedScopes: grantedScopesForRuntimeMode(params.runtimeMode),
      runtimeMode: params.runtimeMode,
    };
  }

  const grantedScopes = grantedScopesForRuntimeMode(params.runtimeMode);
  if (grantedScopes.length === 0 && params.runtimeMode !== "default") {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: "invalid_runtime_mode",
      requiredScopes: [],
      grantedScopes,
      runtimeMode: params.runtimeMode,
    };
  }

  const requiredScopes =
    params.requestPhase === "list"
      ? entry.discoveryScopes
      : entry.resolveInvokeScopes(params.input);

  if (requiredScopes.includes("browser.js:execute")) {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: "unsupported_capability",
      requiredScopes,
      grantedScopes,
      runtimeMode: params.runtimeMode,
    };
  }

  const hasAllScopes = requiredScopes.every((scope) => grantedScopes.includes(scope));
  if (!hasAllScopes) {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: "insufficient_scope",
      requiredScopes,
      grantedScopes,
      runtimeMode: params.runtimeMode,
    };
  }

  return {
    decision: "allow",
    canonicalToolName: entry.canonicalToolName,
    requiredScopes,
    grantedScopes,
    runtimeMode: params.runtimeMode,
  };
}

function authorizationErrorFromDecision(
  decision: Extract<BrowserToolAuthorizationDecision, { decision: "deny" }>,
  originalToolName: string,
  requestPhase: BrowserToolAuthorizationPhase,
): BrowserToolAuthorizationError {
  return new BrowserToolAuthorizationError({
    code: decision.reason,
    canonicalToolName: decision.canonicalToolName,
    originalToolName,
    requestPhase,
    requiredScopes: decision.requiredScopes,
    grantedScopes: decision.grantedScopes,
    runtimeMode: decision.runtimeMode,
    message: formatAuthorizationErrorMessage(decision, originalToolName, requestPhase),
  });
}

function formatAuthorizationErrorMessage(
  decision: Extract<BrowserToolAuthorizationDecision, { decision: "deny" }>,
  originalToolName: string,
  requestPhase: BrowserToolAuthorizationPhase,
): string {
  const toolName = decision.canonicalToolName ?? originalToolName;
  if (decision.reason === "unknown_tool") {
    return `${requestPhase} blocked: browser tool ${originalToolName} is not mapped to an authorization policy`;
  }
  if (decision.reason === "invalid_runtime_mode") {
    return `${requestPhase} blocked: runtime mode ${decision.runtimeMode} is not supported by browser tool policy`;
  }
  if (decision.reason === "unsupported_capability") {
    return `${requestPhase} blocked: ${toolName} requires browser.js:execute, which is denied in every runtime mode`;
  }
  return `${requestPhase} blocked: ${toolName} requires scopes [${decision.requiredScopes.join(", ")}] in ${decision.runtimeMode} mode`;
}

function findAuthorizationEntry(toolName: string): BrowserToolAuthorizationEntry | null {
  for (const entry of BROWSER_TOOL_AUTHORIZATION_REGISTRY) {
    if (entry.canonicalToolName === toolName || entry.aliases.includes(toolName)) {
      return entry;
    }
  }
  return null;
}

function grantedScopesForRuntimeMode(runtimeMode: BrowserRuntimeMode): string[] {
  return RUNTIME_MODE_SCOPE_GRANTS[runtimeMode] ?? [];
}

async function loadRuntimeMode(
  loadRuntimeModeOverride?: () => BrowserRuntimeMode | Promise<BrowserRuntimeMode>,
): Promise<BrowserRuntimeMode> {
  return (await loadRuntimeModeOverride?.()) ?? "default";
}

function domInspectionScopes(input: JsonValue): string[] {
  const record =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return record.includeHtml === true
    ? ["browser.dom:read", "browser.dom.html:read"]
    : ["browser.dom:read"];
}

const BROWSER_TOOL_AUTHORIZATION_REGISTRY: BrowserToolAuthorizationEntry[] = [
  {
    canonicalToolName: "browser__tool_search",
    aliases: [],
    discoveryScopes: ["browser.tools:read"],
    resolveInvokeScopes: () => ["browser.tools:read"],
  },
  {
    canonicalToolName: "browser__inspect_page",
    aliases: ["browser__page_context"],
    discoveryScopes: ["browser.page:read"],
    resolveInvokeScopes: () => ["browser.page:read"],
  },
  {
    canonicalToolName: "browser__inspect_dom",
    aliases: ["browser__extract_dom"],
    discoveryScopes: ["browser.dom:read"],
    resolveInvokeScopes: domInspectionScopes,
  },
  {
    canonicalToolName: "browser__list_interactives",
    aliases: [],
    discoveryScopes: ["browser.interactives:read"],
    resolveInvokeScopes: () => ["browser.interactives:read"],
  },
  {
    canonicalToolName: "browser__click",
    aliases: [],
    discoveryScopes: ["browser.page:click"],
    resolveInvokeScopes: () => ["browser.page:click"],
  },
  {
    canonicalToolName: "browser__fill",
    aliases: [],
    discoveryScopes: ["browser.page:fill"],
    resolveInvokeScopes: () => ["browser.page:fill"],
  },
  {
    canonicalToolName: "browser__navigate",
    aliases: [],
    discoveryScopes: ["browser.page:navigate"],
    resolveInvokeScopes: () => ["browser.page:navigate"],
  },
  {
    canonicalToolName: "browser__wait_for",
    aliases: [],
    discoveryScopes: ["browser.page:wait"],
    resolveInvokeScopes: () => ["browser.page:wait"],
  },
  {
    canonicalToolName: "browser__inspect_storage",
    aliases: [],
    discoveryScopes: ["browser.storage:read"],
    resolveInvokeScopes: () => ["browser.storage:read"],
  },
  {
    canonicalToolName: "browser__inspect_cookies",
    aliases: [],
    discoveryScopes: ["browser.cookies:read"],
    resolveInvokeScopes: () => ["browser.cookies:read"],
  },
  {
    canonicalToolName: "browser__inspect_http",
    aliases: ["browser__probe_http"],
    discoveryScopes: ["browser.http:read"],
    resolveInvokeScopes: () => ["browser.http:read"],
  },
  {
    canonicalToolName: "browser__inspect_resources",
    aliases: ["browser__page_resources"],
    discoveryScopes: ["browser.resources:read"],
    resolveInvokeScopes: () => ["browser.resources:read"],
  },
  {
    canonicalToolName: "browser__inspect_performance",
    aliases: ["browser__performance_snapshot"],
    discoveryScopes: ["browser.performance:read"],
    resolveInvokeScopes: () => ["browser.performance:read"],
  },
  {
    canonicalToolName: "browser__evaluate",
    aliases: ["browser__run_probe"],
    discoveryScopes: ["browser.js:execute"],
    resolveInvokeScopes: () => ["browser.js:execute"],
  },
];

const RUNTIME_MODE_SCOPE_GRANTS: Record<BrowserRuntimeMode, string[]> = {
  default: [
    "browser.tools:read",
    "browser.page:read",
    "browser.interactives:read",
    "browser.performance:read",
    "browser.page:wait",
    "browser.dom:read",
  ],
  demo: [
    "browser.tools:read",
    "browser.page:read",
    "browser.interactives:read",
    "browser.performance:read",
    "browser.page:wait",
    "browser.dom:read",
    "browser.dom.html:read",
    "browser.resources:read",
  ],
  chaos: [
    "browser.tools:read",
    "browser.page:read",
    "browser.interactives:read",
    "browser.performance:read",
    "browser.page:wait",
    "browser.dom:read",
    "browser.dom.html:read",
    "browser.resources:read",
    "browser.storage:read",
    "browser.cookies:read",
    "browser.http:read",
    "browser.page:click",
    "browser.page:fill",
    "browser.page:navigate",
  ],
};

export function createBrowserToolCatalogEntry(params: {
  toolName: string;
  description: string;
  inputSchema: JsonValue;
}): BrowserDynamicToolCatalogEntry {
  return {
    toolName: params.toolName,
    toolNamespace: "browser",
    description: params.description,
    inputSchema: params.inputSchema,
  };
}
