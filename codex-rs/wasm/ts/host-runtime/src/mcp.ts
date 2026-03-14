import type { JsonValue } from "./protocol.js";
import type { HostToolExecutorAdapter } from "./runtime.js";

export type RemoteMcpServerConfig = {
  serverName: string;
  serverUrl: string;
  toolPrefix?: string;
  oauthScopes?: string[];
  oauthResource?: string | null;
  staticHeaders?: Record<string, string>;
  clientName?: string;
  clientUri?: string | null;
  oauthClientId?: string | null;
  oauthClientMetadataUrl?: string | null;
};

export type RemoteMcpToolSpec = {
  serverName: string;
  qualifiedName: string;
  originalName: string;
  description: string;
  inputSchema: JsonValue;
};

export type RemoteMcpServerState = {
  serverName: string;
  serverUrl: string;
  authStatus: "connected" | "login_required" | "authorizing" | "error";
  toolCount: number;
  tools: RemoteMcpToolSpec[];
  lastError: string | null;
  expiresAt: number | null;
  scopes: string[];
  clientId: string | null;
};

export type RemoteMcpLoginStart = {
  serverName: string;
  authorizationUrl: string;
  redirectUri: string;
};

type OAuthPendingLogin = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
};

type OAuthTokenState = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
  tokenType: string | null;
};

type RemoteMcpStoredServer = {
  serverName: string;
  serverUrl: string;
  toolPrefix: string;
  oauthScopes: string[];
  oauthResource: string | null;
  staticHeaders: Record<string, string>;
  clientName: string;
  clientUri: string | null;
  clientId: string | null;
  clientMetadataUrl: string | null;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  registrationEndpoint: string | null;
  codeChallengeMethodsSupported: string[];
  clientIdMetadataDocumentSupported: boolean;
  token: OAuthTokenState | null;
  sessionId: string | null;
  protocolVersion: string | null;
  pendingLogin: OAuthPendingLogin | null;
  tools: RemoteMcpToolSpec[];
  lastError: string | null;
};

export interface RemoteMcpStateStore {
  load(serverName: string): Promise<RemoteMcpStoredServer | null>;
  save(record: RemoteMcpStoredServer): Promise<void>;
  delete(serverName: string): Promise<void>;
  list(): Promise<RemoteMcpStoredServer[]>;
}

export type IndexedDbRemoteMcpStateStoreOptions = {
  dbName?: string;
  storeName?: string;
};

export type RemoteMcpControllerOptions = {
  servers: RemoteMcpServerConfig[];
  stateStore?: RemoteMcpStateStore;
  fetch?: typeof fetch;
  now?: () => number;
};

const JSON_RPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const LOGIN_SKEW_SECONDS = 60;
const MCP_DB_NAME = "codex-wasm-browser-mcp";
const MCP_STORE_NAME = "remote-mcp-servers";
const PKCE_METHOD = "S256";

function summarizeMcpValue(value: JsonValue): string {
  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    return `object(${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",..." : ""})`;
  }
  return String(value);
}

function stringifyMcpValueForLog(value: JsonValue): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return error instanceof Error ? `[unserializable: ${error.message}]` : "[unserializable]";
  }
}

export class RemoteMcpController {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly stateStore: RemoteMcpStateStore;
  private readonly configs = new Map<string, RemoteMcpServerConfig>();
  private readonly inflight = new Map<string, AbortController>();

  public constructor(options: RemoteMcpControllerOptions) {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.fetchImpl = (input, init) => fetchImpl(input, init);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.stateStore = options.stateStore ?? createInMemoryRemoteMcpStateStore();
    for (const server of options.servers) {
      this.configs.set(server.serverName, server);
    }
  }

  public async listServers(): Promise<RemoteMcpServerState[]> {
    const known = new Set<string>(this.configs.keys());
    const records = await this.stateStore.list();
    for (const record of records) {
      known.add(record.serverName);
    }
    const states = await Promise.all(
      [...known].sort().map(async (serverName) => this.toServerState(await this.loadState(serverName))),
    );
    return states;
  }

