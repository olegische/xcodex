import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";

type StorageEntry = {
  key: string;
  valuePreview: string | null;
  length: number | null;
};

function asRecord(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function clampNumber(value: JsonValue, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function previewValue(value: string, includeValues: boolean): string | null {
  if (!includeValues) {
    return null;
  }
  return value.slice(0, 200);
}

function inspectStorageArea(
  storage: Storage,
  includeValues: boolean,
  limit: number,
): StorageEntry[] {
  const entries: StorageEntry[] = [];
  for (let index = 0; index < storage.length && entries.length < limit; index += 1) {
    const key = storage.key(index);
    if (key === null) {
      continue;
    }
    const value = storage.getItem(key);
    entries.push({
      key,
      valuePreview: value === null ? null : previewValue(value, includeValues),
      length: value?.length ?? null,
    });
  }
  return entries;
}

function parseCookies(includeValues: boolean): Array<{
  name: string;
  valuePreview: string | null;
  length: number;
}> {
  if (document.cookie.trim().length === 0) {
    return [];
  }
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      const name = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? "" : part.slice(separatorIndex + 1);
      return {
        name,
        valuePreview: previewValue(value, includeValues),
        length: value.length,
      };
    });
}

async function listIndexedDbDatabases(): Promise<Array<{ name: string | null; version: number | null }>> {
  const indexedDbWithDatabases = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string; version?: number }>>;
  };
  if (typeof indexedDbWithDatabases.databases !== "function") {
    return [];
  }
  try {
    const databases = await indexedDbWithDatabases.databases();
    return databases.map((database) => ({
      name: database.name ?? null,
      version: typeof database.version === "number" ? database.version : null,
    }));
  } catch {
    return [];
  }
}

export async function inspectBrowserStorage(input: JsonValue): Promise<JsonValue> {
  const record = asRecord(input);
  const includeValues = record.includeValues === true;
  const limit = clampNumber(record.limit, 20, 1, 100);
  const indexedDbDatabases = await listIndexedDbDatabases();

  return {
    origin: window.location.origin,
    localStorage: {
      count: window.localStorage.length,
      entries: inspectStorageArea(window.localStorage, includeValues, limit),
    },
    sessionStorage: {
      count: window.sessionStorage.length,
      entries: inspectStorageArea(window.sessionStorage, includeValues, limit),
    },
    cookies: {
      count: document.cookie.trim().length === 0 ? 0 : document.cookie.split(";").length,
      entries: parseCookies(includeValues).slice(0, limit),
    },
    indexedDb: {
      count: indexedDbDatabases.length,
      databases: indexedDbDatabases.slice(0, limit),
    },
  } satisfies JsonValue;
}

export function inspectCookies(input: JsonValue): JsonValue {
  const record = asRecord(input);
  const includeValues = record.includeValues === true;
  const limit = clampNumber(record.limit, 20, 1, 100);
  const entries = parseCookies(includeValues).slice(0, limit);
  return {
    origin: window.location.origin,
    count: entries.length,
    entries,
  } satisfies JsonValue;
}

function collectMetaTags(limit: number): JsonValue[] {
  return [...document.querySelectorAll("meta")]
    .slice(0, limit)
    .map((element) => ({
      name: element.getAttribute("name"),
      property: element.getAttribute("property"),
      httpEquiv: element.getAttribute("http-equiv"),
      content: element.getAttribute("content"),
    }));
}

