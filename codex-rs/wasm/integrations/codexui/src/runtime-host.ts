import { AppServerClient } from "@browser-codex/wasm-runtime-core/app-server-client";
import type { CreatedRuntime, CodexUiAdapterOptions } from "./types";

export async function createRuntimeAndClient(options: CodexUiAdapterOptions): Promise<{
  createdRuntime: CreatedRuntime;
  client: AppServerClient;
}> {
  await options.runtimeModule.default(options.wasmInput);
  const runtime = new options.runtimeModule.WasmBrowserRuntime(options.host);
  const client = await AppServerClient.start(runtime, options.client);
  return {
    createdRuntime: {
      runtime,
      contractVersion: runtime.contractVersion()
    },
    client
  };
}