  public async addServer(params: { serverUrl: string; serverName?: string | null }): Promise<RemoteMcpServerState> {
    const normalizedUrl = normalizeServerUrl(params.serverUrl);
    const existingNames = new Set<string>([
      ...this.configs.keys(),
      ...(await this.stateStore.list()).map((record) => record.serverName),
    ]);
    const requestedName =
      typeof params.serverName === "string" && params.serverName.trim().length > 0
        ? slugifyServerName(params.serverName)
        : null;
    const serverName = ensureUniqueServerName(
      requestedName ?? deriveServerNameFromUrl(normalizedUrl),
      existingNames,
    );
    this.configs.set(serverName, {
      serverName,
      serverUrl: normalizedUrl,
    });
    const state = await this.loadState(serverName);
    return this.toServerState(state);
  }

  public async removeServer(serverName: string): Promise<void> {
    this.configs.delete(serverName);
    await this.stateStore.delete(serverName);
  }

  public async beginLogin(params: {
    serverName: string;
    redirectUri: string;
  }): Promise<RemoteMcpLoginStart> {
    let state = await this.loadState(params.serverName);
    state = await this.ensureOAuthMetadata(state);
    ensurePkceS256Supported(state);
    state = await this.ensureClientRegistration(state, params.redirectUri);

    if (state.authorizationEndpoint === null || state.clientId === null) {
      throw new Error(`MCP server ${params.serverName} does not expose a usable OAuth configuration`);
    }

    const oauthState = randomString();
    const codeVerifier = randomString();
    const challenge = await pkceChallengeFromVerifier(codeVerifier);
    const url = new URL(state.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", state.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", PKCE_METHOD);
    url.searchParams.set("state", oauthState);
    if (state.oauthScopes.length > 0) {
      url.searchParams.set("scope", state.oauthScopes.join(" "));
    }
    url.searchParams.set("resource", resourceIndicator(state));

    state.pendingLogin = {
      state: oauthState,
      codeVerifier,
      redirectUri: params.redirectUri,
    };
    state.lastError = null;
    await this.stateStore.save(state);

    return {
      serverName: params.serverName,
      authorizationUrl: url.toString(),
      redirectUri: params.redirectUri,
    };
  }

  public async completeLogin(params: {
    serverName: string;
    callbackUrl: string;
  }): Promise<RemoteMcpServerState> {
    let state = await this.loadState(params.serverName);
    if (state.pendingLogin === null) {
      throw new Error(`MCP server ${params.serverName} has no pending OAuth login`);
    }
    if (state.tokenEndpoint === null || state.clientId === null) {
      throw new Error(`MCP server ${params.serverName} is missing token exchange metadata`);
    }

    const callback = new URL(params.callbackUrl);
    const error = callback.searchParams.get("error");
    if (error !== null) {
      const description = callback.searchParams.get("error_description");
      throw new Error(description === null ? error : `${error}: ${description}`);
    }

    const stateParam = callback.searchParams.get("state");
    if (stateParam !== state.pendingLogin.state) {
      throw new Error(`MCP server ${params.serverName} returned an invalid OAuth state`);
    }

    const code = callback.searchParams.get("code");
    if (code === null || code.length === 0) {
      throw new Error(`MCP server ${params.serverName} callback is missing an authorization code`);
    }

    const token = await this.exchangeCodeForToken(state, code);
    state.token = token;
    state.pendingLogin = null;
    state.sessionId = null;
    state.protocolVersion = null;
    state.lastError = null;
    await this.stateStore.save(state);

    await this.refreshServerTools(params.serverName);
    return this.toServerState(await this.loadState(params.serverName));
  }

