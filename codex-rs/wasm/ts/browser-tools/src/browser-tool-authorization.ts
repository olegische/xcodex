import type { BrowserDynamicToolCatalogEntry, BrowserDynamicToolExecutor } from "@browser-codex/wasm-browser-codex-runtime/types";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import { qualifyDynamicToolName } from "@browser-codex/wasm-runtime-core";

export type BrowserRuntimeMode = "default" | "demo" | "chaos";

export type BrowserSecurityPolicy = {
  allowedOrigins: string[];
  allowLocalhost: boolean;
  allowPrivateNetwork: boolean;
};

export type BrowserToolAuthorizationPhase = "list" | "invoke";

type BrowserToolAuthorizationContext = {
  browserSecurityPolicy: BrowserSecurityPolicy;
  currentPageUrl: string | null;
  input: JsonValue;
  requestPhase: BrowserToolAuthorizationPhase;
  runtimeMode: BrowserRuntimeMode;
};

export type BrowserToolAuthorizationDecision =
  | {
      decision: "allow";
      canonicalToolName: string;
      requiredScopes: string[];
      grantedScopes: string[];
      runtimeMode: BrowserRuntimeMode;
      resolvedOrigin: string | null;
    }
  | {
      decision: "deny";
      canonicalToolName: string | null;
      reason:
        | "unknown_tool"
        | "invalid_runtime_mode"
        | "insufficient_scope"
        | "current_origin_unavailable"
        | "invalid_target_url"
        | "origin_not_allowlisted"
        | "localhost_not_allowed"
        | "private_network_not_allowed";
      requiredScopes: string[];
      grantedScopes: string[];
      runtimeMode: BrowserRuntimeMode;
      resolvedOrigin: string | null;
    };

type BrowserToolAuthorizationEntry = {
  canonicalToolName: string;
  aliases: string[];
  discoveryScopes: string[];
  resolveInvokeScopes(input: JsonValue): string[];
  resolveProtectedOrigin?(context: BrowserToolAuthorizationContext): string | null;
  enforceOriginPolicyInList?: boolean;
};

export class BrowserToolAuthorizationError extends Error {
  readonly code: string;
  readonly canonicalToolName: string | null;
  readonly originalToolName: string;
  readonly requestPhase: BrowserToolAuthorizationPhase;
  readonly requiredScopes: string[];
  readonly grantedScopes: string[];
  readonly runtimeMode: BrowserRuntimeMode;
  readonly resolvedOrigin: string | null;

