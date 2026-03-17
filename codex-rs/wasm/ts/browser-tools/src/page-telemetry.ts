import type { JsonValue } from "@browser-codex/wasm-runtime-core/types";

export type PageEventKind =
  | "navigation"
  | "mutation"
  | "selection"
  | "click"
  | "input"
  | "tool"
  | "lifecycle";

export type PageInteractiveSurface = {
  selector: string;
  tagName: string;
  role: string | null;
  label: string;
};

export type PageRuntimeSnapshot = {
  url: string;
  title: string;
  capabilityMode: "page" | "extension" | "devtools";
  selectionText: string | null;
  readyState: DocumentReadyState;
  interactives: PageInteractiveSurface[];
  observedAt: number;
};

export type PageRuntimeEvent = {
  id: string;
  kind: PageEventKind;
  summary: string;
  detail: string | null;
  target: string | null;
  timestamp: number;
  data: JsonValue;
};

export type PageTelemetryActivity = {
  kind: PageEventKind;
  summary: string;
  detail: string | null;
  target: string | null;
  timestamp: number;
  data: JsonValue;
};

const MAX_EVENTS = 160;
const listeners = new Set<(snapshot: PageRuntimeSnapshot, events: PageRuntimeEvent[]) => void>();

let initialized = false;
let events: PageRuntimeEvent[] = [];
let snapshot: PageRuntimeSnapshot = captureSnapshot();
let mutationObserver: MutationObserver | null = null;
let refreshTimer: number | null = null;
let activitySink: ((activity: PageTelemetryActivity) => void) | null = null;

export function configurePageTelemetry(options: {
  emitActivity?: ((activity: PageTelemetryActivity) => void) | null;
}): void {
  activitySink = options.emitActivity ?? null;
}

export function initializePageTelemetry(): () => void {
  if (initialized) {
    emit();
    return () => {};
  }
  initialized = true;
  snapshot = captureSnapshot();
  recordPageEvent("lifecycle", "Page telemetry online", {
    url: snapshot.url,
    title: snapshot.title,
  });

  const refreshFromPage = (kind: PageEventKind, summary: string, detail?: string | null, target?: string | null) => {
    scheduleSnapshotRefresh();
    recordPageEvent(kind, summary, {
      detail: detail ?? null,
      target: target ?? null,
      url: window.location.href,
    });
  };

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = (...args) => {
    originalPushState(...args);
    refreshFromPage("navigation", "history.pushState", window.location.href, null);
  };
  window.history.replaceState = (...args) => {
    originalReplaceState(...args);
    refreshFromPage("navigation", "history.replaceState", window.location.href, null);
  };

  const handleNavigation = () => refreshFromPage("navigation", "location changed", window.location.href, null);
  const handleSelection = () => {
    const selectionText = normalizeText(window.getSelection?.()?.toString() ?? "");
    if (selectionText.length > 0) {
      refreshFromPage("selection", "selection changed", selectionText.slice(0, 240), null);
    }
  };
  const handleClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? buildStableSelector(event.target) : null;
    refreshFromPage("click", "user click", null, target);
  };
  const handleInput = (event: Event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    refreshFromPage("input", "user input", null, buildStableSelector(event.target));
  };

  window.addEventListener("popstate", handleNavigation);
  window.addEventListener("hashchange", handleNavigation);
  document.addEventListener("selectionchange", handleSelection);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("input", handleInput, true);

  mutationObserver = new MutationObserver((entries) => {
    const relevantEntries = entries.filter((entry) => !isInsideRuntimeShell(entry.target));
    if (relevantEntries.length === 0) {
      return;
    }
    const summary = relevantEntries
      .slice(0, 3)
      .map((entry) => buildMutationSummary(entry))
      .filter((value) => value.length > 0)
      .join(" | ");
    scheduleSnapshotRefresh();
    recordPageEvent("mutation", summary || "dom mutated", {
      mutations: relevantEntries.length,
      url: window.location.href,
    });
  });
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: false,
  });

  const teardown = () => {
    mutationObserver?.disconnect();
    mutationObserver = null;
    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", handleNavigation);
    window.removeEventListener("hashchange", handleNavigation);
    document.removeEventListener("selectionchange", handleSelection);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("input", handleInput, true);
    initialized = false;
  };

  return teardown;
}

export function subscribePageTelemetry(
  listener: (snapshot: PageRuntimeSnapshot, events: PageRuntimeEvent[]) => void,
): () => void {
  listeners.add(listener);
  listener(snapshot, events);
  return () => {
    listeners.delete(listener);
  };
}