export function inspectPageResources(input: JsonValue): JsonValue {
  const record = asRecord(input);
  const limit = clampNumber(record.limit, 24, 1, 100);
  const scriptOrigins = new Set<string>();
  const linkOrigins = new Set<string>();
  const resourceEntries = performance
    .getEntriesByType("resource")
    .slice(0, limit)
    .map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      const origin = new URL(resource.name, window.location.href).origin;
      return {
        name: resource.name,
        initiatorType: resource.initiatorType,
        duration: Math.round(resource.duration),
        transferSize: "transferSize" in resource ? resource.transferSize : null,
        origin,
      };
    });

  return {
    url: window.location.href,
    scripts: [...document.scripts].slice(0, limit).map((script, index) => ({
      ...(script.src.length > 0
        ? (() => {
            scriptOrigins.add(new URL(script.src, window.location.href).origin);
            return {};
          })()
        : {}),
      index,
      src: script.src || null,
      type: script.type || null,
      async: script.async,
      defer: script.defer,
      inline: script.src.length === 0,
      textLength: script.textContent?.length ?? 0,
    })),
    stylesheets: [...document.querySelectorAll('link[rel="stylesheet"], style')]
      .slice(0, limit)
      .map((element, index) => ({
        index,
        tagName: element.tagName.toLowerCase(),
        href: element instanceof HTMLLinkElement ? element.href : null,
        inline: element.tagName.toLowerCase() === "style",
      })),
    iframes: [...document.querySelectorAll("iframe")]
      .slice(0, limit)
      .map((iframe, index) => ({
        index,
        src: iframe.getAttribute("src"),
        sandbox: iframe.getAttribute("sandbox"),
        allow: iframe.getAttribute("allow"),
        title: iframe.getAttribute("title"),
      })),
    forms: [...document.forms].slice(0, limit).map((form, index) => ({
      index,
      action: form.getAttribute("action"),
      method: form.getAttribute("method"),
      autocomplete: form.getAttribute("autocomplete"),
      inputCount: form.querySelectorAll("input, textarea, select").length,
    })),
    links: [...document.querySelectorAll("a[href]")]
      .slice(0, limit)
      .map((link, index) => ({
        ...(link.getAttribute("href") !== null
          ? (() => {
              try {
                linkOrigins.add(new URL(link.getAttribute("href") ?? "", window.location.href).origin);
              } catch {
                return {};
              }
              return {};
            })()
          : {}),
        index,
        href: link.getAttribute("href"),
        target: link.getAttribute("target"),
        rel: link.getAttribute("rel"),
        text: normalizeText(link.textContent ?? ""),
      })),
    metaTags: collectMetaTags(limit),
    resourceEntries,
    origins: {
      scripts: [...scriptOrigins].slice(0, limit),
      links: [...linkOrigins].slice(0, limit),
    },
  } satisfies JsonValue;
}

function filterHeaders(headers: Headers, includeAllHeaders: boolean): Record<string, string> {
  const entries = [...headers.entries()];
  const allowList = new Set([
    "content-security-policy",
    "content-type",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "cross-origin-embedder-policy",
    "permissions-policy",
    "referrer-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "cache-control",
  ]);
  return Object.fromEntries(
    entries.filter(([name]) => includeAllHeaders || allowList.has(name.toLowerCase())),
  );
}

export async function probeHttpSurface(input: JsonValue): Promise<JsonValue> {
  const record = asRecord(input);
  const rawUrl = typeof record.url === "string" && record.url.trim().length > 0 ? record.url.trim() : window.location.href;
  const url = new URL(rawUrl, window.location.href).toString();
  const includeAllHeaders = record.includeAllHeaders === true;
  const method = record.method === "HEAD" ? "HEAD" : "GET";

  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      redirect: "follow",
    });
    return {
      ok: response.ok,
      url,
      method,
      status: response.status,
      redirected: response.redirected,
      finalUrl: response.url,
      headers: filterHeaders(response.headers, includeAllHeaders),
    } satisfies JsonValue;
  } catch (error) {
    return {
      ok: false,
      url,
      method,
      error: error instanceof Error ? error.message : String(error),
    } satisfies JsonValue;
  }
}

export function performanceSnapshot(input: JsonValue): JsonValue {
  const record = asRecord(input);
  const limit = clampNumber(record.limit, 30, 1, 120);
  const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const resources = performance
    .getEntriesByType("resource")
    .slice(0, limit)
    .map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        name: resource.name,
        initiatorType: resource.initiatorType,
        duration: Math.round(resource.duration),
        startTime: Math.round(resource.startTime),
        transferSize: "transferSize" in resource ? resource.transferSize : null,
        encodedBodySize: "encodedBodySize" in resource ? resource.encodedBodySize : null,
        decodedBodySize: "decodedBodySize" in resource ? resource.decodedBodySize : null,
      };
    });

  return {
    timeOrigin: Math.round(performance.timeOrigin),
    navigation:
      navigationEntry === undefined
        ? null
        : {
            entryType: navigationEntry.entryType,
            type: navigationEntry.type,
            startTime: Math.round(navigationEntry.startTime),
            duration: Math.round(navigationEntry.duration),
            domContentLoadedEventEnd: Math.round(navigationEntry.domContentLoadedEventEnd),
            loadEventEnd: Math.round(navigationEntry.loadEventEnd),
            responseEnd: Math.round(navigationEntry.responseEnd),
          },
    resources,
  } satisfies JsonValue;
}

