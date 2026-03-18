export function handleRemoteMcpPopupCallback(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("mcp_callback") !== "1") {
    return false;
  }
  if (window.opener === null) {
    return false;
  }

  const serverName = url.searchParams.get("mcp_server");
  if (serverName === null || serverName.length === 0) {
    return false;
  }

  window.opener.postMessage(
    {
      type: REMOTE_MCP_CALLBACK_TYPE,
      serverName,
      callbackUrl: url.toString(),
    } satisfies RemoteMcpCallbackMessage,
    window.location.origin,
  );

  document.title = `WASM Codex | ${serverName} MCP Login`;
  if (document.body !== null) {
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;background:#060816;color:#d7e3ff;font:16px/1.5 'IBM Plex Sans',sans-serif;padding:24px;">
        <section style="max-width:32rem;padding:24px 28px;border:1px solid rgba(95,223,255,.22);border-radius:20px;background:rgba(10,18,36,.88);box-shadow:0 24px 80px rgba(0,0,0,.45);">
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#5fdfff;">Remote MCP</div>
          <h1 style="margin:12px 0 0;font-size:32px;line-height:1.05;">Login captured</h1>
          <p style="margin:12px 0 0;color:#96a5c6;">The authorization result was sent back to WASM Codex. This window can close now.</p>
        </section>
      </main>
    `;
  }
  window.setTimeout(() => window.close(), 120);
  return true;
}

export async function resolveRemoteMcpOauthRedirectUri(input: {
  serverName: string;
}): Promise<{ redirectUri: string }> {
  return {
    redirectUri: buildRemoteMcpRedirectUri(input.serverName),
  };
}

export async function waitForRemoteMcpOauthCallback(input: {
  serverName: string;
  authorizationUrl: string;
  timeoutSecs?: number | null;
}): Promise<{
  code: string;
  state: string;
}> {
  const loginTab = window.open(input.authorizationUrl, "_blank");
  if (loginTab === null) {
    throw new Error("Browser blocked the MCP login tab");
  }
  loginTab.focus();

  const callbackUrl = await waitForRemoteMcpCallbackUrl({
    popup: loginTab,
    serverName: input.serverName,
    timeoutMs: Math.max(1, input.timeoutSecs ?? 120) * 1000,
  });
  return parseRemoteMcpCallbackUrl(callbackUrl, input.serverName);
}

export function createRemoteMcpOauthHostHandlers(): Pick<
  NonNullable<import("@browser-codex/wasm-runtime-core/types").BrowserRuntimeHost>,
  "resolveMcpOauthRedirectUri" | "waitForMcpOauthCallback" | "loadMcpOauthSession"
> {
  return {
    async resolveMcpOauthRedirectUri(request: unknown) {
      const serverName =
        request !== null &&
        typeof request === "object" &&
        !Array.isArray(request) &&
        typeof (request as { serverName?: unknown }).serverName === "string"
          ? (request as { serverName: string }).serverName
          : "";
      return await resolveRemoteMcpOauthRedirectUri({ serverName });
    },
    async waitForMcpOauthCallback(request: unknown) {
      const payload =
        request !== null && typeof request === "object" && !Array.isArray(request)
          ? (request as {
              serverName?: unknown;
              authorizationUrl?: unknown;
              timeoutSecs?: unknown;
            })
          : {};
      return await waitForRemoteMcpOauthCallback({
        serverName: typeof payload.serverName === "string" ? payload.serverName : "",
        authorizationUrl:
          typeof payload.authorizationUrl === "string" ? payload.authorizationUrl : "",
        timeoutSecs: typeof payload.timeoutSecs === "number" ? payload.timeoutSecs : null,
      });
    },
    async loadMcpOauthSession(request: unknown) {
      const serverName =
        request !== null &&
        typeof request === "object" &&
        !Array.isArray(request) &&
        typeof (request as { serverName?: unknown }).serverName === "string"
          ? (request as { serverName: string }).serverName
          : "";
      const session = await readRemoteMcpOauthSession(serverName);
      return session;
    },
  };
}

type RemoteMcpCallbackMessage = {
  type: "codex:mcp-callback";
  serverName: string;
  callbackUrl: string;
};

const REMOTE_MCP_CALLBACK_TYPE = "codex:mcp-callback";

function buildRemoteMcpRedirectUri(serverName: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mcp_callback", "1");
  url.searchParams.set("mcp_server", serverName);
  return url.toString();
}

function buildRemoteMcpAuthorizationUrl(input: {
  authorizationServer: BrowserAuthorizationServerMetadata;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes: string[];
  oauthResource: string | null;
}): string {
  const url = new URL(input.authorizationServer.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  if (input.scopes.length > 0) {
    url.searchParams.set("scope", input.scopes.join(" "));
  }
  if (input.oauthResource !== null && input.oauthResource.trim().length > 0) {
    url.searchParams.set("resource", input.oauthResource.trim());
  }
  return url.toString();
}

async function discoverBrowserAuthorizationServer(
  serverUrl: string,
): Promise<BrowserAuthorizationServerMetadata> {
  const cached = discoveredAuthorizationServers.get(serverUrl);
  if (cached !== undefined) {
    return cached;
  }
  const baseUrl = new URL(serverUrl);
  for (const pathname of discoveryPaths(baseUrl.pathname)) {
    const discoveryUrl = new URL(baseUrl.toString());
    discoveryUrl.pathname = pathname;
    discoveryUrl.search = "";
    const response = await fetch(discoveryUrl.toString(), {
      method: "GET",
      headers: {
        "MCP-Protocol-Version": "2024-11-05",
      },
    }).catch(() => null);
    if (response === null || !response.ok) {
      continue;
    }
    const metadata = (await response.json()) as Partial<BrowserAuthorizationServerMetadata>;
    if (
      typeof metadata.authorization_endpoint === "string" &&
      typeof metadata.token_endpoint === "string"
    ) {
      const discovered = {
        issuer: metadata.issuer,
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        registration_endpoint:
          typeof metadata.registration_endpoint === "string"
            ? metadata.registration_endpoint
            : undefined,
      };
      discoveredAuthorizationServers.set(serverUrl, discovered);
      return discovered;
    }
  }
  throw new Error(`OAuth discovery failed for MCP server ${serverUrl}`);
}

async function resolveBrowserRemoteMcpClientId(input: {
  authorizationServer: BrowserAuthorizationServerMetadata;
  preferredClientId: string | null;
  redirectUri: string;
}): Promise<string> {
  if (input.preferredClientId !== null && input.preferredClientId.trim().length > 0) {
    return input.preferredClientId.trim();
  }
  if (
    input.authorizationServer.registration_endpoint === undefined ||
    input.authorizationServer.registration_endpoint.length === 0
  ) {
    throw new Error("MCP OAuth server did not expose registration_endpoint and no client_id is configured");
  }

  const response = await fetch(input.authorizationServer.registration_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_name: "Codex Browser",
      application_type: "web",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      redirect_uris: [input.redirectUri],
    }),
  });
  if (!response.ok) {
    throw new Error(`Dynamic client registration failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { client_id?: unknown };
  if (typeof payload.client_id !== "string" || payload.client_id.trim().length === 0) {
    throw new Error("Dynamic client registration response did not include client_id");
  }
  return payload.client_id.trim();
}