  public async logoutServer(serverName: string): Promise<void> {
    const state = await this.loadState(serverName);
    state.token = null;
    state.pendingLogin = null;
    state.sessionId = null;
    state.protocolVersion = null;
    state.tools = [];
    state.lastError = null;
    await this.stateStore.save(state);
  }

  public async refreshServerTools(serverName: string): Promise<RemoteMcpServerState> {
    let state = await this.loadState(serverName);
    state = await this.ensureFreshToken(state);
    const initialized = await this.ensureInitialized(state);
    console.info("[mcp] tools/list:start", {
      serverName,
      serverUrl: initialized.serverUrl,
      authStatus: initialized.token === null ? "unauthenticated" : "authenticated",
      sessionId: initialized.sessionId,
      protocolVersion: initialized.protocolVersion,
    });
    const response = await this.sendJsonRpc(initialized, "tools/list", {});
    const toolEntries = extractToolSpecs(initialized, response);
    initialized.tools = toolEntries;
    initialized.lastError = null;
    await this.stateStore.save(initialized);
    console.info("[mcp] tools/list:done", {
      serverName,
      toolCount: toolEntries.length,
      tools: toolEntries.map((tool) => ({
        qualifiedName: tool.qualifiedName,
        originalName: tool.originalName,
      })),
    });
    return this.toServerState(initialized);
  }

  public async listTools(): Promise<RemoteMcpToolSpec[]> {
    const servers = await this.listServers();
    return servers.flatMap((server) => server.tools);
  }

  public async invokeTool(serverName: string, toolName: string, input: JsonValue): Promise<JsonValue> {
    return this.invokeToolInternal(serverName, toolName, input);
  }

  public async invokeToolForCall(params: {
    serverName: string;
    toolName: string;
    input: JsonValue;
    callId: string;
  }): Promise<JsonValue> {
    return this.invokeToolInternal(params.serverName, params.toolName, params.input, params.callId);
  }

