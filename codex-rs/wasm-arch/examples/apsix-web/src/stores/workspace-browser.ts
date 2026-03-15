import { get, writable } from "svelte/store";
import { loadWorkspaceDebugSnapshot } from "../runtime/workspace";
import type { WorkspaceFileSummary } from "../types";

type WorkspaceBrowserState = {
  files: WorkspaceFileSummary[];
};

const initialState: WorkspaceBrowserState = {
  files: [],
};

function createWorkspaceBrowserStore() {
  const { subscribe, set } = writable<WorkspaceBrowserState>(initialState);

  async function refresh() {
    const files = await loadWorkspaceDebugSnapshot();
    set({
      files: files.map((file) => ({
        path: file.path,
        bytes: file.bytes,
        preview: file.preview,
        content: file.content,
      })),
    });
  }

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    async initialize() {
      await refresh();
      const handleWorkspaceChange = () => {
        void refresh();
      };
      window.addEventListener("codex:workspace-changed", handleWorkspaceChange);
      return () => {
        window.removeEventListener("codex:workspace-changed", handleWorkspaceChange);
      };
    },
  };
}

export const workspaceBrowserStore = createWorkspaceBrowserStore();