function discoveryPaths(basePath: string): string[] {
  const trimmed = basePath.replace(/^\/+|\/+$/g, "");
  const canonical = "/.well-known/oauth-authorization-server";
  if (trimmed.length === 0) {
    return [canonical];
  }
  const candidates = [
    canonical,
    `${canonical}/${trimmed}`,
    `/${trimmed}/.well-known/oauth-authorization-server`,
  ];
  return [...new Set(candidates)];
}

function asOauthAuthorizationServer(
  authorizationServer: BrowserAuthorizationServerMetadata,
): {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer?: string;
  registration_endpoint?: string;
} {
  return {
    authorization_endpoint: authorizationServer.authorization_endpoint,
    token_endpoint: authorizationServer.token_endpoint,
    ...(authorizationServer.issuer === undefined ? {} : { issuer: authorizationServer.issuer }),
    ...(authorizationServer.registration_endpoint === undefined
      ? {}
      : { registration_endpoint: authorizationServer.registration_endpoint }),
  };
}

function waitForRemoteMcpCallbackUrl(input: {
  popup: Window;
  serverName: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const closedWatcher = window.setInterval(() => {
      if (!input.popup.closed) {
        return;
      }
      cleanup();
      reject(new Error(`MCP login tab closed before ${input.serverName} completed authorization`));
    }, 300);

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out while waiting for ${input.serverName} MCP login`));
    }, input.timeoutMs);

    const onMessage = (event: MessageEvent<RemoteMcpCallbackMessage>) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const payload = event.data;
      if (
        payload === null ||
        typeof payload !== "object" ||
        payload.type !== REMOTE_MCP_CALLBACK_TYPE ||
        payload.serverName !== input.serverName
      ) {
        return;
      }
      cleanup();
      resolve(payload.callbackUrl);
    };

    function cleanup() {
      window.clearInterval(closedWatcher);
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
  });
}

function parseRemoteMcpCallbackUrl(
  callbackUrl: string,
  serverName: string,
): {
  code: string;
  state: string;
} {
  const url = new URL(callbackUrl);
  const errorDescription = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (errorDescription !== null) {
    throw new Error(`MCP login failed for ${serverName}: ${errorDescription}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || state === null) {
    throw new Error(`MCP login callback for ${serverName} did not include code/state`);
  }

  return { code, state };
}
import * as oauth from "oauth4webapi";

export type BrowserRemoteMcpOauthSession = {
  serverName: string;
  serverUrl: string;
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string[];
  expiresAt: number | null;
};