  constructor(params: {
    code:
      | "unknown_tool"
      | "invalid_runtime_mode"
      | "insufficient_scope"
      | "current_origin_unavailable"
      | "invalid_target_url"
      | "origin_not_allowlisted"
      | "localhost_not_allowed"
      | "private_network_not_allowed";
    canonicalToolName: string | null;
    originalToolName: string;
    requestPhase: BrowserToolAuthorizationPhase;
    requiredScopes: string[];
    grantedScopes: string[];
    runtimeMode: BrowserRuntimeMode;
    resolvedOrigin: string | null;
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
    this.resolvedOrigin = params.resolvedOrigin;
  }
}

export function wrapBrowserToolExecutorWithAuthorization(
  executor: BrowserDynamicToolExecutor,
  options?: {
    loadRuntimeMode?: () => BrowserRuntimeMode | Promise<BrowserRuntimeMode>;
    loadBrowserSecurityPolicy?: () => BrowserSecurityPolicy | Promise<BrowserSecurityPolicy>;
    getCurrentPageUrl?: () => string | null | Promise<string | null>;
  },
): BrowserDynamicToolExecutor {
  return {
    async list() {
      const [runtimeMode, browserSecurityPolicy, currentPageUrl] = await Promise.all([
        loadRuntimeMode(options?.loadRuntimeMode),
        loadBrowserSecurityPolicy(options?.loadBrowserSecurityPolicy),
        loadCurrentPageUrl(options?.getCurrentPageUrl),
      ]);
      const { tools } = await executor.list();
      return {
        tools: tools.filter((tool) => {
          const decision = authorizeBrowserToolRequest({
            toolName: qualifyDynamicToolName(tool),
            input: null,
            requestPhase: "list",
            runtimeMode,
            browserSecurityPolicy,
            currentPageUrl,
          });
          return decision.decision === "allow";
        }),
      };
    },
    async invoke(params) {
      const [runtimeMode, browserSecurityPolicy, currentPageUrl] = await Promise.all([
        loadRuntimeMode(options?.loadRuntimeMode),
        loadBrowserSecurityPolicy(options?.loadBrowserSecurityPolicy),
        loadCurrentPageUrl(options?.getCurrentPageUrl),
      ]);
      const originalToolName = qualifyDynamicToolName(params);
      const decision = authorizeBrowserToolRequest({
        toolName: originalToolName,
        input: params.input,
        requestPhase: "invoke",
        runtimeMode,
        browserSecurityPolicy,
        currentPageUrl,
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
  browserSecurityPolicy?: BrowserSecurityPolicy;
  currentPageUrl?: string | null;
}): BrowserToolAuthorizationDecision {
  const entry = findAuthorizationEntry(params.toolName);
  const browserSecurityPolicy =
    params.browserSecurityPolicy ?? DEFAULT_BROWSER_SECURITY_POLICY;
  const grantedScopes = grantedScopesForRuntimeMode(params.runtimeMode);

  if (entry === null) {
    return {
      decision: "deny",
      canonicalToolName: null,
      reason: "unknown_tool",
      requiredScopes: [],
      grantedScopes,
      runtimeMode: params.runtimeMode,
      resolvedOrigin: null,
    };
  }

  if (grantedScopes.length === 0 && params.runtimeMode !== "default") {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: "invalid_runtime_mode",
      requiredScopes: [],
      grantedScopes,
      runtimeMode: params.runtimeMode,
      resolvedOrigin: null,
    };
  }

  const requiredScopes =
    params.requestPhase === "list"
      ? entry.discoveryScopes
      : entry.resolveInvokeScopes(params.input);

  const hasAllScopes = requiredScopes.every((scope) => grantedScopes.includes(scope));
  if (!hasAllScopes) {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: "insufficient_scope",
      requiredScopes,
      grantedScopes,
      runtimeMode: params.runtimeMode,
      resolvedOrigin: null,
    };
  }

  if (
    entry.resolveProtectedOrigin === undefined ||
    (params.requestPhase === "list" && entry.enforceOriginPolicyInList !== true)
  ) {
    return {
      decision: "allow",
      canonicalToolName: entry.canonicalToolName,
      requiredScopes,
      grantedScopes,
      runtimeMode: params.runtimeMode,
      resolvedOrigin: null,
    };
  }

  const authorizationContext: BrowserToolAuthorizationContext = {
    browserSecurityPolicy,
    currentPageUrl: params.currentPageUrl ?? null,
    input: params.input,
    requestPhase: params.requestPhase,
    runtimeMode: params.runtimeMode,
  };
  const resolvedOrigin = entry.resolveProtectedOrigin(authorizationContext);
  if (resolvedOrigin === null) {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason:
        entry.canonicalToolName === "browser__evaluate"
          ? "current_origin_unavailable"
          : "invalid_target_url",
      requiredScopes,
      grantedScopes,
      runtimeMode: params.runtimeMode,
      resolvedOrigin: null,
    };
  }

  const originDecision = authorizeProtectedOrigin(resolvedOrigin, browserSecurityPolicy);
  if (originDecision !== "allow") {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: originDecision,
      requiredScopes,
      grantedScopes,
      runtimeMode: params.runtimeMode,
      resolvedOrigin,
    };
  }

