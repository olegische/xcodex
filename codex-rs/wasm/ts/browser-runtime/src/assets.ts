import type { XrouterRuntimeModule } from "@browser-codex/wasm-model-transport";
import type { RuntimeModule } from "@browser-codex/wasm-runtime-core/types";
import { BUILD_MANIFEST_PATH, XROUTER_MANIFEST_PATH } from "./config.ts";

type LoadableXrouterRuntimeModule = XrouterRuntimeModule & {
  default(
    input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
  ): Promise<void>;
};

let xrouterModulePromise: Promise<XrouterRuntimeModule> | null = null;

export async function loadBuildManifest(
  path: string = BUILD_MANIFEST_PATH,
  label: string = "pkg",
): Promise<{ buildId: string; entry: string; wasm: string }> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} manifest was not found (${response.status})`);
  }
  const manifest = (await response.json()) as Record<string, unknown>;
  if (
    typeof manifest.buildId !== "string" ||
    typeof manifest.entry !== "string" ||
    typeof manifest.wasm !== "string"
  ) {
    throw new Error(`${label} manifest is invalid`);
  }
  return {
    buildId: manifest.buildId,
    entry: manifest.entry,
    wasm: manifest.wasm,
  };
}

export function toBrowserModuleUrl(path: string, buildId?: string): string {
  if (/^https?:\/\//.test(path)) {
    return appendVersionParam(path, buildId);
  }
  return appendVersionParam(new URL(path, window.location.origin).toString(), buildId);
}

export function toBrowserAssetUrl(path: string, buildId?: string): string {
  if (/^https?:\/\//.test(path)) {
    return appendVersionParam(path, buildId);
  }
  return appendVersionParam(new URL(path, window.location.origin).toString(), buildId);
}

export async function loadRuntimeModule(): Promise<RuntimeModule> {
  const manifest = await loadBuildManifest();
  const wasm = (await import(
    /* @vite-ignore */ toBrowserModuleUrl(manifest.entry, manifest.buildId)
  )) as RuntimeModule;
  await wasm.default({
    module_or_path: toBrowserAssetUrl(manifest.wasm, manifest.buildId),
  });
  return wasm;
}

export async function loadXrouterRuntime(): Promise<XrouterRuntimeModule> {
  const existing = xrouterModulePromise;
  if (existing !== null) {
    return existing;
  }
  const promise = loadXrouterRuntimeInner();
  xrouterModulePromise = promise;
  return promise;
}

function appendVersionParam(url: string, buildId?: string): string {
  if (buildId === undefined || buildId.length === 0) {
    return url;
  }
  const resolved = new URL(url, window.location.origin);
  resolved.searchParams.set("v", buildId);
  return resolved.toString();
}

async function loadXrouterRuntimeInner(): Promise<XrouterRuntimeModule> {
  const manifest = await loadBuildManifest(
    XROUTER_MANIFEST_PATH,
    "xrouter-browser pkg",
  );
  const entryUrl = toBrowserModuleUrl(manifest.entry, manifest.buildId);
  const wasmUrl = toBrowserAssetUrl(manifest.wasm, manifest.buildId);
  const wasm = (await import(/* @vite-ignore */ entryUrl)) as LoadableXrouterRuntimeModule;
  await wasm.default({ module_or_path: wasmUrl });
  return wasm;
}
