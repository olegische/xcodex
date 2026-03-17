import { createBrowserCodexRuntime, type BrowserCodexRuntime } from "@browser-codex/wasm-browser-codex-runtime";
import type { CreateCodexUiBrowserRuntimeParams } from "./types";

export async function createCodexUiBrowserRuntime<
  TAuthState,
  TConfig,
  TAccount,
  TModelPreset,
  TDispatch,
  TEvent,
  TSnapshot,
  TRefreshAuthResult,
>(
  params: CreateCodexUiBrowserRuntimeParams<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >,
): Promise<
  BrowserCodexRuntime<
    TAuthState,
    TConfig,
    TAccount,
    TModelPreset,
    TDispatch,
    TEvent,
    TSnapshot,
    TRefreshAuthResult
  >
> {
  return await createBrowserCodexRuntime(params);
}
