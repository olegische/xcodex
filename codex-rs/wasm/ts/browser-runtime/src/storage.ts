import { createIndexedDbRuntimeStorage } from "../../runtime-client/src/indexeddb.ts";
import type {
  BrowserRuntimeStorage,
  CreateIndexedDbCodexStorageOptions,
} from "./types/runtime";

export function createIndexedDbCodexStorage<
  TAuthState,
  TConfig,
  TSession,
  TSessionMetadata,
>(
  options: CreateIndexedDbCodexStorageOptions<
    TAuthState,
    TConfig,
    TSession,
    TSessionMetadata
  >,
): BrowserRuntimeStorage<TAuthState, TConfig, TSession, TSessionMetadata> {
  return createIndexedDbRuntimeStorage(options);
}
