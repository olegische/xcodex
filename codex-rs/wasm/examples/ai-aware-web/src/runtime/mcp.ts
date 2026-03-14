import type { RemoteMcpController, RemoteMcpServerState } from "../../../../ts/host-runtime/src/mcp";

declare global {
  interface Window {
    __aiAwareMcp?: RemoteMcpController;
  }
}

type RemoteMcpCallbackMessage = {
  type: "ai-aware:mcp-callback";
  serverName: string;
  callbackUrl: string;
};

const REMOTE_MCP_CALLBACK_TYPE = "ai-aware:mcp-callback";

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

  document.title = `AI-Aware Web | ${serverName} MCP Login`;
  if (document.body !== null) {
    document.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;background:#060816;color:#d7e3ff;font:16px/1.5 'IBM Plex Sans',sans-serif;padding:24px;">
        <section style="max-width:32rem;padding:24px 28px;border:1px solid rgba(95,223,255,.22);border-radius:20px;background:rgba(10,18,36,.88);box-shadow:0 24px 80px rgba(0,0,0,.45);">
          <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#5fdfff;">Remote MCP</div>
          <h1 style="margin:12px 0 0;font-size:32px;line-height:1.05;">Login captured</h1>
          <p style="margin:12px 0 0;color:#96a5c6;">The authorization result was sent back to AI-Aware Web. This window can close now.</p>
        </section>
      </main>
    `;
  }
  window.setTimeout(() => window.close(), 120);
  return true;
}

export async function listRemoteMcpServers(): Promise<RemoteMcpServerState[]> {
  return getRemoteMcpController().listServers();
}

export async function refreshRemoteMcpServer(serverName: string): Promise<RemoteMcpServerState> {
  return getRemoteMcpController().refreshServerTools(serverName);
}

export async function logoutRemoteMcpServer(serverName: string): Promise<void> {
  await getRemoteMcpController().logoutServer(serverName);
}

export async function connectRemoteMcpServer(serverName: string): Promise<RemoteMcpServerState> {
  const controller = getRemoteMcpController();
  const redirectUri = buildRemoteMcpRedirectUri(serverName);
  const login = await controller.beginLogin({
    serverName,
    redirectUri,
  });
  const loginTab = window.open(login.authorizationUrl, "_blank");
  if (loginTab === null) {
    throw new Error("Browser blocked the MCP login tab");
  }
  loginTab.focus();

  const callbackUrl = await waitForRemoteMcpCallback({
    popup: loginTab,
    serverName,
  });
  return controller.completeLogin({
    serverName,
    callbackUrl,
  });
}

function getRemoteMcpController(): RemoteMcpController {
  const controller = window.__aiAwareMcp;
  if (controller === undefined) {
    throw new Error("Remote MCP controller is not ready yet");
  }
  return controller;
}

function buildRemoteMcpRedirectUri(serverName: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("mcp_callback", "1");
  url.searchParams.set("mcp_server", serverName);
  return url.toString();
}

function waitForRemoteMcpCallback(input: {
  popup: Window;
  serverName: string;
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
    }, 120_000);

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