  private async invokeToolInternal(
    serverName: string,
    toolName: string,
    input: JsonValue,
    callId?: string,
  ): Promise<JsonValue> {
    let state = await this.loadState(serverName);
    state = await this.ensureFreshToken(state);
    state = await this.ensureInitialized(state);
    const argumentsPayload =
      input !== null && typeof input === "object" && !Array.isArray(input)
        ? input
        : { input };
    const controller = callId === undefined ? null : new AbortController();
    if (controller !== null) {
      this.inflight.set(callId, controller);
    }
    try {
      console.info("[mcp] tools/call:start", {
        serverName,
        toolName,
        callId: callId ?? null,
        input: summarizeMcpValue(input),
        inputJson: stringifyMcpValueForLog(input),
      });
      const response = await this.sendJsonRpc(
        state,
        "tools/call",
        {
          name: toolName,
          arguments: argumentsPayload,
        },
        false,
        controller?.signal,
      );
      state.lastError = null;
      await this.stateStore.save(state);
      console.info("[mcp] tools/call:done", {
        serverName,
        toolName,
        callId: callId ?? null,
        result: summarizeMcpValue(response.result as JsonValue),
      });
      return response.result;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "remote MCP tool call failed";
      await this.stateStore.save(state);
      console.error("[mcp] tools/call:failed", {
        serverName,
        toolName,
        callId: callId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (callId !== undefined) {
        this.inflight.delete(callId);
      }
    }
  }

  public createToolExecutorAdapter(): HostToolExecutorAdapter {
    return {
      list: async () => {
        const tools = (await this.listTools()).map((tool) => ({
          toolName: tool.originalName,
          toolNamespace: buildQualifiedToolNamespace(tool.serverName),
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        console.info("[mcp] adapter.list", {
          toolCount: tools.length,
          tools: tools.map((tool) => ({
            qualifiedName: `${tool.toolNamespace}${tool.toolName}`,
            namespace: tool.toolNamespace,
            toolName: tool.toolName,
          })),
        });
        return { tools };
      },
      invoke: async (params) => {
        const resolvedInvocation =
          typeof params.toolNamespace === "string" &&
          params.toolNamespace.startsWith("mcp__")
            ? resolveQualifiedToolName(`${params.toolNamespace}${params.toolName}`)
            : typeof params.toolNamespace === "string" && params.toolNamespace.length > 0
              ? {
                  serverName: params.toolNamespace,
                  toolName: params.toolName,
                }
              : resolveQualifiedToolName(params.toolName);
        console.info("[mcp] adapter.invoke", {
          callId: params.callId,
          toolName: params.toolName,
          toolNamespace: params.toolNamespace ?? null,
          resolvedServerName: resolvedInvocation.serverName,
          resolvedToolName: resolvedInvocation.toolName,
        });
        return {
          callId: params.callId,
          output: await this.invokeToolForCall({
            serverName: resolvedInvocation.serverName,
            toolName: resolvedInvocation.toolName,
            input: params.input,
            callId: params.callId,
          }),
        };
      },
      cancel: async (callId) => {
        const controller = this.inflight.get(callId);
        if (controller !== undefined) {
          controller.abort();
          this.inflight.delete(callId);
        }
      },
    };
  }

  private async loadState(serverName: string): Promise<RemoteMcpStoredServer> {
    const config = this.configs.get(serverName);
    const stored = await this.stateStore.load(serverName);
    if (stored !== null) {
      const normalizedTools = stored.tools.map((tool) => normalizeStoredToolSpec(stored.serverName, tool));
      if (config === undefined) {
        return {
          ...stored,
          tools: normalizedTools,
        };
      }
      return {
        ...stored,
        serverUrl: config.serverUrl,
        toolPrefix: config.toolPrefix ?? `mcp__${config.serverName}__`,
        oauthScopes: config.oauthScopes ?? stored.oauthScopes,
        oauthResource: config.oauthResource ?? stored.oauthResource,
        staticHeaders: config.staticHeaders ?? stored.staticHeaders,
        clientName: config.clientName ?? stored.clientName,
        clientUri: config.clientUri ?? stored.clientUri,
        clientId: config.oauthClientId ?? stored.clientId,
        clientMetadataUrl: config.oauthClientMetadataUrl ?? stored.clientMetadataUrl,
        tools: normalizedTools,
      };
    }
    if (config === undefined) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    const initialState: RemoteMcpStoredServer = {
      serverName: config.serverName,
      serverUrl: config.serverUrl,
      toolPrefix: config.toolPrefix ?? `mcp__${config.serverName}__`,
      oauthScopes: config.oauthScopes ?? [],
      oauthResource: config.oauthResource ?? null,
      staticHeaders: config.staticHeaders ?? {},
      clientName: config.clientName ?? "Codex WASM MCP",
      clientUri: config.clientUri ?? null,
      clientId: config.oauthClientId ?? null,
      clientMetadataUrl: config.oauthClientMetadataUrl ?? null,
      authorizationEndpoint: null,
      tokenEndpoint: null,
      registrationEndpoint: null,
      codeChallengeMethodsSupported: [],
      clientIdMetadataDocumentSupported: false,
      token: null,
      sessionId: null,
      protocolVersion: null,
      pendingLogin: null,
      tools: [],
      lastError: null,
    };
    await this.stateStore.save(initialState);
    return initialState;
  }

  private async toServerState(state: RemoteMcpStoredServer): Promise<RemoteMcpServerState> {
    const authStatus =
      state.pendingLogin !== null
        ? "authorizing"
        : state.token !== null
          ? "connected"
          : state.lastError !== null
            ? "error"
            : "login_required";
    return {
      serverName: state.serverName,
      serverUrl: state.serverUrl,
      authStatus,
      toolCount: state.tools.length,
      tools: state.tools,
      lastError: state.lastError,
      expiresAt: state.token?.expiresAt ?? null,
      scopes: state.oauthScopes,
      clientId: state.clientId,
    };
  }

  private async ensureOAuthMetadata(state: RemoteMcpStoredServer): Promise<RemoteMcpStoredServer> {
    if (state.authorizationEndpoint !== null && state.tokenEndpoint !== null) {
      return state;
    }

    const protectedResource = await this.fetchJson<{
      authorization_servers?: string[];
      authorizationServer?: string;
      authorization_endpoint?: string;
      token_endpoint?: string;
      registration_endpoint?: string;
      resource?: string;
    }>(candidateProtectedResourceMetadataUrls(state.serverUrl));

    if (protectedResource.authorization_endpoint && protectedResource.token_endpoint) {
      state.authorizationEndpoint = protectedResource.authorization_endpoint;
      state.tokenEndpoint = protectedResource.token_endpoint;
      state.registrationEndpoint = protectedResource.registration_endpoint ?? null;
      state.oauthResource = state.oauthResource ?? protectedResource.resource ?? null;
      await this.stateStore.save(state);
      return state;
    }

    const authorizationServer =
      protectedResource.authorizationServer ??
      protectedResource.authorization_servers?.[0] ??
      new URL(state.serverUrl).origin;

    const authorizationMetadata = await this.fetchJson<{
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
      code_challenge_methods_supported?: string[];
      client_id_metadata_document_supported?: boolean;
    }>(candidateAuthorizationServerMetadataUrls(authorizationServer));

    state.authorizationEndpoint = authorizationMetadata.authorization_endpoint;
    state.tokenEndpoint = authorizationMetadata.token_endpoint;
    state.registrationEndpoint = authorizationMetadata.registration_endpoint ?? null;
    state.codeChallengeMethodsSupported = authorizationMetadata.code_challenge_methods_supported ?? [];
    state.clientIdMetadataDocumentSupported =
      authorizationMetadata.client_id_metadata_document_supported ?? false;
    await this.stateStore.save(state);
    return state;
  }

  private async ensureClientRegistration(
    state: RemoteMcpStoredServer,
    redirectUri: string,
  ): Promise<RemoteMcpStoredServer> {
    if (state.clientId !== null) {
      return state;
    }
    if (state.clientIdMetadataDocumentSupported) {
      throw new Error(
        `MCP server ${state.serverName} requires a pre-registered client_id or metadata document URL in browser mode`,
      );
    }
    if (state.registrationEndpoint === null) {
      throw new Error(`MCP server ${state.serverName} does not expose a client registration endpoint`);
    }

    const payload: Record<string, unknown> = {
      client_name: state.clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    };
    if (state.clientUri !== null) {
      payload.client_uri = state.clientUri;
    }
    const response = await this.fetchImpl(state.registrationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`MCP client registration failed: ${response.status} ${response.statusText}`);
    }
    const registered = (await response.json()) as {
      client_id?: string;
    };
    if (typeof registered.client_id !== "string" || registered.client_id.length === 0) {
      throw new Error(`MCP registration did not return a client_id for ${state.serverName}`);
    }
    state.clientId = registered.client_id;
    await this.stateStore.save(state);
    return state;
  }

  private async exchangeCodeForToken(
    state: RemoteMcpStoredServer,
    code: string,
  ): Promise<OAuthTokenState> {
    const response = await this.fetchImpl(state.tokenEndpoint!, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: state.clientId!,
        redirect_uri: state.pendingLogin!.redirectUri,
        code_verifier: state.pendingLogin!.codeVerifier,
        resource: resourceIndicator(state),
      }),
    });
    if (!response.ok) {
      throw new Error(`MCP token exchange failed: ${response.status} ${response.statusText}`);
    }
    return parseTokenResponse(this.now, (await response.json()) as Record<string, unknown>);
  }

  private async ensureFreshToken(state: RemoteMcpStoredServer): Promise<RemoteMcpStoredServer> {
    const token = state.token;
    if (token === null) {
      throw new Error(`MCP server ${state.serverName} is not logged in`);
    }
    if (
      token.expiresAt !== null &&
      token.expiresAt - LOGIN_SKEW_SECONDS <= this.now() &&
      token.refreshToken !== null
    ) {
      const response = await this.fetchImpl(state.tokenEndpoint!, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
          client_id: state.clientId!,
          resource: resourceIndicator(state),
        }),
      });
      if (!response.ok) {
        throw new Error(`MCP token refresh failed: ${response.status} ${response.statusText}`);
      }
      state.token = parseTokenResponse(this.now, (await response.json()) as Record<string, unknown>, token.refreshToken);
      state.sessionId = null;
      await this.stateStore.save(state);
    } else if (token.expiresAt !== null && token.expiresAt - LOGIN_SKEW_SECONDS <= this.now()) {
      throw new Error(`OAuth session for ${state.serverName} expired and cannot be refreshed`);
    }
    return state;
  }

  private async ensureInitialized(state: RemoteMcpStoredServer): Promise<RemoteMcpStoredServer> {
    if (state.sessionId !== null && state.protocolVersion !== null) {
      return state;
    }
    const initialize = await this.sendJsonRpc(state, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: state.clientName,
        version: "0.0.0-dev",
      },
    }, false);

    state.protocolVersion =
      typeof initialize.result === "object" &&
      initialize.result !== null &&
      !Array.isArray(initialize.result) &&
      typeof (initialize.result as Record<string, unknown>).protocolVersion === "string"
        ? ((initialize.result as Record<string, unknown>).protocolVersion as string)
        : MCP_PROTOCOL_VERSION;
    state.sessionId = initialize.sessionId;
    await this.stateStore.save(state);

    await this.sendJsonRpc(state, "notifications/initialized", {}, true);
    return state;
  }

  private async sendJsonRpc(
    state: RemoteMcpStoredServer,
    method: string,
    params: JsonValue,
    notification: boolean = false,
    signal?: AbortSignal,
  ): Promise<{ result: JsonValue; sessionId: string | null }> {
    const requestId = notification ? undefined : crypto.randomUUID();
    const body = notification
      ? { jsonrpc: JSON_RPC_VERSION, method, params }
      : { jsonrpc: JSON_RPC_VERSION, id: requestId, method, params };

    const response = await this.fetchImpl(state.serverUrl, {
      method: "POST",
      headers: this.requestHeaders(state),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`MCP request ${method} failed: ${response.status} ${response.statusText}`);
    }
    const sessionId =
      response.headers.get("mcp-session-id") ??
      response.headers.get("Mcp-Session-Id") ??
      state.sessionId;
    if (notification) {
      return { result: null, sessionId };
    }
    const payload = await parseJsonRpcResponse(response);
    if ("error" in payload) {
      const message =
        payload.error !== null &&
        typeof payload.error === "object" &&
        "message" in payload.error &&
        typeof (payload.error as Record<string, unknown>).message === "string"
          ? ((payload.error as Record<string, unknown>).message as string)
          : `MCP request ${method} failed`;
      throw new Error(message);
    }
    return {
      result: ("result" in payload ? payload.result : null) as JsonValue,
      sessionId,
    };
  }

  private requestHeaders(state: RemoteMcpStoredServer): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...state.staticHeaders,
    };
    if (state.protocolVersion !== null) {
      headers["MCP-Protocol-Version"] = state.protocolVersion;
    }
    if (state.sessionId !== null) {
      headers["Mcp-Session-Id"] = state.sessionId;
    }
    if (state.token?.accessToken) {
      headers.Authorization = `Bearer ${state.token.accessToken}`;
    }
    return headers;
  }

  private async fetchJson<T>(candidateUrls: string[]): Promise<T> {
    let lastError: unknown = null;
    for (const url of candidateUrls) {
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          lastError = new Error(`${response.status} ${response.statusText}`);
          continue;
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("MCP metadata discovery failed");
  }
}

