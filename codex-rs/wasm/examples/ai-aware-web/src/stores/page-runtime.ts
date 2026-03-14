import { get, writable } from "svelte/store";
import { savePageRuntimeSnapshot } from "../aiAware/workspace";
import {
  initializePageTelemetry,
  subscribePageTelemetry,
  type PageRuntimeEvent,
  type PageRuntimeSnapshot,
} from "../runtime/page-telemetry";
import type { PageEventSummary, PageRuntimeSummary } from "../types";

type PageRuntimeStoreState = {
  snapshot: PageRuntimeSummary;
  events: PageEventSummary[];
};

const initialState: PageRuntimeStoreState = {
  snapshot: {
    url: "about:blank",
    title: "No page observed yet",
    capabilityMode: "page",
    readyState: "complete",
    selectionText: null,
    interactives: [],
    observedAt: null,
  },
  events: [],
};

function createPageRuntimeStore() {
  const { subscribe, set } = writable<PageRuntimeStoreState>(initialState);

  return {
    subscribe,
    snapshot() {
      return get({ subscribe });
    },
    async initialize() {
      const teardownTelemetry = initializePageTelemetry();
      const unsubscribeTelemetry = subscribePageTelemetry((snapshot, events) => {
        const nextState = {
          snapshot: mapSnapshot(snapshot),
          events: events.map(mapEvent).slice(-80),
        };
        set(nextState);
        void savePageRuntimeSnapshot(nextState);
      });
      return () => {
        unsubscribeTelemetry();
        teardownTelemetry();
      };
    },
  };
}

function mapSnapshot(snapshot: PageRuntimeSnapshot): PageRuntimeSummary {
  return {
    url: snapshot.url,
    title: snapshot.title,
    capabilityMode: snapshot.capabilityMode,
    readyState: snapshot.readyState,
    selectionText: snapshot.selectionText,
    interactives: snapshot.interactives,
    observedAt: snapshot.observedAt,
  };
}

function mapEvent(event: PageRuntimeEvent): PageEventSummary {
  return {
    id: event.id,
    kind: event.kind,
    summary: event.summary,
    detail: event.detail,
    target: event.target,
    timestamp: event.timestamp,
  };
}

export const pageRuntimeStore = createPageRuntimeStore();
