import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@browser-codex/wasm-browser-tools": fileURLToPath(
        new URL("../../ts/browser-tools/src", import.meta.url),
      ),
      "@browser-codex/wasm-model-transport": fileURLToPath(
        new URL("../../ts/model-transport/src", import.meta.url),
      ),
      "@browser-codex/wasm-runtime-core": fileURLToPath(
        new URL("../../ts/runtime-core/src", import.meta.url),
      ),
      "xcodex-runtime": fileURLToPath(
        new URL("../../ts/browser-runtime/src", import.meta.url),
      ),
      "xcodex-embedded-client": fileURLToPath(
        new URL("../../ts/embedded-client/src", import.meta.url),
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