function normalizeServerUrl(serverUrl: string): string {
  const normalized = new URL(serverUrl.trim());
  normalized.hash = "";
  return normalized.toString();
}

function deriveServerNameFromUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const hostSegments = url.hostname
    .split(".")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0 && !["www", "mcp", "api"].includes(segment));
  const filteredHostSegments =
    hostSegments.length > 1 ? hostSegments.filter((segment, index) => index < hostSegments.length - 1) : hostSegments;
  const baseName = filteredHostSegments.join("-") || "remote-mcp";
  return slugifyServerName(baseName);
}

function slugifyServerName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "remote-mcp";
}

function ensureUniqueServerName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (existingNames.has(`${baseName}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}-${suffix}`;
}

export function createRemoteMcpToolExecutor(
  options: RemoteMcpControllerOptions,
): {
  controller: RemoteMcpController;
  toolExecutor: HostToolExecutorAdapter;
} {
  const controller = new RemoteMcpController(options);
  return {
    controller,
    toolExecutor: controller.createToolExecutorAdapter(),
  };
}

export function createInMemoryRemoteMcpStateStore(): RemoteMcpStateStore {
  const records = new Map<string, RemoteMcpStoredServer>();
  return {
    async load(serverName) {
      return records.get(serverName) ?? null;
    },
    async save(record) {
      records.set(record.serverName, structuredClone(record));
    },
    async delete(serverName) {
      records.delete(serverName);
    },
    async list() {
      return [...records.values()].map((record) => structuredClone(record));
    },
  };
}

export function createIndexedDbRemoteMcpStateStore(
  options: IndexedDbRemoteMcpStateStoreOptions = {},
): RemoteMcpStateStore {
  const dbName = options.dbName ?? MCP_DB_NAME;
  const storeName = options.storeName ?? MCP_STORE_NAME;

  return {
    async load(serverName) {
      const db = await openRemoteMcpDb(dbName, storeName);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(serverName);
        request.onsuccess = () =>
          resolve((request.result as RemoteMcpStoredServer | undefined) ?? null);
        request.onerror = () =>
          reject(request.error ?? new Error("failed to load remote MCP state"));
      });
    },
    async save(record) {
      const db = await openRemoteMcpDb(dbName, storeName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const request = tx.objectStore(storeName).put(record, record.serverName);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error("failed to save remote MCP state"));
      });
    },
    async delete(serverName) {
      const db = await openRemoteMcpDb(dbName, storeName);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const request = tx.objectStore(storeName).delete(serverName);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error("failed to delete remote MCP state"));
      });
    },
    async list() {
      const db = await openRemoteMcpDb(dbName, storeName);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () =>
          resolve((request.result as RemoteMcpStoredServer[] | undefined) ?? []);
        request.onerror = () =>
          reject(request.error ?? new Error("failed to list remote MCP state"));
      });
    },
  };
}

