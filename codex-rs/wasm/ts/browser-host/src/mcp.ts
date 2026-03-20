import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpAuthStatus } from "../../../../app-server-protocol/schema/typescript/v2/McpAuthStatus";
export {
  createRemoteMcpOauthHostHandlers,
  handleRemoteMcpPopupCallback,
  resolveRemoteMcpOauthRedirectUri,
  waitForRemoteMcpOauthCallback,
} from "./mcp-oauth.ts";

export type BrowserRemoteMcpConnectionState = "idle" | "refreshing" | "error";

export type BrowserRemoteMcpTool = {
  toolName: string;
  toolNamespace: string | null;
  tool: Tool;
};

export type BrowserRemoteMcpServer = {
  serverName: string;
  serverUrl: string;
  authStatus: McpAuthStatus;
  connectionState: BrowserRemoteMcpConnectionState;
  scopes: string[];
  tools: BrowserRemoteMcpTool[];
  expiresAt: number | null;
  lastError: string | null;
  clientId: string | null;
};

type BrowserRemoteMcpLoginRequest = {
  serverName: string;
  scopes?: string[] | null;
  timeoutSecs?: number | null;
};

type BrowserRemoteMcpAddServerRequest = {
  serverUrl: string;
  serverName?: string | null;
};

export type BrowserRemoteMcpController = {
  listServers(): Promise<BrowserRemoteMcpServer[]>;
  addServer(input: BrowserRemoteMcpAddServerRequest): Promise<BrowserRemoteMcpServer>;
  removeServer(serverName: string): Promise<void>;
  refreshServerTools(serverName: string): Promise<BrowserRemoteMcpServer>;
  logoutServer(serverName: string): Promise<void>;
  beginLogin(input: BrowserRemoteMcpLoginRequest): Promise<BrowserRemoteMcpServer>;
};

declare global {
  interface Window {
    __codexMcp?: BrowserRemoteMcpController;
  }
}

export async function listRemoteMcpServers(): Promise<BrowserRemoteMcpServer[]> {
  return getRemoteMcpController().listServers();
}

export async function addRemoteMcpServer(input: {
  serverUrl: string;
  serverName?: string | null;
}): Promise<BrowserRemoteMcpServer> {
  return getRemoteMcpController().addServer(input);
}

export async function removeRemoteMcpServer(serverName: string): Promise<void> {
  await getRemoteMcpController().removeServer(serverName);
}

export async function refreshRemoteMcpServer(serverName: string): Promise<BrowserRemoteMcpServer> {
  return getRemoteMcpController().refreshServerTools(serverName);
}

export async function logoutRemoteMcpServer(serverName: string): Promise<void> {
  await getRemoteMcpController().logoutServer(serverName);
}

export async function connectRemoteMcpServer(serverName: string): Promise<BrowserRemoteMcpServer> {
  return await getRemoteMcpController().beginLogin({
    serverName,
  });
}

export function getRemoteMcpToolName(tool: BrowserRemoteMcpTool): string {
  return tool.toolNamespace === null ? tool.toolName : `${tool.toolNamespace}__${tool.toolName}`;
}

export function getRemoteMcpAuthStatusLabel(authStatus: McpAuthStatus): string {
  switch (authStatus) {
    case "unsupported":
      return "Unsupported";
    case "notLoggedIn":
      return "Not logged in";
    case "bearerToken":
      return "Bearer token";
    case "oAuth":
      return "OAuth";
  }
}

export function isRemoteMcpAuthenticated(server: BrowserRemoteMcpServer): boolean {
  return server.authStatus === "oAuth" || server.authStatus === "bearerToken";
}

export function isRemoteMcpUnsupported(server: BrowserRemoteMcpServer): boolean {
  return server.authStatus === "unsupported";
}

export function installRemoteMcpController(controller: BrowserRemoteMcpController | null): void {
  if (controller === null) {
    delete window.__codexMcp;
    return;
  }
  window.__codexMcp = controller;
}

function getRemoteMcpController(): BrowserRemoteMcpController {
  const controller = window.__codexMcp;
  if (controller === undefined) {
    throw new Error("Remote MCP controller is not ready yet");
  }
  return controller;
}
