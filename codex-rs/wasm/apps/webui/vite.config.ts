import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@browser-codex/wasm-browser-codex-runtime": fileURLToPath(
        new URL("../../ts/browser-codex-runtime/src", import.meta.url),
      ),
      "@browser-codex/wasm-browser-host": fileURLToPath(
        new URL("../../ts/browser-host/src", import.meta.url),
      ),
      "@browser-codex/wasm-browser-tools": fileURLToPath(
        new URL("../../ts/browser-tools/src", import.meta.url),
      ),
      "@browser-codex/wasm-runtime-core": fileURLToPath(
        new URL("../../ts/runtime-core/src", import.meta.url),
      ),
      "@browser-codex/wasm-model-transport": fileURLToPath(
        new URL("../../ts/model-transport/src", import.meta.url),
      ),
    },
  },
  server: {
    port: 4181,
  },
  preview: {
    port: 4181,
  },
});