function toJsonValue(value: unknown, depth: number = 0): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 4) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => toJsonValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    return Object.fromEntries(entries.map(([key, entry]) => [key, toJsonValue(entry, depth + 1)]));
  }
  return String(value);
}

export async function runProbe(input: JsonValue): Promise<JsonValue> {
  const record = asRecord(input);
  const script = typeof record.script === "string" ? record.script.trim() : "";
  const args = record.args ?? null;
  const timeoutMs = clampNumber(record.timeoutMs, 1500, 50, 10_000);
  if (script.length === 0) {
    throw new Error("browser__run_probe requires a non-empty script");
  }

  type ProbeHelpers = {
    query(selector: string): Element | null;
    queryAll(selector: string): Element[];
    text(selector: string): string[];
    location(): string;
  };

  const helpers: ProbeHelpers = {
    query: (selector: string) => document.querySelector(selector),
    queryAll: (selector: string) => [...document.querySelectorAll(selector)],
    text: (selector: string) =>
      [...document.querySelectorAll(selector)].map((element) => normalizeText(element.textContent ?? "")),
    location: () => window.location.href,
  };

  const probeRunner = new Function(
    "args",
    "helpers",
    `"use strict"; return (async () => { ${script} })();`,
  ) as (args: JsonValue, helpers: ProbeHelpers) => Promise<unknown>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error(`browser__run_probe timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const result = await Promise.race([probeRunner(args, helpers), timeoutPromise]);
  return {
    ok: true,
    result: toJsonValue(result),
  } satisfies JsonValue;
}

export function scanDomXssSurface(input: JsonValue): JsonValue {
  const record = asRecord(input);
  const limit = clampNumber(record.limit, 40, 1, 200);
  const inlineHandlers = [...document.querySelectorAll("*")]
    .flatMap((element) =>
      element.getAttributeNames()
        .filter((name) => name.startsWith("on"))
        .map((name) => ({
          selector: element.tagName.toLowerCase(),
          attribute: name,
          valuePreview: (element.getAttribute(name) ?? "").slice(0, 160),
        })),
    )
    .slice(0, limit);
  const javascriptUrls = [...document.querySelectorAll('[href^="javascript:"], [src^="javascript:"]')]
    .slice(0, limit)
    .map((element) => ({
      tagName: element.tagName.toLowerCase(),
      href: element.getAttribute("href"),
      src: element.getAttribute("src"),
    }));
  const srcdocIframes = [...document.querySelectorAll("iframe[srcdoc]")]
    .slice(0, limit)
    .map((iframe) => ({
      srcdocLength: iframe.getAttribute("srcdoc")?.length ?? 0,
      title: iframe.getAttribute("title"),
    }));
  const contenteditable = [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')]
    .slice(0, limit)
    .map((element) => ({
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === "string" ? element.className : null,
    }));
  const unsafeBlankLinks = [...document.querySelectorAll('a[target="_blank"]')]
    .filter((link) => {
      const rel = (link.getAttribute("rel") ?? "").toLowerCase();
      return !rel.includes("noopener") || !rel.includes("noreferrer");
    })
    .slice(0, limit)
    .map((link) => ({
      href: link.getAttribute("href"),
      rel: link.getAttribute("rel"),
      text: normalizeText(link.textContent ?? ""),
    }));

  return {
    url: window.location.href,
    inlineHandlers,
    javascriptUrls,
    srcdocIframes,
    contenteditable,
    unsafeBlankLinks,
    counts: {
      inlineHandlers: inlineHandlers.length,
      javascriptUrls: javascriptUrls.length,
      srcdocIframes: srcdocIframes.length,
      contenteditable: contenteditable.length,
      unsafeBlankLinks: unsafeBlankLinks.length,
    },
  } satisfies JsonValue;
}

async function fetchSameOriginScriptText(script: HTMLScriptElement): Promise<string | null> {
  if (script.src.length === 0) {
    return script.textContent ?? "";
  }
  try {
    const url = new URL(script.src, window.location.href);
    if (url.origin !== window.location.origin) {
      return null;
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "same-origin",
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

export async function scanDangerousSinks(input: JsonValue): Promise<JsonValue> {
  const record = asRecord(input);
  const limit = clampNumber(record.limit, 20, 1, 100);
  const sinkPatterns = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"];
  const findings: Array<{ sink: string; scriptIndex: number; source: "inline" | "same-origin"; snippet: string }> = [];
  const scripts = [...document.scripts].slice(0, limit);

  for (let index = 0; index < scripts.length; index += 1) {
    const sourceText = await fetchSameOriginScriptText(scripts[index]);
    if (sourceText === null || sourceText.length === 0) {
      continue;
    }
    for (const sink of sinkPatterns) {
      const position = sourceText.indexOf(sink);
      if (position === -1) {
        continue;
      }
      findings.push({
        sink,
        scriptIndex: index,
        source: scripts[index].src.length === 0 ? "inline" : "same-origin",
        snippet: sourceText.slice(Math.max(0, position - 80), Math.min(sourceText.length, position + 120)),
      });
    }
  }

  return {
    url: window.location.href,
    findings: findings.slice(0, limit),
    counts: Object.fromEntries(
      sinkPatterns.map((sink) => [sink, findings.filter((finding) => finding.sink === sink).length]),
    ),
  } satisfies JsonValue;
}

export function inspectGlobals(input: JsonValue): JsonValue {
  const record = asRecord(input);
  const limit = clampNumber(record.limit, 40, 1, 200);
  const pattern = /token|secret|key|auth|config|session|credential|password/i;
  const matches = Object.getOwnPropertyNames(window)
    .filter((name) => pattern.test(name))
    .slice(0, limit)
    .map((name) => {
      const value = (window as unknown as Record<string, unknown>)[name];
      return {
        name,
        type: value === null ? "null" : typeof value,
        preview:
          typeof value === "string"
            ? value.slice(0, 120)
            : typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : value !== null && typeof value === "object"
                ? Object.keys(value as Record<string, unknown>).slice(0, 12)
                : null,
      };
    });

  return {
    url: window.location.href,
    matches,
    count: matches.length,
  } satisfies JsonValue;
}

export async function probeInputReflection(input: JsonValue): Promise<JsonValue> {
  const record = asRecord(input);
  const selector = typeof record.selector === "string" ? record.selector.trim() : "";
  const payload =
    typeof record.payload === "string" && record.payload.length > 0
      ? record.payload
      : "__codex_probe__<img src=x onerror=1>__";
  const submitSelector = typeof record.submitSelector === "string" ? record.submitSelector.trim() : "";
  const waitMs = clampNumber(record.waitMs, 400, 0, 5000);
  if (selector.length === 0) {
    throw new Error("browser__probe_input_reflection requires a non-empty selector");
  }

  const inputElement = document.querySelector(selector);
  if (
    !(
      inputElement instanceof HTMLInputElement ||
      inputElement instanceof HTMLTextAreaElement ||
      inputElement instanceof HTMLSelectElement
    )
  ) {
    throw new Error("browser__probe_input_reflection requires an input, textarea, or select target");
  }

  if (inputElement instanceof HTMLSelectElement) {
    inputElement.value = payload;
  } else {
    inputElement.focus();
    inputElement.value = payload;
  }
  inputElement.dispatchEvent(new Event("input", { bubbles: true }));
  inputElement.dispatchEvent(new Event("change", { bubbles: true }));

  if (submitSelector.length > 0) {
    const submitElement = document.querySelector(submitSelector);
    if (submitElement instanceof HTMLElement) {
      submitElement.click();
    }
  }

  if (waitMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, waitMs));
  }

  const bodyHtml = document.body.innerHTML;
  const bodyText = document.body.innerText;
  return {
    selector,
    submitSelector: submitSelector.length > 0 ? submitSelector : null,
    payload,
    reflectedAsText: bodyText.includes(payload),
    reflectedAsHtml: bodyHtml.includes(payload),
    reflectedEncoded:
      bodyHtml.includes(payload.replace(/</g, "&lt;").replace(/>/g, "&gt;")) ||
      bodyHtml.includes("&lt;img"),
  } satisfies JsonValue;
}
