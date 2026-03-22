import type {
  BrowserDynamicToolCatalogEntry,
  BrowserDynamicToolExecutor,
  BrowserToolApprovalKind,
  BrowserToolApprovalOption,
  BrowserToolApprovalRequest,
  BrowserToolApprovalResponse,
} from "@browser-codex/wasm-browser-codex-runtime/types";
import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";
import { qualifyDynamicToolName } from "@browser-codex/wasm-runtime-core";

export type BrowserRuntimeMode = "default" | "demo" | "chaos";

export type BrowserSecurityPolicy = {
  allowedOrigins: string[];
  allowLocalhost: boolean;
  allowPrivateNetwork: boolean;
};

export type BrowserToolAuthorizationPhase = "list" | "invoke";

export type BrowserToolAuthorizationGrantLifetime = "turn" | "session";

export type BrowserToolAuthorizationGrant = {
  scopes: string[];
  origin: string;
  approvalKind: BrowserToolApprovalKind;
  lifetime: BrowserToolAuthorizationGrantLifetime;
};

export type BrowserToolAuthorizationContext = {
  runtimeMode: BrowserRuntimeMode;
  browserSecurityPolicy: BrowserSecurityPolicy;
  baselineGrants: string[];
  turnGrants: BrowserToolAuthorizationGrant[];
  sessionGrants: BrowserToolAuthorizationGrant[];
  addGrant(grant: BrowserToolAuthorizationGrant): void;
  clearTurnGrants(): void;
  effectiveScopes(origin: string | null): string[];
  hasGrant(origin: string, scopes: string[]): boolean;
};