  return {
    decision: "allow",
    canonicalToolName: entry.canonicalToolName,
    requiredScopes,
    grantedScopes,
    runtimeMode: params.runtimeMode,
    resolvedOrigin,
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
    resolvedOrigin: decision.resolvedOrigin,
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
  if (decision.reason === "current_origin_unavailable") {
    return `${requestPhase} blocked: ${toolName} requires a current page origin, but none is available`;
  }
  if (decision.reason === "invalid_target_url") {
    return `${requestPhase} blocked: ${toolName} requires a valid target URL that can be resolved to an origin`;
  }
  if (decision.reason === "origin_not_allowlisted") {
    return `${requestPhase} blocked: ${toolName} target origin ${decision.resolvedOrigin} is not in browser_security.allowed_origins`;
  }
  if (decision.reason === "localhost_not_allowed") {
    return `${requestPhase} blocked: ${toolName} target origin ${decision.resolvedOrigin} resolves to localhost or loopback and browser_security.allow_localhost is false`;
  }
  if (decision.reason === "private_network_not_allowed") {
    return `${requestPhase} blocked: ${toolName} target origin ${decision.resolvedOrigin} resolves to a private or link-local network and browser_security.allow_private_network is false`;
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

async function loadBrowserSecurityPolicy(
  loadBrowserSecurityPolicyOverride?: () => BrowserSecurityPolicy | Promise<BrowserSecurityPolicy>,
): Promise<BrowserSecurityPolicy> {
  return (await loadBrowserSecurityPolicyOverride?.()) ?? DEFAULT_BROWSER_SECURITY_POLICY;
}

async function loadCurrentPageUrl(
  getCurrentPageUrlOverride?: () => string | null | Promise<string | null>,
): Promise<string | null> {
  if (getCurrentPageUrlOverride !== undefined) {
    return (await getCurrentPageUrlOverride()) ?? null;
  }
  return typeof window === "undefined" ? null : window.location.href;
}

function domInspectionScopes(input: JsonValue): string[] {
  const record = asRecord(input);
  return record.includeHtml === true
    ? ["browser.dom:read", "browser.dom.html:read"]
    : ["browser.dom:read"];
}

function resolveCurrentPageOrigin(context: BrowserToolAuthorizationContext): string | null {
  return originFromUrl(context.currentPageUrl);
}

function resolveTargetOriginFromInput(context: BrowserToolAuthorizationContext): string | null {
  const record = asRecord(context.input);
  return originFromUrl(
    typeof record.url === "string" ? record.url : null,
    context.currentPageUrl,
  );
}

function authorizeProtectedOrigin(
  origin: string,
  browserSecurityPolicy: BrowserSecurityPolicy,
):
  | "allow"
  | "origin_not_allowlisted"
  | "localhost_not_allowed"
  | "private_network_not_allowed" {
  const hostname = hostnameFromOrigin(origin);
  if (hostname === null) {
    return "origin_not_allowlisted";
  }

  if (isLocalhostHostname(hostname) && !browserSecurityPolicy.allowLocalhost) {
    return "localhost_not_allowed";
  }

  if (isPrivateNetworkHostname(hostname) && !browserSecurityPolicy.allowPrivateNetwork) {
    return "private_network_not_allowed";
  }

  return browserSecurityPolicy.allowedOrigins.includes(origin)
    ? "allow"
    : "origin_not_allowlisted";
}

function originFromUrl(url: string | null | undefined, baseUrl?: string | null): string | null {
  if (typeof url !== "string" || url.trim().length === 0) {
    return null;
  }
  try {
    const resolved = baseUrl === undefined || baseUrl === null
      ? new URL(url)
      : new URL(url, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.origin;
  } catch {
    return null;
  }
}

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const normalized = hostname.slice(1, -1).toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }
  const octets = hostname.split(".").map(Number);
  const [first, second] = octets;
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return first === 10 ||
    first === 127 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254);
}

function asRecord(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
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
    resolveProtectedOrigin: resolveTargetOriginFromInput,
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
    resolveProtectedOrigin: resolveTargetOriginFromInput,
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
    resolveProtectedOrigin: resolveCurrentPageOrigin,
    enforceOriginPolicyInList: true,
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
    "browser.js:execute",
  ],
};

const DEFAULT_BROWSER_SECURITY_POLICY: BrowserSecurityPolicy = {
  allowedOrigins: [],
  allowLocalhost: false,
  allowPrivateNetwork: false,
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
