import assert from "node:assert/strict";
import test from "node:test";

test("embedded client merges runtime and broker notifications", async () => {
  installBrowserGlobals();
  const { createEmbeddedCodexClientWithDeps } = await import("../src/client.ts");
  const storage = createStorage();
  let runtimeListener: ((notification: { method: string; params: unknown }) => void) | null =
    null;

  const client = createEmbeddedCodexClientWithDeps(
    {
      cwd: "/workspace",
      storage,
      workspace: {
        async readFile() {
          return null;
        },
        async listDir() {
          return null;
        },
        async search() {
          return null;
        },
        async applyPatch() {
          return null;
        },
      },
    },
    {
      async createBrowserCodexRuntimeContext() {
        return {
          runtime: {
            async loadAuthState() {
              return null;
            },
            async saveAuthState() {},
            async clearAuthState() {},
            async listModels() {
              return { data: [], nextCursor: null };
            },
            async threadList() {
              return { data: [], nextCursor: null };
            },
            async threadRead() {
              return {
                thread: {
                  id: "thread-1",
                  preview: "",
                  ephemeral: false,
                  modelProvider: "openai",
                  createdAt: 1,
                  updatedAt: 2,
                  status: { type: "idle" },
                  path: null,
                  cwd: "/workspace",
                  cliVersion: "",
                  source: "unknown",
                  agentNickname: null,
                  agentRole: null,
                  gitInfo: null,
                  name: null,
                  turns: [],
                },
              };
            },
            async threadStart() {
              throw new Error("not implemented");
            },
            async threadResume() {
              throw new Error("not implemented");
            },
            async threadRollback() {
              throw new Error("not implemented");
            },
            async turnStart() {
              throw new Error("not implemented");
            },
            async turnInterrupt() {
              throw new Error("not implemented");
            },
            subscribeToNotifications(listener: (notification: { method: string; params: unknown }) => void) {
              runtimeListener = listener;
              return () => {
                runtimeListener = null;
              };
            },
          },
          async loadConfig() {
            return { model: "" };
          },
          async saveConfig() {},
          subscribe(listener: (notification: { method: string; params: unknown }) => void) {
            runtimeListener = listener;
            return () => {
              runtimeListener = null;
            };
          },
        } as never;
      },
      createLocalStorageWorkspaceAdapter() {
        throw new Error("not used");
      },
      now() {
        return "2026-03-24T00:00:00.000Z";
      },
    },
  );

  const seen: string[] = [];
  const unsubscribe = await client.subscribe((notification) => {
    seen.push(notification.method);
  });

  runtimeListener?.({
    method: "thread/updated",
    params: { threadId: "thread-1" },
  });

  const pendingApproval = client.replyToServerRequest(999, {
    result: { decision: "allow_once" },
  });
  await assert.rejects(pendingApproval);

  unsubscribe();

  assert.deepEqual(seen, ["thread/updated"]);
});

function installBrowserGlobals(): void {
  Object.assign(globalThis, {
    window: {
      location: { href: "https://example.test/" },
      chrome: undefined,
      getSelection() {
        return null;
      },
    },
    document: {
      title: "Test",
      readyState: "complete",
      activeElement: null,
      querySelectorAll() {
        return [];
      },
    },
  });
}

function createStorage() {
  return {
    async loadSession() {
      return null;
    },
    async saveSession() {},
    async deleteSession() {},
    async listSessions() {
      return [];
    },
    async loadAuthState() {
      return null;
    },
    async saveAuthState() {},
    async clearAuthState() {},
    async loadConfig() {
      return { model: "" };
    },
    async saveConfig() {},
    async clearConfig() {},
    async loadUserConfig() {
      return null;
    },
    async saveUserConfig(input: { content: string }) {
      return {
        filePath: "/codex-home/config.toml",
        version: "1",
        content: input.content,
      };
    },
  };
}