type BrowserAuthorizationServerMetadata = {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

type RemoteMcpOauthSessionPersistence = {
  load(serverName: string): Promise<BrowserRemoteMcpOauthSession | null>;
  save(session: BrowserRemoteMcpOauthSession): Promise<void>;
  clear(serverName: string): Promise<void>;
};

const remoteMcpOauthSessions = new Map<string, BrowserRemoteMcpOauthSession>();
const discoveredAuthorizationServers = new Map<string, BrowserAuthorizationServerMetadata>();
let remoteMcpOauthSessionPersistence: RemoteMcpOauthSessionPersistence | null = null;

export function configureRemoteMcpOauthSessionPersistence(
  persistence: RemoteMcpOauthSessionPersistence | null,
): void {
  remoteMcpOauthSessionPersistence = persistence;
}

export async function readRemoteMcpOauthSession(
  serverName: string,
): Promise<BrowserRemoteMcpOauthSession | null> {
  const cached = remoteMcpOauthSessions.get(serverName);
  if (cached !== undefined) {
    console.info("[remote-mcp-oauth] read session from memory", {
      serverName,
      hasAccessToken: cached.accessToken.trim().length > 0,
      tokenType: cached.tokenType,
      expiresAt: cached.expiresAt,
    });
    return cached;
  }
  if (remoteMcpOauthSessionPersistence === null) {
    console.info("[remote-mcp-oauth] no persistence configured", { serverName });
    return null;
  }
  const persisted = await remoteMcpOauthSessionPersistence.load(serverName);
  if (persisted !== null) {
    remoteMcpOauthSessions.set(serverName, persisted);
    console.info("[remote-mcp-oauth] read session from persistence", {
      serverName,
      hasAccessToken: persisted.accessToken.trim().length > 0,
      tokenType: persisted.tokenType,
      expiresAt: persisted.expiresAt,
    });
  } else {
    console.info("[remote-mcp-oauth] no persisted session found", { serverName });
  }
  return persisted;
}

export async function clearRemoteMcpOauthSession(serverName: string): Promise<void> {
  remoteMcpOauthSessions.delete(serverName);
  await remoteMcpOauthSessionPersistence?.clear(serverName);
  console.info("[remote-mcp-oauth] cleared session", { serverName });
}

export async function beginRemoteMcpOauthSession(input: {
  serverName: string;
  serverUrl: string;
  scopes?: string[] | null;
  clientId?: string | null;
  oauthResource?: string | null;
  timeoutSecs?: number | null;
}): Promise<BrowserRemoteMcpOauthSession> {
  const redirectUri = (await resolveRemoteMcpOauthRedirectUri({
    serverName: input.serverName,
  })).redirectUri;
  const authorizationServer = await discoverBrowserAuthorizationServer(
    input.serverUrl,
  );
  const clientId = await resolveBrowserRemoteMcpClientId({
    authorizationServer,
    preferredClientId: input.clientId ?? null,
    redirectUri,
  });
  const client: oauth.Client = {
    client_id: clientId,
    token_endpoint_auth_method: "none",
  };

  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();
  const authorizationUrl = buildRemoteMcpAuthorizationUrl({
    authorizationServer,
    clientId,
    redirectUri,
    codeChallenge,
    state,
    scopes: input.scopes ?? [],
    oauthResource: input.oauthResource ?? null,
  });

  const callback = await waitForRemoteMcpOauthCallback({
    serverName: input.serverName,
    authorizationUrl,
    timeoutSecs: input.timeoutSecs ?? null,
  });
  const oauthAuthorizationServer = asOauthAuthorizationServer(
    authorizationServer,
  ) as oauth.AuthorizationServer;
  const callbackParameters = oauth.validateAuthResponse(
    oauthAuthorizationServer,
    client,
    new URLSearchParams({
      code: callback.code,
      state: callback.state,
    }),
    state,
  );
  const tokenResponse = await oauth.processAuthorizationCodeResponse(
    oauthAuthorizationServer,
    client,
    await oauth.authorizationCodeGrantRequest(
      oauthAuthorizationServer,
      client,
      oauth.None(),
      callbackParameters,
      redirectUri,
      codeVerifier,
    ),
  );

  const session: BrowserRemoteMcpOauthSession = {
    serverName: input.serverName,
    serverUrl: input.serverUrl,
    clientId,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token ?? null,
    tokenType:
      typeof tokenResponse.token_type === "string"
        ? tokenResponse.token_type
        : null,
    scope:
      typeof tokenResponse.scope === "string"
        ? tokenResponse.scope.split(/\s+/).filter((value) => value.length > 0)
        : [...(input.scopes ?? [])],
    expiresAt:
      typeof tokenResponse.expires_in === "number"
        ? Date.now() + tokenResponse.expires_in * 1000
        : null,
  };
  remoteMcpOauthSessions.set(input.serverName, session);
  await remoteMcpOauthSessionPersistence?.save(session);
  console.info("[remote-mcp-oauth] saved session", {
    serverName: input.serverName,
    tokenType: session.tokenType,
    hasAccessToken: session.accessToken.trim().length > 0,
    expiresAt: session.expiresAt,
    scopeCount: session.scope.length,
  });
  return session;
}
