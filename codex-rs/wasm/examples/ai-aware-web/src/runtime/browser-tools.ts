import type { HostToolExecutorAdapter } from "../../../../ts/host-runtime/src/runtime";
import {
  getPageRuntimeSnapshot,
  getRecentPageEvents,
  recordPageEvent,
  refreshPageRuntimeSnapshot,
} from "./page-telemetry";
import type { JsonValue } from "./types";

type BrowserAiSurfaceSnapshot = {
  domain: string;
  pageUrl: string;
  pageTitle: string;
  llmsTxt: boolean;
  llmsTxtCandidates: string[];
  schemaCoverage: "high" | "medium" | "low";
  freshness: "live" | "steady" | "slow";
  trustScore: number;
  notes: string[];
  canonicalUrl: string | null;
  metaDescription: string | null;
  robots: string | null;
  openGraphCount: number;
  jsonLdTypes: string[];
  microdataItemtypes: string[];
  headingCount: number;
  landmarkCount: number;
  feedUrls: string[];
  selectionText: string | null;
  capabilityMode: "page" | "extension" | "devtools";
};

const BROWSER_TOOLS = [
  {
    name: "browser__page_context",
    description: "Inspect the current browser page context, including title, URL, selection, headings, links, and capability posture.",
    inputSchema: {
      type: "object",
      properties: {
        includeLinksLimit: { type: "number" },
        includeSelection: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser__ai_surface_scan",
    description: "Scan the current page for AI-readable web signals such as llms.txt, schema.org, canonical tags, feeds, and freshness clues.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "browser__extract_dom",
    description: "Extract text, attributes, and brief HTML previews from DOM elements matched by a CSS selector on the current page.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        maxItems: { type: "number" },
        includeHtml: { type: "boolean" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "browser__list_interactives",
    description: "List likely clickable or fillable page surfaces with stable selectors for follow-up actions.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser__click",
    description: "Click an element on the current page using a CSS selector and optional index.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        index: { type: "number" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "browser__fill",
    description: "Fill a form control on the current page and dispatch standard input/change events.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        value: { type: "string" },
        index: { type: "number" },
      },
      required: ["selector", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "browser__navigate",
    description: "Navigate the current tab to a URL or path in the same browser context.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser__wait_for",
    description: "Wait for an element to appear on the page, useful after navigation or async UI changes.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "browser__event_stream",
    description: "Read the most recent browser runtime events such as navigation, mutations, clicks, and tool actions.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
] as const;

export function createBrowserAwareToolExecutor(): HostToolExecutorAdapter {
  return {
    async list() {
      return {
        tools: BROWSER_TOOLS.map((tool) => ({
          toolName: tool.name.replace(/^browser__/, ""),
          toolNamespace: "browser",
          description: tool.description,
          inputSchema: tool.inputSchema as JsonValue,
        })),
      };
    },
    async invoke(params) {
      let output: JsonValue;
      const toolName =
        params.toolNamespace === "browser" && !params.toolName.startsWith("browser__")
          ? `browser__${params.toolName}`
          : params.toolName;
      if (toolName === "browser__page_context") {
        output = inspectPageContext(asRecord(params.input));
      } else if (toolName === "browser__ai_surface_scan") {
        output = await scanCurrentAiSurface();
      } else if (toolName === "browser__extract_dom") {
        output = extractDom(asRecord(params.input));
      } else if (toolName === "browser__list_interactives") {
        output = listInteractives(asRecord(params.input));
      } else if (toolName === "browser__click") {
        output = clickElement(asRecord(params.input));
      } else if (toolName === "browser__fill") {
        output = fillElement(asRecord(params.input));
      } else if (toolName === "browser__navigate") {
        output = navigatePage(asRecord(params.input));
      } else if (toolName === "browser__wait_for") {
        output = await waitForElement(asRecord(params.input));
      } else if (toolName === "browser__event_stream") {
        output = readEventStream(asRecord(params.input));
      } else {
        throw new Error(`Unsupported browser-aware tool: ${toolName}`);
      }
      return {
        callId: params.callId,
        output,
      };
    },
    async cancel() {
      return;
    },
  };
}

export async function scanCurrentAiSurface(): Promise<BrowserAiSurfaceSnapshot> {
  const origin = window.location.origin;
  const llmsTxtCandidates = [`${origin}/llms.txt`, `${origin}/.well-known/llms.txt`];
  const llmsTxt = await hasReachableLlmsTxt(llmsTxtCandidates);
  const jsonLdTypes = collectJsonLdTypes();
  const microdataItemtypes = [...document.querySelectorAll("[itemtype]")]
    .map((element) => element.getAttribute("itemtype"))
    .filter((value): value is string => value !== null && value.length > 0)
    .slice(0, 12);
  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null;
  const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null;
  const openGraphCount = document.querySelectorAll('meta[property^="og:"]').length;
  const feedUrls = [...document.querySelectorAll('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]')]
    .map((element) => element.getAttribute("href"))
    .filter((value): value is string => value !== null && value.length > 0)
    .slice(0, 8);
  const headingCount = document.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
  const landmarkCount = document.querySelectorAll("main, nav, header, footer, aside, article, section").length;
  const selectionText = normalizeText(window.getSelection?.()?.toString() ?? "");
  const freshness = inferFreshness();
  const schemaCoverage = inferSchemaCoverage({
    jsonLdCount: jsonLdTypes.length,
    microdataCount: microdataItemtypes.length,
    canonicalUrl,
  });
  const capabilityMode = inferCapabilityMode();
  const notes = buildAiSurfaceNotes({
    llmsTxt,
    jsonLdTypes,
    microdataItemtypes,
    canonicalUrl,
    metaDescription,
    openGraphCount,
    feedUrls,
    capabilityMode,
  });

  return {
    domain: window.location.hostname,
    pageUrl: window.location.href,
    pageTitle: document.title,
    llmsTxt,
    llmsTxtCandidates,
    schemaCoverage,
    freshness,
    trustScore: scoreAiSurface({
      llmsTxt,
      canonicalUrl,
      metaDescription,
      jsonLdCount: jsonLdTypes.length,
      microdataCount: microdataItemtypes.length,
      openGraphCount,
      headingCount,
      landmarkCount,
      feedCount: feedUrls.length,
    }),
    notes,
    canonicalUrl,
    metaDescription,
    robots,
    openGraphCount,
    jsonLdTypes,
    microdataItemtypes,
    headingCount,
    landmarkCount,
    feedUrls,
    selectionText,
    capabilityMode,
  };
}

function inspectPageContext(input: Record<string, JsonValue>): JsonValue {
  const includeLinksLimit = clampNumber(input.includeLinksLimit, 12, 1, 40);
  const includeSelection = input.includeSelection !== false;
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .map((heading) => normalizeText(heading.textContent ?? ""))
    .filter((text) => text.length > 0)
    .slice(0, 18);
  const links = [...document.querySelectorAll("a[href]")]
    .map((link) => ({
      text: normalizeText(link.textContent ?? ""),
      href: link.getAttribute("href") ?? "",
    }))
    .filter((link) => link.text.length > 0 || link.href.length > 0)
    .slice(0, includeLinksLimit);
  const selectionText = includeSelection ? normalizeText(window.getSelection?.()?.toString() ?? "") : "";
  const snapshot = refreshPageRuntimeSnapshot();

  return {
    url: window.location.href,
    origin: window.location.origin,
    title: document.title,
    language: document.documentElement.lang || null,
    capabilityMode: inferCapabilityMode(),
    selectionText: selectionText.length > 0 ? selectionText : null,
    headings,
    links,
    landmarks: {
      main: document.querySelectorAll("main").length,
      nav: document.querySelectorAll("nav").length,
      article: document.querySelectorAll("article").length,
      section: document.querySelectorAll("section").length,
      form: document.querySelectorAll("form").length,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    interactives: snapshot.interactives,
  } satisfies JsonValue;
}

function extractDom(input: Record<string, JsonValue>): JsonValue {
  const selector = typeof input.selector === "string" ? input.selector.trim() : "";
  if (selector.length === 0) {
    throw new Error("browser__extract_dom requires a non-empty selector");
  }
  const maxItems = clampNumber(input.maxItems, 8, 1, 24);
  const includeHtml = input.includeHtml === true;
  const elements = [...document.querySelectorAll(selector)].slice(0, maxItems);
  return {
    selector,
    count: elements.length,
    elements: elements.map((element, index) => ({
      index,
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === "string" && element.className.length > 0 ? element.className : null,
      role: element.getAttribute("role"),
      text: normalizeText(element.textContent ?? ""),
      href: element instanceof HTMLAnchorElement ? element.href : null,
      html:
        includeHtml && "outerHTML" in element
          ? String((element as Element).outerHTML).slice(0, 500)
          : null,
    })),
  } satisfies JsonValue;
}

function listInteractives(input: Record<string, JsonValue>): JsonValue {
  const limit = clampNumber(input.limit, 10, 1, 30);
  const snapshot = refreshPageRuntimeSnapshot();
  recordPageEvent(
    "tool",
    "browser__list_interactives",
    {
      count: snapshot.interactives.length,
    },
    {
      detail: `Listed ${Math.min(limit, snapshot.interactives.length)} interactive surfaces`,
    },
  );
  return {
    url: snapshot.url,
    title: snapshot.title,
    count: Math.min(limit, snapshot.interactives.length),
    surfaces: snapshot.interactives.slice(0, limit),
  } satisfies JsonValue;
}

function clickElement(input: Record<string, JsonValue>): JsonValue {
  const element = requireElement(input, "browser__click");
  const selector = typeof input.selector === "string" ? input.selector.trim() : "";
  element.click();
  refreshPageRuntimeSnapshot();
  recordPageEvent(
    "tool",
    "browser__click",
    {
      selector,
    },
    {
      target: selector,
      detail: summarizeElement(element),
    },
  );
  return {
    ok: true,
    action: "click",
    selector,
    target: summarizeElement(element),
    url: window.location.href,
  } satisfies JsonValue;
}

function fillElement(input: Record<string, JsonValue>): JsonValue {
  const element = requireElement(input, "browser__fill");
  const value = typeof input.value === "string" ? input.value : "";
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
  ) {
    throw new Error("browser__fill requires an input, textarea, or select target");
  }
  if (element instanceof HTMLSelectElement) {
    element.value = value;
    const selectedOption =
      [...element.options].find((option) => option.value === value || normalizeText(option.textContent ?? "") === value) ??
      null;
    if (selectedOption !== null) {
      element.value = selectedOption.value;
    }
  } else {
    element.focus();
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  refreshPageRuntimeSnapshot();
  const selector = typeof input.selector === "string" ? input.selector.trim() : "";
  recordPageEvent(
    "tool",
    "browser__fill",
    {
      selector,
      valueLength: value.length,
    },
    {
      target: selector,
      detail: summarizeElement(element),
    },
  );
  return {
    ok: true,
    action: "fill",
    selector,
    target: summarizeElement(element),
    valueLength: value.length,
  } satisfies JsonValue;
}

function navigatePage(input: Record<string, JsonValue>): JsonValue {
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (rawUrl.length === 0) {
    throw new Error("browser__navigate requires a non-empty url");
  }
  const url = new URL(rawUrl, window.location.href).toString();
  recordPageEvent(
    "tool",
    "browser__navigate",
    {
      from: window.location.href,
      to: url,
    },
    {
      detail: url,
    },
  );
  window.location.assign(url);
  return {
    ok: true,
    action: "navigate",
    url,
  } satisfies JsonValue;
}

async function waitForElement(input: Record<string, JsonValue>): Promise<JsonValue> {
  const selector = typeof input.selector === "string" ? input.selector.trim() : "";
  if (selector.length === 0) {
    throw new Error("browser__wait_for requires a non-empty selector");
  }
  const timeoutMs = clampNumber(input.timeoutMs, 3000, 100, 20_000);
  const start = performance.now();
  while (performance.now() - start <= timeoutMs) {
    const element = document.querySelector(selector);
    if (element !== null) {
      refreshPageRuntimeSnapshot();
      recordPageEvent(
        "tool",
        "browser__wait_for",
        {
          selector,
          elapsedMs: Math.round(performance.now() - start),
        },
        {
          target: selector,
          detail: "selector became available",
        },
      );
      return {
        ok: true,
        selector,
        elapsedMs: Math.round(performance.now() - start),
        target: summarizeElement(element),
      } satisfies JsonValue;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  recordPageEvent(
    "tool",
    "browser__wait_for_timeout",
    {
      selector,
      timeoutMs,
    },
    {
      target: selector,
      detail: "selector did not appear before timeout",
    },
  );
  throw new Error(`browser__wait_for timed out after ${timeoutMs}ms for selector ${selector}`);
}

function readEventStream(input: Record<string, JsonValue>): JsonValue {
  const limit = clampNumber(input.limit, 20, 1, 60);
  return {
    snapshot: getPageRuntimeSnapshot(),
    events: getRecentPageEvents(limit),
  } satisfies JsonValue;
}

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

function requireElement(input: Record<string, JsonValue>, toolName: string): Element {
  const selector = typeof input.selector === "string" ? input.selector.trim() : "";
  if (selector.length === 0) {
    throw new Error(`${toolName} requires a non-empty selector`);
  }
  const index = clampNumber(input.index, 0, 0, 40);
  const matches = [...document.querySelectorAll(selector)];
  const element = matches[index] ?? null;
  if (element === null) {
    throw new Error(`${toolName} could not find selector ${selector} at index ${index}`);
  }
  return element;
}

function summarizeElement(element: Element): string {
  const label = normalizeText(
    element.getAttribute("aria-label") ??
      element.textContent ??
      (element instanceof HTMLInputElement ? element.placeholder : "") ??
      "",
  );
  const tagName = element.tagName.toLowerCase();
  return label.length > 0 ? `${tagName} ${label.slice(0, 80)}` : tagName;
}

async function hasReachableLlmsTxt(candidates: string[]): Promise<boolean> {
  for (const candidate of candidates) {
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 1500);
    try {
      const response = await fetch(candidate, {
        method: "GET",
        signal: abortController.signal,
        headers: {
          Accept: "text/plain, text/markdown;q=0.9, */*;q=0.1",
        },
      });
      window.clearTimeout(timeoutId);
      if (!response.ok) {
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        continue;
      }
      const text = await response.text();
      if (text.trim().length > 0) {
        return true;
      }
    } catch {
      window.clearTimeout(timeoutId);
      continue;
    }
  }
  return false;
}

function collectJsonLdTypes(): string[] {
  const types = new Set<string>();
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent ?? "null") as unknown;
      for (const type of extractJsonLdTypeValues(parsed)) {
        types.add(type);
      }
    } catch {
      continue;
    }
  }
  return [...types].slice(0, 12);
}

function extractJsonLdTypeValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractJsonLdTypeValues);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const typeField = record["@type"];
  const ownTypes =
    typeof typeField === "string"
      ? [typeField]
      : Array.isArray(typeField)
        ? typeField.filter((entry): entry is string => typeof entry === "string")
        : [];
  return [
    ...ownTypes,
    ...Object.values(record).flatMap((entry) => extractJsonLdTypeValues(entry)),
  ];
}

function inferSchemaCoverage(input: {
  jsonLdCount: number;
  microdataCount: number;
  canonicalUrl: string | null;
}): "high" | "medium" | "low" {
  const score =
    (input.jsonLdCount >= 2 ? 2 : input.jsonLdCount > 0 ? 1 : 0) +
    (input.microdataCount > 0 ? 1 : 0) +
    (input.canonicalUrl !== null ? 1 : 0);
  if (score >= 3) {
    return "high";
  }
  if (score >= 1) {
    return "medium";
  }
  return "low";
}

function inferFreshness(): "live" | "steady" | "slow" {
  const candidates = [
    document.querySelector('meta[property="article:modified_time"]')?.getAttribute("content"),
    document.querySelector('meta[name="last-modified"]')?.getAttribute("content"),
    document.querySelector("time[datetime]")?.getAttribute("datetime"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const now = Date.now();
  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate);
    if (Number.isNaN(timestamp)) {
      continue;
    }
    const ageDays = (now - timestamp) / 86_400_000;
    if (ageDays <= 7) {
      return "live";
    }
    if (ageDays <= 90) {
      return "steady";
    }
    return "slow";
  }
  return "steady";
}

function inferCapabilityMode(): "page" | "extension" | "devtools" {
  const chromeLike = (window as Window & { chrome?: { runtime?: { id?: string }; devtools?: object } }).chrome;
  if (chromeLike?.devtools !== undefined) {
    return "devtools";
  }
  if (chromeLike?.runtime?.id !== undefined) {
    return "extension";
  }
  return "page";
}

function buildAiSurfaceNotes(input: {
  llmsTxt: boolean;
  jsonLdTypes: string[];
  microdataItemtypes: string[];
  canonicalUrl: string | null;
  metaDescription: string | null;
  openGraphCount: number;
  feedUrls: string[];
  capabilityMode: "page" | "extension" | "devtools";
}): string[] {
  const notes = [
    input.llmsTxt ? "llms.txt reachable" : "llms.txt not found",
    input.canonicalUrl !== null ? "canonical present" : "canonical missing",
    input.metaDescription !== null ? "description present" : "description missing",
    input.openGraphCount > 0 ? `og tags ${input.openGraphCount}` : "og tags missing",
    input.jsonLdTypes.length > 0 ? `json-ld ${input.jsonLdTypes.join(", ")}` : "json-ld missing",
    input.microdataItemtypes.length > 0 ? `microdata ${input.microdataItemtypes.length}` : "microdata missing",
    input.feedUrls.length > 0 ? `feeds ${input.feedUrls.length}` : "feeds missing",
    `mode ${input.capabilityMode}`,
  ];
  return notes.slice(0, 8);
}

function scoreAiSurface(input: {
  llmsTxt: boolean;
  canonicalUrl: string | null;
  metaDescription: string | null;
  jsonLdCount: number;
  microdataCount: number;
  openGraphCount: number;
  headingCount: number;
  landmarkCount: number;
  feedCount: number;
}): number {
  let score = 28;
  if (input.llmsTxt) {
    score += 24;
  }
  if (input.canonicalUrl !== null) {
    score += 10;
  }
  if (input.metaDescription !== null) {
    score += 6;
  }
  score += Math.min(14, input.jsonLdCount * 5);
  score += Math.min(8, input.microdataCount * 2);
  score += Math.min(5, input.openGraphCount);
  if (input.headingCount >= 3) {
    score += 3;
  }
  if (input.landmarkCount >= 3) {
    score += 2;
  }
  if (input.feedCount > 0) {
    score += 4;
  }
  return Math.min(100, Math.max(0, score));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
