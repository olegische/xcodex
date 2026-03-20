import type {
  StoredThreadSession,
  StoredThreadSessionMetadata,
} from "./types/core.ts";
import { DEFAULT_WORKSPACE_ROOT } from "./workspace.ts";

export const DEFAULT_BROWSER_CODEX_HOME = "/codex-home";
export const DEFAULT_BROWSER_WORKSPACE_ROOT = DEFAULT_WORKSPACE_ROOT;

export function normalizeBrowserUserCwd(_cwd: string | null | undefined): string {
  return DEFAULT_BROWSER_WORKSPACE_ROOT;
}

export function sanitizeStoredThreadSessionMetadata(
  metadata: StoredThreadSessionMetadata,
): StoredThreadSessionMetadata {
  return {
    ...metadata,
    cwd: normalizeBrowserUserCwd(metadata.cwd),
  };
}

export function sanitizeStoredThreadSession(
  session: StoredThreadSession,
): StoredThreadSession {
  return {
    ...session,
    metadata: sanitizeStoredThreadSessionMetadata(session.metadata),
  };
}
