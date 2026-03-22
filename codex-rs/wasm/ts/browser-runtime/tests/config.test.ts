import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CODEX_CONFIG,
  DEFAULT_RUNTIME_MODE,
  DEEPSEEK_API_BASE_URL,
  OPENAI_API_BASE_URL,
  createProviderConfig,
  materializeCodexConfig,
  normalizeCodexConfig,
} from "../src/config.ts";
import { validateBrowserTransportProvider } from "../src/transport.ts";

test("normalizeCodexConfig backfills runtime_mode for legacy config", () => {
  const normalized = normalizeCodexConfig({
    ...DEFAULT_CODEX_CONFIG,
    runtime_mode: undefined,
  });

  assert.equal(normalized.runtime_mode, DEFAULT_RUNTIME_MODE);
});

test("normalizeCodexConfig preserves trimmed runtime_architecture as client metadata", () => {
  const normalized = normalizeCodexConfig({
    ...DEFAULT_CODEX_CONFIG,
    runtime_architecture: "  wasm-client  ",
  });

  assert.equal(normalized.runtime_mode, DEFAULT_RUNTIME_MODE);
  assert.equal(normalized.runtime_architecture, "wasm-client");
});

test("materializeCodexConfig persists runtime metadata alongside provider config", () => {
  const config = materializeCodexConfig({
    transportMode: "xrouter-browser",
    model: "gpt-5",
    runtimeMode: "demo",
    runtimeArchitecture: "web-preview",
    modelReasoningEffort: "medium",
    personality: "pragmatic",
    displayName: "DeepSeek via Browser Runtime",
    baseUrl: DEEPSEEK_API_BASE_URL,
    apiKey: "secret",
    xrouterProvider: "deepseek",
  });

  assert.equal(config.runtime_mode, "demo");
  assert.equal(config.runtime_architecture, "web-preview");
  assert.equal(config.modelProviders[config.modelProvider]?.baseUrl, DEEPSEEK_API_BASE_URL);
});

test("validateBrowserTransportProvider normalizes allowed built-in provider URLs", () => {
  const provider = createProviderConfig(
    "openai",
    "OpenAI",
    `${OPENAI_API_BASE_URL}/`,
    "openai",
  );

  const validated = validateBrowserTransportProvider(provider);
  assert.equal(validated.baseUrl, OPENAI_API_BASE_URL);
});

test("validateBrowserTransportProvider rejects non-allowlisted openai URLs", () => {
  assert.throws(
    () =>
      validateBrowserTransportProvider({
        name: "OpenAI",
        baseUrl: "https://evil.example/v1",
        envKey: "OPENAI_API_KEY",
        providerKind: "openai",
        wireApi: "responses",
        metadata: null,
      }),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { code?: string }).code, "invalid_provider_base_url");
      return true;
    },
  );
});

test("validateBrowserTransportProvider allows openai-compatible custom URLs", () => {
  const validated = validateBrowserTransportProvider({
    name: "OpenAI-Compatible",
    baseUrl: " https://router.example.test/custom/v1/ ",
    envKey: "OPENAI_COMPATIBLE_API_KEY",
    providerKind: "openai_compatible",
    wireApi: "responses",
    metadata: null,
  });

  assert.equal(validated.baseUrl, "https://router.example.test/custom/v1");
});