type BrowserToolRequestContext = {
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
      decision: "requires_approval";
      canonicalToolName: string;
      requiredScopes: string[];
      grantedScopes: string[];
      runtimeMode: BrowserRuntimeMode;
      resolvedOrigin: string;
      approvalKind: BrowserToolApprovalKind;
      reason: string;
      grantOptions: BrowserToolApprovalOption[];
      targetUrl: string | null;
      displayOrigin: string;
      targetOrigin: string | null;
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
  resolveProtectedOrigin?(context: BrowserToolRequestContext): string | null;
  resolveTargetUrl?(input: JsonValue, currentPageUrl: string | null): string | null;
  enforceOriginPolicyInList?: boolean;
  approvalKind?: BrowserToolApprovalKind;
  approvalEligibleInModes?: BrowserRuntimeMode[];
  approvalReason?: string;
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
      | "private_network_not_allowed"
      | "approval_mediator_unavailable"
      | "approval_mediation_failed"
      | "invalid_approval_response"
      | "approval_denied"
      | "approval_aborted";
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

export function createBrowserToolAuthorizationContext(params: {
  runtimeMode: BrowserRuntimeMode;
  browserSecurityPolicy: BrowserSecurityPolicy;
}): BrowserToolAuthorizationContext {
  const baselineGrants = grantedScopesForRuntimeMode(params.runtimeMode);
  const turnGrants: BrowserToolAuthorizationGrant[] = [];
  const sessionGrants: BrowserToolAuthorizationGrant[] = [];

  return {
    runtimeMode: params.runtimeMode,
    browserSecurityPolicy: params.browserSecurityPolicy,
    baselineGrants,
    turnGrants,
    sessionGrants,
    addGrant(grant) {
      const destination = grant.lifetime === "turn" ? turnGrants : sessionGrants;
      destination.push({
        ...grant,
        scopes: [...grant.scopes],
      });
    },
    clearTurnGrants() {
      turnGrants.length = 0;
    },
    effectiveScopes(origin) {
      if (origin === null) {
        return [...baselineGrants];
      }
      return [...new Set([
        ...baselineGrants,
        ...scopesForOrigin(turnGrants, origin),
        ...scopesForOrigin(sessionGrants, origin),
      ])];
    },
    hasGrant(origin, scopes) {
      const effectiveScopes = this.effectiveScopes(origin);
      return scopes.every((scope) => effectiveScopes.includes(scope));
    },
  };
}

export function wrapBrowserToolExecutorWithAuthorization(
  executor: BrowserDynamicToolExecutor,
  options?: {
    loadRuntimeMode?: () => BrowserRuntimeMode | Promise<BrowserRuntimeMode>;
    loadBrowserSecurityPolicy?: () => BrowserSecurityPolicy | Promise<BrowserSecurityPolicy>;
    getCurrentPageUrl?: () => string | null | Promise<string | null>;
    getAuthorizationContext?:
      | (() => BrowserToolAuthorizationContext | Promise<BrowserToolAuthorizationContext>);
    requestApproval?:
      | ((request: BrowserToolApprovalRequest) => Promise<BrowserToolApprovalResponse>);
  },
): BrowserDynamicToolExecutor {
  let authorizationContextPromise: Promise<BrowserToolAuthorizationContext> | null = null;

  async function loadAuthorizationContext(): Promise<BrowserToolAuthorizationContext> {
    if (options?.getAuthorizationContext !== undefined) {
      return await options.getAuthorizationContext();
    }
    if (authorizationContextPromise === null) {
      authorizationContextPromise = Promise.all([
        loadRuntimeMode(options?.loadRuntimeMode),
        loadBrowserSecurityPolicy(options?.loadBrowserSecurityPolicy),
      ]).then(([runtimeMode, browserSecurityPolicy]) =>
        createBrowserToolAuthorizationContext({
          runtimeMode,
          browserSecurityPolicy,
        }));
    }
    return await authorizationContextPromise;
  }

  return {
    async list() {
      const [authorizationContext, currentPageUrl] = await Promise.all([
        loadAuthorizationContext(),
        loadCurrentPageUrl(options?.getCurrentPageUrl),
      ]);
      const { tools } = await executor.list();
      return {
        tools: tools.filter((tool) => {
          const decision = authorizeBrowserToolRequest({
            toolName: qualifyDynamicToolName(tool),
            input: null,
            requestPhase: "list",
            authorizationContext,
            currentPageUrl,
          });
          return decision.decision === "allow" || decision.decision === "requires_approval";
        }),
      };
    },
    async invoke(params) {
      const [authorizationContext, currentPageUrl] = await Promise.all([
        loadAuthorizationContext(),
        loadCurrentPageUrl(options?.getCurrentPageUrl),
      ]);
      const originalToolName = qualifyDynamicToolName(params);
      const decision = authorizeBrowserToolRequest({
        toolName: originalToolName,
        input: params.input,
        requestPhase: "invoke",
        authorizationContext,
        currentPageUrl,
      });

      if (decision.decision === "deny") {
        throw authorizationErrorFromDecision(decision, originalToolName, "invoke");
      }

      if (decision.decision === "requires_approval") {
        await mediateBrowserToolApproval({
          decision,
          originalToolName,
          requestPhase: "invoke",
          authorizationContext,
          requestApproval: options?.requestApproval,
        });
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
  authorizationContext?: BrowserToolAuthorizationContext;
  runtimeMode?: BrowserRuntimeMode;
  browserSecurityPolicy?: BrowserSecurityPolicy;
  currentPageUrl?: string | null;
}): BrowserToolAuthorizationDecision {
  const entry = findAuthorizationEntry(params.toolName);
  const authorizationContext =
    params.authorizationContext ??
    createBrowserToolAuthorizationContext({
      runtimeMode: params.runtimeMode ?? "default",
      browserSecurityPolicy:
        params.browserSecurityPolicy ?? DEFAULT_BROWSER_SECURITY_POLICY,
    });

  if (entry === null) {
    return {
      decision: "deny",
      canonicalToolName: null,
      reason: "unknown_tool",
      requiredScopes: [],
      grantedScopes: authorizationContext.baselineGrants,
      runtimeMode: authorizationContext.runtimeMode,
      resolvedOrigin: null,
    };
  }

  if (
    authorizationContext.baselineGrants.length === 0 &&
    authorizationContext.runtimeMode !== "default"
  ) {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: "invalid_runtime_mode",
      requiredScopes: [],
      grantedScopes: authorizationContext.baselineGrants,
      runtimeMode: authorizationContext.runtimeMode,
      resolvedOrigin: null,
    };
  }

  const requiredScopes =
    params.requestPhase === "list"
      ? entry.discoveryScopes
      : entry.resolveInvokeScopes(params.input);

  const requestContext: BrowserToolRequestContext = {
    browserSecurityPolicy: authorizationContext.browserSecurityPolicy,
    currentPageUrl: params.currentPageUrl ?? null,
    input: params.input,
    requestPhase: params.requestPhase,
    runtimeMode: authorizationContext.runtimeMode,
  };

  const originDecision = resolveOriginAuthorizationDecision(entry, requestContext);
  if (originDecision.decision === "deny") {
    return {
      decision: "deny",
      canonicalToolName: entry.canonicalToolName,
      reason: originDecision.reason,
      requiredScopes,
      grantedScopes: authorizationContext.baselineGrants,
      runtimeMode: authorizationContext.runtimeMode,
      resolvedOrigin: originDecision.resolvedOrigin,
    };
  }

  const resolvedOrigin = originDecision.resolvedOrigin;
  const grantedScopes = authorizationContext.effectiveScopes(resolvedOrigin);
  if (requiredScopes.every((scope) => grantedScopes.includes(scope))) {
    return {
      decision: "allow",
      canonicalToolName: entry.canonicalToolName,
      requiredScopes,
      grantedScopes,
      runtimeMode: authorizationContext.runtimeMode,
      resolvedOrigin,
    };
  }

  if (
    entry.approvalKind !== undefined &&
    entry.approvalReason !== undefined &&
    isApprovalEligibleForMode(entry, authorizationContext.runtimeMode)
  ) {
    if (params.requestPhase === "list") {
      return {
        decision: "allow",
        canonicalToolName: entry.canonicalToolName,
        requiredScopes,
        grantedScopes,
        runtimeMode: authorizationContext.runtimeMode,
        resolvedOrigin,
      };
    }

    if (resolvedOrigin !== null) {
      return {
        decision: "requires_approval",
        canonicalToolName: entry.canonicalToolName,
        requiredScopes,
        grantedScopes,
        runtimeMode: authorizationContext.runtimeMode,
        resolvedOrigin,
        approvalKind: entry.approvalKind,
        reason: entry.approvalReason,
        grantOptions: DEFAULT_APPROVAL_OPTIONS,
        targetUrl: entry.resolveTargetUrl?.(params.input, params.currentPageUrl ?? null) ?? null,
        displayOrigin: resolvedOrigin,
        targetOrigin:
          entry.canonicalToolName === "browser__navigate" ||
            entry.canonicalToolName === "browser__inspect_http"
            ? resolvedOrigin
            : null,
      };
    }
  }

  return {
    decision: "deny",
    canonicalToolName: entry.canonicalToolName,
    reason: "insufficient_scope",
    requiredScopes,
    grantedScopes,
    runtimeMode: authorizationContext.runtimeMode,
    resolvedOrigin,
  };
}

async function mediateBrowserToolApproval(params: {
  decision: Extract<BrowserToolAuthorizationDecision, { decision: "requires_approval" }>;
  originalToolName: string;
  requestPhase: BrowserToolAuthorizationPhase;
  authorizationContext: BrowserToolAuthorizationContext;
  requestApproval?:
    | ((request: BrowserToolApprovalRequest) => Promise<BrowserToolApprovalResponse>);
}): Promise<void> {
  if (params.requestApproval === undefined) {
    throw new BrowserToolAuthorizationError({
      code: "approval_mediator_unavailable",
      canonicalToolName: params.decision.canonicalToolName,
      originalToolName: params.originalToolName,
      requestPhase: params.requestPhase,
      requiredScopes: params.decision.requiredScopes,
      grantedScopes: params.decision.grantedScopes,
      runtimeMode: params.decision.runtimeMode,
      resolvedOrigin: params.decision.resolvedOrigin,
      message: `${params.requestPhase} blocked: ${params.decision.canonicalToolName} requires human approval, but no browser approval mediator is configured`,
    });
  }

  let response: BrowserToolApprovalResponse;
  try {
    response = await params.requestApproval(
      approvalRequestFromDecision(params.decision, params.originalToolName),
    );
  } catch (error) {
    throw new BrowserToolAuthorizationError({
      code: "approval_mediation_failed",
      canonicalToolName: params.decision.canonicalToolName,
      originalToolName: params.originalToolName,
      requestPhase: params.requestPhase,
      requiredScopes: params.decision.requiredScopes,
      grantedScopes: params.decision.grantedScopes,
      runtimeMode: params.decision.runtimeMode,
      resolvedOrigin: params.decision.resolvedOrigin,
      message: `${params.requestPhase} blocked: approval mediation failed for ${params.decision.canonicalToolName}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (
    response.decision !== "allow_once" &&
    response.decision !== "allow_for_session" &&
    response.decision !== "deny" &&
    response.decision !== "abort"
  ) {
    throw new BrowserToolAuthorizationError({
      code: "invalid_approval_response",
      canonicalToolName: params.decision.canonicalToolName,
      originalToolName: params.originalToolName,
      requestPhase: params.requestPhase,
      requiredScopes: params.decision.requiredScopes,
      grantedScopes: params.decision.grantedScopes,
      runtimeMode: params.decision.runtimeMode,
      resolvedOrigin: params.decision.resolvedOrigin,
      message: `${params.requestPhase} blocked: approval mediator returned an invalid decision for ${params.decision.canonicalToolName}`,
    });
  }

  if (response.decision === "deny") {
    throw new BrowserToolAuthorizationError({
      code: "approval_denied",
      canonicalToolName: params.decision.canonicalToolName,
      originalToolName: params.originalToolName,
      requestPhase: params.requestPhase,
      requiredScopes: params.decision.requiredScopes,
      grantedScopes: params.decision.grantedScopes,
      runtimeMode: params.decision.runtimeMode,
      resolvedOrigin: params.decision.resolvedOrigin,
      message: `${params.requestPhase} blocked: approval denied for ${params.decision.canonicalToolName}`,
    });
  }

  if (response.decision === "abort") {
    throw new BrowserToolAuthorizationError({
      code: "approval_aborted",
      canonicalToolName: params.decision.canonicalToolName,
      originalToolName: params.originalToolName,
      requestPhase: params.requestPhase,
      requiredScopes: params.decision.requiredScopes,
      grantedScopes: params.decision.grantedScopes,
      runtimeMode: params.decision.runtimeMode,
      resolvedOrigin: params.decision.resolvedOrigin,
      message: `${params.requestPhase} blocked: approval aborted for ${params.decision.canonicalToolName}`,
    });
  }

  params.authorizationContext.addGrant({
    scopes: params.decision.requiredScopes,
    origin: params.decision.resolvedOrigin,
    approvalKind: params.decision.approvalKind,
    lifetime: response.decision === "allow_for_session" ? "session" : "turn",
  });
}

function approvalRequestFromDecision(
  decision: Extract<BrowserToolAuthorizationDecision, { decision: "requires_approval" }>,
  originalToolName: string,
): BrowserToolApprovalRequest {
  return {
    approvalId: nextApprovalId(),
    toolName: originalToolName,
    canonicalToolName: decision.canonicalToolName,
    requiredScopes: decision.requiredScopes,
    runtimeMode: decision.runtimeMode,
    origin: decision.resolvedOrigin,
    displayOrigin: decision.displayOrigin,
    targetOrigin: decision.targetOrigin,
    targetUrl: decision.targetUrl,
    approvalKind: decision.approvalKind,
    reason: decision.reason,
    grantOptions: decision.grantOptions,
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

function resolveCurrentPageOrigin(context: BrowserToolRequestContext): string | null {
  return originFromUrl(context.currentPageUrl);
}

function resolveTargetOriginFromInput(context: BrowserToolRequestContext): string | null {
  const record = asRecord(context.input);
  return originFromUrl(
    typeof record.url === "string" ? record.url : null,
    context.currentPageUrl,
  );
}

function resolveTargetUrlFromInput(
  input: JsonValue,
  currentPageUrl: string | null,
): string | null {
  const record = asRecord(input);
  const url = typeof record.url === "string" ? record.url : null;
  if (url === null) {
    return null;
  }
  try {
    return new URL(url, currentPageUrl ?? undefined).toString();
  } catch {
    return url;
  }
}

function resolveOriginAuthorizationDecision(
  entry: BrowserToolAuthorizationEntry,
  context: BrowserToolRequestContext,
):
  | { decision: "allow"; resolvedOrigin: string | null }
  | {
      decision: "deny";
      reason:
        | "current_origin_unavailable"
        | "invalid_target_url"
        | "origin_not_allowlisted"
        | "localhost_not_allowed"
        | "private_network_not_allowed";
      resolvedOrigin: string | null;
    } {
  if (
    entry.resolveProtectedOrigin === undefined ||
    (context.requestPhase === "list" && entry.enforceOriginPolicyInList !== true)
  ) {
    return {
      decision: "allow",
      resolvedOrigin: null,
    };
  }

  const resolvedOrigin = entry.resolveProtectedOrigin(context);
  if (resolvedOrigin === null) {
    return {
      decision: "deny",
      reason:
        entry.canonicalToolName === "browser__evaluate"
          ? "current_origin_unavailable"
          : "invalid_target_url",
      resolvedOrigin: null,
    };
  }

  const originDecision = authorizeProtectedOrigin(
    resolvedOrigin,
    context.browserSecurityPolicy,
  );
  if (originDecision !== "allow") {
    return {
      decision: "deny",
      reason: originDecision,
      resolvedOrigin,
    };
  }

  return {
    decision: "allow",
    resolvedOrigin,
  };
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

function scopesForOrigin(
  grants: BrowserToolAuthorizationGrant[],
  origin: string,
): string[] {
  return grants
    .filter((grant) => grant.origin === origin)
    .flatMap((grant) => grant.scopes);
}

function isApprovalEligibleForMode(
  entry: BrowserToolAuthorizationEntry,
  runtimeMode: BrowserRuntimeMode,
): boolean {
  return entry.approvalEligibleInModes?.includes(runtimeMode) ?? false;
}

let approvalCounter = 0;

function nextApprovalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  approvalCounter += 1;
  return `browser-approval-${approvalCounter}`;
}

const DEFAULT_APPROVAL_OPTIONS: BrowserToolApprovalOption[] = [
  "allow_once",
  "allow_for_session",
  "deny",
  "abort",
];

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
    resolveTargetUrl: resolveTargetUrlFromInput,
    approvalKind: "navigation",
    approvalEligibleInModes: ["default", "demo", "chaos"],
    approvalReason: "Navigate the current page to the requested URL.",
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
    resolveTargetUrl: resolveTargetUrlFromInput,
    approvalKind: "network",
    approvalEligibleInModes: ["default", "demo", "chaos"],
    approvalReason: "Read HTTP response metadata from the target origin.",
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
    approvalKind: "code_execution",
    approvalEligibleInModes: ["chaos"],
    approvalReason: "Run JavaScript in the current page context.",
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
    "browser.page:click",
    "browser.page:fill",
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