export function resolveQualifiedToolName(qualifiedName: string): {
  serverName: string;
  toolName: string;
} {
  if (!qualifiedName.startsWith("mcp__")) {
    throw new Error(`Invalid MCP tool name: ${qualifiedName}`);
  }
  const separatorIndex = qualifiedName.indexOf("__", "mcp__".length);
  if (separatorIndex === -1) {
    throw new Error(`Invalid MCP tool name: ${qualifiedName}`);
  }
  return {
    serverName: qualifiedName.slice("mcp__".length, separatorIndex),
    toolName: qualifiedName.slice(separatorIndex + 2),
  };
}

function buildQualifiedToolName(prefix: string, toolName: string): string {
  return `${prefix}${toolName}`;
}

function buildQualifiedToolNamespace(serverName: string): string {
  return `mcp__${serverName}__`;
}

function normalizeStoredToolSpec(
  defaultServerName: string,
  tool: RemoteMcpToolSpec,
): RemoteMcpToolSpec {
  if (typeof tool.serverName === "string" && tool.serverName.length > 0) {
    return tool;
  }

  let serverName = defaultServerName;
  if (typeof tool.qualifiedName === "string" && tool.qualifiedName.startsWith("mcp__")) {
    try {
      serverName = resolveQualifiedToolName(tool.qualifiedName).serverName;
    } catch {
      serverName = defaultServerName;
    }
  }

  return {
    ...tool,
    serverName,
  };
}

