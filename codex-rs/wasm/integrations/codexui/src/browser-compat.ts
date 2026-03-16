import type {
  CodexUiAdapter,
  CodexUiBrowserCompatHandle,
  CodexUiBrowserCompatOptions,
  CodexUiNotification
} from "./types";

type MessageListener = (event: MessageEvent<string>) => void;
type EventListener = (event: Event) => void;

type BrowserGlobals = typeof globalThis & {
  EventSource?: typeof EventSource;
  WebSocket?: typeof WebSocket;
};

function normalizeUrl(input: string | URL, base: string): URL {
  return new URL(typeof input === "string" ? input : input.toString(), base);
}

function isCodexApiUrl(url: URL, codexApiBasePath: string): boolean {
  return url.pathname === codexApiBasePath || url.pathname.startsWith(`${codexApiBasePath}/`);
}

function asRequest(input: RequestInfo | URL, init: RequestInit | undefined, baseUrl: string): Request {
  if (input instanceof Request) {
    return input;
  }
  return new Request(normalizeUrl(input instanceof URL ? input.toString() : String(input), baseUrl), init);
}

function createMessageEvent(data: string): MessageEvent<string> {
  return new MessageEvent("message", { data });
}

function createOpenEvent(): Event {
  return new Event("open");
}

function createCloseEvent(): CloseEvent {
  return new CloseEvent("close");
}

class CompatEventSource implements EventSource {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent<string>) => unknown) | null = null;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;

  private readonly listeners = new Map<string, Set<EventListener | MessageListener>>();
  private unsubscribe: (() => void) | null = null;

  constructor(url: string | URL, adapter: CodexUiAdapter) {
    this.url = url.toString();
    queueMicrotask(() => {
      this.readyState = this.OPEN;
      const openEvent = createOpenEvent();
      this.onopen?.call(this, openEvent);
      this.dispatchEvent(openEvent);
    });
    this.unsubscribe = adapter.subscribeNotifications((notification) => {
      if (this.readyState !== this.OPEN) {
        return;
      }
      const event = createMessageEvent(JSON.stringify(notification));
      this.onmessage?.call(this, event);
      this.dispatchTypedEvent("message", event);
    });
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) {
      return;
    }
    const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    const bucket = this.listeners.get(type) ?? new Set<EventListener | MessageListener>();
    bucket.add(fn);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) {
      return;
    }
    const bucket = this.listeners.get(type);
    if (!bucket) {
      return;
    }
    const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    bucket.delete(fn);
    if (bucket.size === 0) {
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event: Event): boolean {
    this.dispatchTypedEvent(event.type, event);
    return true;
  }

  close(): void {
    if (this.readyState === this.CLOSED) {
      return;
    }
    this.readyState = this.CLOSED;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private dispatchTypedEvent(type: string, event: Event | MessageEvent<string>) {
    const bucket = this.listeners.get(type);
    if (!bucket) {
      return;
    }
    for (const listener of bucket) {
      listener(event as never);
    }
  }
}

class CompatWebSocket implements WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = CompatWebSocket.CONNECTING;
  readonly OPEN = CompatWebSocket.OPEN;
  readonly CLOSING = CompatWebSocket.CLOSING;
  readonly CLOSED = CompatWebSocket.CLOSED;
  readonly binaryType: BinaryType = "blob";
  readonly bufferedAmount = 0;
  readonly extensions = "";
  readonly protocol = "";
  readonly url: string;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent<string>) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  readyState = CompatWebSocket.CONNECTING;

  private readonly listeners = new Map<string, Set<EventListener | MessageListener>>();
  private unsubscribe: (() => void) | null = null;

  constructor(url: string | URL, adapter: CodexUiAdapter) {
    this.url = url.toString();
    queueMicrotask(() => {
      this.readyState = CompatWebSocket.OPEN;
      const openEvent = createOpenEvent();
      this.onopen?.call(this, openEvent);
      this.dispatchTypedEvent("open", openEvent);
    });
    this.unsubscribe = adapter.subscribeNotifications((notification) => {
      if (this.readyState !== CompatWebSocket.OPEN) {
        return;
      }
      const event = createMessageEvent(JSON.stringify(notification));
      this.onmessage?.call(this, event);
      this.dispatchTypedEvent("message", event);
    });
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) {
      return;
    }
    const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    const bucket = this.listeners.get(type) ?? new Set<EventListener | MessageListener>();
    bucket.add(fn);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) {
      return;
    }
    const bucket = this.listeners.get(type);
    if (!bucket) {
      return;
    }
    const fn = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    bucket.delete(fn);
    if (bucket.size === 0) {
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event: Event): boolean {
    this.dispatchTypedEvent(event.type, event);
    return true;
  }

  close(): void {
    if (this.readyState === CompatWebSocket.CLOSED) {
      return;
    }
    this.readyState = CompatWebSocket.CLOSED;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const closeEvent = createCloseEvent();
    this.onclose?.call(this, closeEvent);
    this.dispatchTypedEvent("close", closeEvent);
  }

  send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {}

  private dispatchTypedEvent(type: string, event: Event | MessageEvent<string>) {
    const bucket = this.listeners.get(type);
    if (!bucket) {
      return;
    }
    for (const listener of bucket) {
      listener(event as never);
    }
  }
}

export function installCodexUiBrowserCompat(
  adapter: CodexUiAdapter,
  options: CodexUiBrowserCompatOptions = {}
): CodexUiBrowserCompatHandle {
  const globals = globalThis as BrowserGlobals;
  const baseUrl = globalThis.location?.href ?? "http://localhost/";
  const codexApiBasePath = options.codexApiBasePath ?? "/codex-api";
  const http = adapter.http();

  const originalFetch = globals.fetch.bind(globalThis);
  const originalEventSource = globals.EventSource;
  const originalWebSocket = globals.WebSocket;

  globals.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = asRequest(input, init, baseUrl);
    const url = new URL(request.url);
    if (!isCodexApiUrl(url, codexApiBasePath)) {
      return await originalFetch(input, init);
    }
    const response = await http.handle(request);
    if (response !== null) {
      return response;
    }
    return await originalFetch(input, init);
  }) as typeof fetch;

  globals.EventSource = class EventSourceCompat extends CompatEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const normalized = normalizeUrl(url, baseUrl);
      if (!isCodexApiUrl(normalized, codexApiBasePath) || normalized.pathname !== `${codexApiBasePath}/events`) {
        if (originalEventSource) {
          return new originalEventSource(url, eventSourceInitDict) as never;
        }
        throw new Error(`Unsupported EventSource URL: ${normalized.toString()}`);
      }
      super(normalized.toString(), adapter);
    }
  } as typeof EventSource;

  globals.WebSocket = class WebSocketCompat extends CompatWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const normalized = normalizeUrl(url, baseUrl);
      if (!isCodexApiUrl(normalized, codexApiBasePath) || normalized.pathname !== `${codexApiBasePath}/ws`) {
        if (originalWebSocket) {
          return new originalWebSocket(url, protocols) as never;
        }
        throw new Error(`Unsupported WebSocket URL: ${normalized.toString()}`);
      }
      super(normalized.toString(), adapter);
    }
  } as typeof WebSocket;

  return {
    dispose() {
      globals.fetch = originalFetch;
      if (originalEventSource) {
        globals.EventSource = originalEventSource;
      } else {
        delete globals.EventSource;
      }
      if (originalWebSocket) {
        globals.WebSocket = originalWebSocket;
      } else {
        delete globals.WebSocket;
      }
    }
  };
}
