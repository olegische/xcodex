import { bootStore } from "../stores/boot";
import { pageRuntimeStore } from "../stores/page-runtime";
import { runtimeUiStore } from "../stores/runtime-ui";
import { webSignalsStore } from "../stores/web-signals";
import { workspaceBrowserStore } from "../stores/workspace-browser";
import { subscribeRuntimeEvent } from "../runtime";
import { ENABLE_PAGE_TELEMETRY } from "../runtime/constants";
import type { RuntimeEvent } from "../runtime";
import { connectComposerSessionSync } from "./controllers";
import { initializeRuntimeSession, initializeUiShell } from "./actions";

export function setupAppLifecycle(options?: {
  onReady?: () => void;
  onError?: () => void;
}): () => void {
  bootStore.beginStep("mount", "Shell mounted");
  const deltaLogState = new Map<string, { count: number; announcedStreaming: boolean }>();

  let disconnectComposerSessionSync = () => {};
  let unsubscribeRuntimeEvents = () => {};
  let disconnectWorkspaceBrowser = () => {};
  let disconnectWebSignals = () => {};
  let disconnectPageRuntime = () => {};

  void (async () => {
    try {
      await runBootStep("theme", "Applying base theme", async () => {
        await waitForPaint();
      });

      await runBootStep("ui", "Loading UI system", async () => {
        await initializeUiShell();
      });

      await runBootStep("runtime", "Bootstrapping runtime", async () => {
        await initializeRuntimeSession();
      });

      await runBootStep("subscriptions", "Connecting runtime subscriptions", async () => {
        disconnectComposerSessionSync = connectComposerSessionSync();
        unsubscribeRuntimeEvents = subscribeRuntimeEvent((event) => {
          logRuntimeEvent(event, deltaLogState);
          runtimeUiStore.observeRuntimeEvent(event);
        });
      });

      await runBootStep("workspace_browser", "Loading browser workspace", async () => {
        disconnectWorkspaceBrowser = await workspaceBrowserStore.initialize();
      });

      await runBootStep("web_signals", "Loading AI-readable web signals", async () => {
        disconnectWebSignals = await webSignalsStore.initialize();
      });

      await runBootStep(
        "page_runtime",
        ENABLE_PAGE_TELEMETRY ? "Loading page telemetry" : "Page telemetry disabled",
        async () => {
          if (!ENABLE_PAGE_TELEMETRY) {
            return;
          }
          disconnectPageRuntime = await pageRuntimeStore.initialize();
        },
      );

      bootStore.setPhase("ready", "Runtime ready");
    } catch (error) {
      console.error("[webui] lifecycle:failed", error);
      const failedPhase = bootStore.snapshot().phase;
      bootStore.failStep(
        failedPhase === "ready" || failedPhase === "error" ? "runtime" : failedPhase,
        "Lifecycle startup failed",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
      options?.onError?.();
      return;
    }

    options?.onReady?.();
  })();

  return () => {
    disconnectComposerSessionSync();
    unsubscribeRuntimeEvents();
    disconnectWorkspaceBrowser();
    disconnectWebSignals();
    disconnectPageRuntime();
  };
}

async function runBootStep(
  phase:
    | "mount"
    | "theme"
    | "ui"
    | "runtime"
    | "subscriptions"
    | "workspace_browser"
    | "web_signals"
    | "page_runtime",
  detail: string,
  action: () => Promise<void>,
) {
  bootStore.beginStep(phase, detail);
  await waitForPaint();
  await action();
  bootStore.completeStep(phase, detail);
  await waitForPaint();
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function logRuntimeEvent(
  event: RuntimeEvent,
  deltaLogState: Map<string, { count: number; announcedStreaming: boolean }>,
) {
  const params = asRecord(event.params);
  if (params === null) {
    return;
  }

  if (event.method === "item/agentMessage/delta") {
    if (typeof params.turnId !== "string" || typeof params.delta !== "string") {
      return;
    }
    const state = deltaLogState.get(params.turnId) ?? {
      count: 0,
      announcedStreaming: false,
    };
    state.count += 1;
    if (state.count <= 5) {
      console.info("[webui] runtime-delta", {
        requestId: params.turnId,
        chunk: state.count,
        text: params.delta,
      });
    } else if (!state.announcedStreaming) {
      state.announcedStreaming = true;
      console.info("[webui] runtime-delta", {
        requestId: params.turnId,
        status: "receiving response",
        chunksSeen: state.count,
      });
    }
    deltaLogState.set(params.turnId, state);
    return;
  }

  if (event.method === "turn/completed") {
    const turn = asRecord(params.turn);
    if (turn === null || typeof turn.id !== "string") {
      return;
    }
    const deltaState = deltaLogState.get(turn.id);
    if (deltaState !== undefined) {
      console.info("[webui] runtime-delta", {
        requestId: turn.id,
        status: "response received",
        chunksSeen: deltaState.count,
      });
      deltaLogState.delete(turn.id);
    }
    console.info("[webui] runtime-event", event);
    return;
  }

  if (event.method === "error") {
    if (typeof params.turnId === "string") {
      deltaLogState.delete(params.turnId);
    }
    console.info("[webui] runtime-event", event);
    return;
  }

  if (event.method === "item/started") {
    const item = asRecord(params.item);
    if (typeof params.turnId !== "string" || item === null || typeof item.type !== "string") {
      return;
    }
    if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") {
      const toolName =
        item.type === "mcpToolCall" && typeof item.server === "string" && typeof item.tool === "string"
          ? `${normalizeMcpServerNamespace(item.server)}${item.tool}`
          : typeof item.tool === "string"
            ? item.tool
            : null;
      console.info("[webui] runtime-tool-call:args", {
        requestId: params.turnId,
        callId: typeof item.id === "string" ? item.id : null,
        toolName,
        argumentsJson: stringifyForLog(item.arguments ?? null),
      });
    }
  }

  if (event.method === "item/completed") {
    const item = asRecord(params.item);
    if (item?.type === "agentMessage") {
      return;
    }
  }

  console.info("[webui] runtime-event", event);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeMcpServerNamespace(server: string): string {
  if (server.startsWith("mcp__") && server.endsWith("__")) {
    return server;
  }
  return `mcp__${server}__`;
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return error instanceof Error ? `[unserializable: ${error.message}]` : "[unserializable]";
  }
}
