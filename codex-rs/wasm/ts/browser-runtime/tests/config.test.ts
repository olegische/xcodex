import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BROWSER_SECURITY_CONFIG,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_RUNTIME_MODE,
  DEEPSEEK_API_BASE_URL,
  OPENAI_API_BASE_URL,
  createProviderConfig,
  materializeCodexConfig,
  normalizeBrowserSecurityConfig,
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

test("normalizeCodexConfig normalizes browser_security origins and defaults", () => {
  const normalized = normalizeCodexConfig({
    ...DEFAULT_CODEX_CONFIG,
    browser_security: {
      allowed_origins: [
        " https://example.com/path ",
        "https://example.com",
        "http://localhost:3000",
        "javascript:alert(1)",
      ],
      allow_localhost: true,
      allow_private_network: null,
    },
  });

  assert.deepEqual(normalized.browser_security, {
    allowed_origins: ["https://example.com", "http://localhost:3000"],
    allow_localhost: true,
    allow_private_network: false,
  });
});

test("materializeCodexConfig persists runtime metadata alongside provider config", () => {
  const config = materializeCodexConfig({
    transportMode: "xrouter-browser",
    model: "gpt-5",
    runtimeMode: "demo",
    runtimeArchitecture: "web-preview",
    browserSecurity: {
      allowed_origins: ["https://example.com"],
      allow_localhost: false,
      allow_private_network: false,
    },
    modelReasoningEffort: "medium",
    personality: "pragmatic",
    displayName: "DeepSeek via Browser Runtime",
    baseUrl: DEEPSEEK_API_BASE_URL,
    apiKey: "secret",
    xrouterProvider: "deepseek",
  });

  assert.equal(config.runtime_mode, "demo");
  assert.equal(config.runtime_architecture, "web-preview");
  assert.deepEqual(config.browser_security, {
    allowed_origins: ["https://example.com"],
    allow_localhost: false,
    allow_private_network: false,
  });
  assert.equal(config.modelProviders[config.modelProvider]?.baseUrl, DEEPSEEK_API_BASE_URL);
});

test("normalizeBrowserSecurityConfig backfills strict defaults", () => {
  assert.deepEqual(
    normalizeBrowserSecurityConfig(undefined),
    DEFAULT_BROWSER_SECURITY_CONFIG,
  );
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

test("validateBrowserTransportProvider rejects non-https openai-compatible URLs", () => {
  assert.throws(
    () =>
      validateBrowserTransportProvider({
        name: "OpenAI-Compatible",
        baseUrl: "http://router.example.test/v1",
        envKey: "OPENAI_COMPATIBLE_API_KEY",
        providerKind: "openai_compatible",
        wireApi: "responses",
        metadata: null,
      }),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { code?: string }).code, "invalid_provider_base_url");
      assert.equal(
        (error as { data?: { reason?: string } }).data?.reason,
        "insecure_protocol",
      );
      return true;
    },
  );
});

test("validateBrowserTransportProvider rejects localhost openai-compatible URLs by default", () => {
  assert.throws(
    () =>
      validateBrowserTransportProvider(
        {
          name: "OpenAI-Compatible",
          baseUrl: "https://localhost:11434/v1",
          envKey: "OPENAI_COMPATIBLE_API_KEY",
          providerKind: "openai_compatible",
          wireApi: "responses",
          metadata: null,
        },
        {
          allowed_origins: [],
          allow_localhost: false,
          allow_private_network: false,
        },
      ),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { code?: string }).code, "invalid_provider_base_url");
      assert.equal(
        (error as { data?: { reason?: string } }).data?.reason,
        "localhost_not_allowed",
      );
      return true;
    },
  );
});

test("validateBrowserTransportProvider allows localhost openai-compatible URLs with opt-in", () => {
  const validated = validateBrowserTransportProvider(
    {
      name: "OpenAI-Compatible",
      baseUrl: "https://localhost:11434/v1",
      envKey: "OPENAI_COMPATIBLE_API_KEY",
      providerKind: "openai_compatible",
      wireApi: "responses",
      metadata: null,
    },
    {
      allowed_origins: [],
      allow_localhost: true,
      allow_private_network: false,
    },
  );

  assert.equal(validated.baseUrl, "https://localhost:11434/v1");
});

test("validateBrowserTransportProvider rejects private-network openai-compatible URLs by default", () => {
  assert.throws(
    () =>
      validateBrowserTransportProvider(
        {
          name: "OpenAI-Compatible",
          baseUrl: "https://10.0.0.5:11434/v1",
          envKey: "OPENAI_COMPATIBLE_API_KEY",
          providerKind: "openai_compatible",
          wireApi: "responses",
          metadata: null,
        },
        {
          allowed_origins: [],
          allow_localhost: false,
          allow_private_network: false,
        },
      ),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.equal((error as { code?: string }).code, "invalid_provider_base_url");
      assert.equal(
        (error as { data?: { reason?: string } }).data?.reason,
        "private_network_not_allowed",
      );
      return true;
    },
  );
});

test("validateBrowserTransportProvider allows private-network openai-compatible URLs with opt-in", () => {
  const validated = validateBrowserTransportProvider(
    {
      name: "OpenAI-Compatible",
      baseUrl: "https://10.0.0.5:11434/v1",
      envKey: "OPENAI_COMPATIBLE_API_KEY",
      providerKind: "openai_compatible",
      wireApi: "responses",
      metadata: null,
    },
    {
      allowed_origins: [],
      allow_localhost: false,
      allow_private_network: true,
    },
  );

  assert.equal(validated.baseUrl, "https://10.0.0.5:11434/v1");
});