export function getPageRuntimeSnapshot(): PageRuntimeSnapshot {
  return snapshot;
}

export function getRecentPageEvents(limit: number = 20): PageRuntimeEvent[] {
  return events.slice(-Math.max(1, limit));
}

export function recordPageEvent(
  kind: PageEventKind,
  summary: string,
  data: JsonValue = null,
  options?: {
    detail?: string | null;
    target?: string | null;
    silent?: boolean;
  },
): void {
  const nextEvent: PageRuntimeEvent = {
    id: `${Date.now()}-${events.length + 1}`,
    kind,
    summary,
    detail: options?.detail ?? null,
    target: options?.target ?? null,
    timestamp: Date.now(),
    data,
  };
  events = [...events, nextEvent].slice(-MAX_EVENTS);
  if (options?.silent !== true) {
    activitySink?.({
      kind,
      summary,
      detail: nextEvent.detail,
      target: nextEvent.target,
      timestamp: nextEvent.timestamp,
      data,
    });
  }
  emit();
}

export function refreshPageRuntimeSnapshot(): PageRuntimeSnapshot {
  snapshot = captureSnapshot();
  emit();
  return snapshot;
}

function emit() {
  for (const listener of listeners) {
    listener(snapshot, events);
  }
}

function scheduleSnapshotRefresh() {
  if (refreshTimer !== null) {
    return;
  }
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    snapshot = captureSnapshot();
    emit();
  }, 120);
}

function captureSnapshot(): PageRuntimeSnapshot {
  return {
    url: window.location.href,
    title: document.title,
    capabilityMode: inferCapabilityMode(),
    selectionText: normalizeText(window.getSelection?.()?.toString() ?? "") || null,
    readyState: document.readyState,
    interactives: collectInteractives(),
    observedAt: Date.now(),
  };
}

function collectInteractives(): PageInteractiveSurface[] {
  const seen = new Set<string>();
  return [...document.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, [role='button'], [tabindex]")]
    .filter((element) => element.offsetParent !== null || element === document.activeElement)
    .map((element) => {
      const selector = buildStableSelector(element);
      const label = normalizeText(
        element.getAttribute("aria-label") ??
          element.textContent ??
          (element instanceof HTMLInputElement ? element.placeholder : "") ??
          "",
      );
      return {
        selector,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        label: label || selector,
      } satisfies PageInteractiveSurface;
    })
    .filter((surface) => {
      if (seen.has(surface.selector)) {
        return false;
      }
      seen.add(surface.selector);
      return true;
    })
    .slice(0, 14);
}

function buildMutationSummary(entry: MutationRecord): string {
  const baseTarget = entry.target instanceof Element ? buildStableSelector(entry.target) : entry.target.nodeName.toLowerCase();
  if (entry.type === "attributes") {
    return `${baseTarget} attribute:${entry.attributeName ?? "unknown"}`;
  }
  if (entry.type === "childList") {
    return `${baseTarget} children:${entry.addedNodes.length}+/${entry.removedNodes.length}-`;
  }
  return `${baseTarget} changed`;
}

function isInsideRuntimeShell(target: Node): boolean {
  const element =
    target instanceof Element ? target : target.parentElement;
  if (element === null) {
    return false;
  }
  return element.closest("#app") !== null;
}

function buildStableSelector(element: Element): string {
  if (element.id.length > 0) {
    return `#${escapeSelectorValue(element.id)}`;
  }
  const role = element.getAttribute("role");
  const name =
    element.getAttribute("aria-label") ??
    (element instanceof HTMLInputElement ? element.name || element.placeholder : "") ??
    "";
  if (role !== null && name.trim().length > 0) {
    return `${element.tagName.toLowerCase()}[role="${role}"][aria-label="${name.trim().slice(0, 40)}"]`;
  }
  const classes = [...element.classList].slice(0, 2);
  if (classes.length > 0) {
    return `${element.tagName.toLowerCase()}.${classes.map(escapeSelectorValue).join(".")}`;
  }
  const parent = element.parentElement;
  if (parent === null) {
    return element.tagName.toLowerCase();
  }
  const siblings = [...parent.children].filter((candidate) => candidate.tagName === element.tagName);
  const index = siblings.indexOf(element) + 1;
  return `${parent.tagName.toLowerCase()} > ${element.tagName.toLowerCase()}:nth-of-type(${index})`;
}

function escapeSelectorValue(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
