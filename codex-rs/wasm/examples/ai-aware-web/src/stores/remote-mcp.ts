import { get, writable } from "svelte/store";
import type { RemoteMcpServerState } from "../../../../ts/host-runtime/src/mcp";
import { saveRemoteMcpServersSnapshot } from "../aiAware/workspace";
import {
  addRemoteMcpServer,
  connectRemoteMcpServer,
  listRemoteMcpServers,
  logoutRemoteMcpServer,
  refreshRemoteMcpServer,
  removeRemoteMcpServer,
} from "../runtime/mcp";

type RemoteMcpStoreState = {
  servers: RemoteMcpServerState[];
  loading: boolean;
  actionServer: string | null;
  error: string | null;
};

const initialState: RemoteMcpStoreState = {
  servers: [],
  loading: true,
  actionServer: null,
  error: null,
};

function createRemoteMcpStore() {
  const { subscribe, set, update } = writable<RemoteMcpStoreState>(initialState);
  let subscriberCount = 0;
  let poller: number | null = null;

  async function syncServers() {
    update((state) => ({
      ...state,
      loading: true,
      error: null,
    }));
    try {
      const servers = await listRemoteMcpServers();
      await saveRemoteMcpServersSnapshot(servers);
      set({
        servers,
        loading: false,
        actionServer: null,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load remote MCP servers";
      update((state) => ({
        ...state,
        loading: message === "Remote MCP controller is not ready yet",
        error: message === "Remote MCP controller is not ready yet" ? null : message,
      }));
    }
  }

  function startPolling() {
    if (poller !== null) {
      return;
    }
    void syncServers();
    poller = window.setInterval(() => {
      void syncServers();
    }, 15_000);
  }

  function stopPolling() {
    if (poller === null) {
      return;
    }
    window.clearInterval(poller);
    poller = null;
  }

  return {
    subscribe(run: (value: RemoteMcpStoreState) => void) {
      subscriberCount += 1;
      if (subscriberCount === 1) {
        startPolling();
      }
      const unsubscribe = subscribe(run);
      return () => {
        unsubscribe();
        subscriberCount -= 1;
        if (subscriberCount === 0) {
          stopPolling();
        }
      };
    },
    snapshot() {
      return get({ subscribe });
    },
    async refresh() {
      await syncServers();
    },
    async connect(serverName: string) {
      update((state) => ({
        ...state,
        actionServer: serverName,
        error: null,
      }));
      try {
        await connectRemoteMcpServer(serverName);
        await syncServers();
      } catch (error) {
        update((state) => ({
          ...state,
          actionServer: null,
          error: error instanceof Error ? error.message : `Failed to connect ${serverName}`,
        }));
      }
    },
    async refreshServer(serverName: string) {
      update((state) => ({
        ...state,
        actionServer: serverName,
        error: null,
      }));
      try {
        await refreshRemoteMcpServer(serverName);
        await syncServers();
      } catch (error) {
        update((state) => ({
          ...state,
          actionServer: null,
          error: error instanceof Error ? error.message : `Failed to refresh ${serverName}`,
        }));
      }
    },
    async disconnect(serverName: string) {
      update((state) => ({
        ...state,
        actionServer: serverName,
        error: null,
      }));
      try {
        await logoutRemoteMcpServer(serverName);
        await syncServers();
      } catch (error) {
        update((state) => ({
          ...state,
          actionServer: null,
          error: error instanceof Error ? error.message : `Failed to disconnect ${serverName}`,
        }));
      }
    },
    async addServer(serverUrl: string) {
      update((state) => ({
        ...state,
        actionServer: "__add__",
        error: null,
      }));
      try {
        await addRemoteMcpServer({ serverUrl });
        await syncServers();
      } catch (error) {
        update((state) => ({
          ...state,
          actionServer: null,
          error: error instanceof Error ? error.message : `Failed to add MCP server ${serverUrl}`,
        }));
      }
    },
    async removeServer(serverName: string) {
      update((state) => ({
        ...state,
        actionServer: serverName,
        error: null,
      }));
      try {
        await removeRemoteMcpServer(serverName);
        await syncServers();
      } catch (error) {
        update((state) => ({
          ...state,
          actionServer: null,
          error: error instanceof Error ? error.message : `Failed to remove ${serverName}`,
        }));
      }
    },
  };
}

export const remoteMcpStore = createRemoteMcpStore();
