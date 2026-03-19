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
    throw new Error("browser__evaluate requires a non-empty script");
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
    window.setTimeout(() => reject(new Error(`browser__evaluate timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const result = await Promise.race([probeRunner(args, helpers), timeoutPromise]);
  return {
    ok: true,
    result: toJsonValue(result),
  } satisfies JsonValue;
}