function extractToolSpecs(
  state: RemoteMcpStoredServer,
  response: { result: JsonValue; sessionId: string | null },
): RemoteMcpToolSpec[] {
  state.sessionId = response.sessionId;
  if (
    response.result === null ||
    typeof response.result !== "object" ||
    Array.isArray(response.result)
  ) {
    return [];
  }
  const payload = response.result as Record<string, unknown>;
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  return tools.flatMap((tool) => {
    if (tool === null || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }
    const record = tool as Record<string, unknown>;
    if (typeof record.name !== "string") {
      return [];
    }
    return [
      {
        serverName: state.serverName,
        qualifiedName: buildQualifiedToolName(state.toolPrefix, record.name),
        originalName: record.name,
        description:
          typeof record.description === "string"
            ? record.description
            : `Remote MCP tool ${record.name} from ${state.serverName}`,
        inputSchema:
          record.inputSchema !== undefined
            ? (record.inputSchema as JsonValue)
            : record.parameters !== undefined
              ? (record.parameters as JsonValue)
              : { type: "object", additionalProperties: true },
      },
    ];
  });
}

async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

function parseTokenResponse(
  now: () => number,
  payload: Record<string, unknown>,
  fallbackRefreshToken: string | null = null,
): OAuthTokenState {
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("OAuth token response is missing access_token");
  }
  const expiresIn =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : null;
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : fallbackRefreshToken,
    expiresAt: expiresIn === null ? null : now() + Math.floor(expiresIn),
    scope: typeof payload.scope === "string" ? payload.scope : null,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : null,
  };
}

async function parseJsonRpcResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const payloads = text
      .split("\n\n")
      .map((segment) =>
        segment
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n"),
      )
      .filter((segment) => segment.length > 0 && segment !== "[DONE]");
    for (const payload of payloads) {
      try {
        return JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    throw new Error("MCP server returned an empty SSE response");
  }
  return (await response.json()) as Record<string, unknown>;
}

function candidateProtectedResourceMetadataUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const base = `${url.origin}/.well-known/oauth-protected-resource`;
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  return trimmedPath.length > 0 && trimmedPath !== "/"
    ? [`${base}${trimmedPath}`, base]
    : [base];
}

function candidateAuthorizationServerMetadataUrls(authorizationServer: string): string[] {
  const url = new URL(authorizationServer);
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  const oauthBase = `${url.origin}/.well-known/oauth-authorization-server`;
  const oidcBase = `${url.origin}/.well-known/openid-configuration`;
  const candidates =
    trimmedPath.length > 0 && trimmedPath !== "/"
      ? [`${oauthBase}${trimmedPath}`, oauthBase, `${oidcBase}${trimmedPath}`, oidcBase]
      : [oauthBase, oidcBase];
  return dedupeStrings(candidates);
}

function randomString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (const byte of bytes) {
    encoded += String.fromCharCode(byte);
  }
  return btoa(encoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function ensurePkceS256Supported(state: RemoteMcpStoredServer): void {
  if (
    state.codeChallengeMethodsSupported.length > 0 &&
    !state.codeChallengeMethodsSupported.includes(PKCE_METHOD)
  ) {
    throw new Error(`MCP server ${state.serverName} does not advertise ${PKCE_METHOD} PKCE support`);
  }
}

function resourceIndicator(state: RemoteMcpStoredServer): string {
  return state.oauthResource ?? state.serverUrl;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function openRemoteMcpDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("failed to open remote MCP db"));
  });
}
