import { bootStore } from "../stores/boot";
import { apsixZoneStore } from "../stores/apsix-zone";
import { pageRuntimeStore } from "../stores/page-runtime";
import { runtimeUiStore } from "../stores/runtime-ui";
import { webSignalsStore } from "../stores/web-signals";
import { workspaceBrowserStore } from "../stores/workspace-browser";
import { subscribeRuntimeActivity } from "../runtime";
import { ENABLE_PAGE_TELEMETRY } from "../runtime/constants";
import { connectComposerSessionSync } from "./controllers";
import { initializeRuntimeSession, initializeUiShell } from "./actions";

export function setupAppLifecycle(options?: {
  onReady?: () => void;
  onError?: () => void;
}): () => void {
  bootStore.beginStep("mount", "Shell mounted");
  const deltaLogState = new Map<string, { count: number; announcedStreaming: boolean }>();

  let disconnectComposerSessionSync = () => {};
  let unsubscribeRuntimeActivity = () => {};
  let disconnectWorkspaceBrowser = () => {};
  let disconnectWebSignals = () => {};
  let disconnectPageRuntime = () => {};
  let disconnectZoneControl = () => {};

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
        unsubscribeRuntimeActivity = subscribeRuntimeActivity((activity) => {
          logRuntimeActivity(activity, deltaLogState);
          runtimeUiStore.observeActivity(activity);
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

      await runBootStep("zone_control", "Loading APSIX zone control", async () => {
        disconnectZoneControl = await apsixZoneStore.initialize();
      });

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
    unsubscribeRuntimeActivity();
    disconnectWorkspaceBrowser();
    disconnectWebSignals();
    disconnectPageRuntime();
    disconnectZoneControl();
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
    | "page_runtime"
    | "zone_control",
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

function logRuntimeActivity(
  activity: Parameters<Parameters<typeof subscribeRuntimeActivity>[0]>[0],
  deltaLogState: Map<string, { count: number; announcedStreaming: boolean }>,
) {
  if (activity.type === "delta") {
    const state = deltaLogState.get(activity.requestId) ?? {
      count: 0,
      announcedStreaming: false,
    };
    state.count += 1;
    if (state.count <= 5) {
      console.info("[webui] runtime-delta", {
        requestId: activity.requestId,
        chunk: state.count,
        text: activity.text,
      });
    } else if (!state.announcedStreaming) {
      state.announcedStreaming = true;
      console.info("[webui] runtime-delta", {
        requestId: activity.requestId,
        status: "receiving response",
        chunksSeen: state.count,
      });
    }
    deltaLogState.set(activity.requestId, state);
    return;
  }

  if (activity.type === "completed") {
    const deltaState = deltaLogState.get(activity.requestId);
    if (deltaState !== undefined) {
      console.info("[webui] runtime-delta", {
        requestId: activity.requestId,
        status: "response received",
        chunksSeen: deltaState.count,
      });
      deltaLogState.delete(activity.requestId);
    }
    console.info("[webui] runtime-activity", activity);
    return;
  }

  if (activity.type === "error") {
    deltaLogState.delete(activity.requestId);
  }

  if (activity.type === "pageEvent") {
    if (activity.kind === "mutation") {
      return;
    }
    console.info("[webui] page-event", activity);
    return;
  }

  if (activity.type === "apsixZone") {
    console.info("[webui] apsix-zone", activity);
    return;
  }

  if (
    activity.type === "apsixSpawn" ||
    activity.type === "apsixArtifact" ||
    activity.type === "apsixAnchor" ||
    activity.type === "apsixFreeze"
  ) {
    console.info("[webui] apsix-runtime", activity);
    return;
  }

  if (activity.type === "assistantMessage") {
    return;
  }

  if (activity.type === "toolCall") {
    console.info("[webui] runtime-tool-call:args", {
      requestId: activity.requestId,
      callId: activity.callId,
      toolName: activity.toolName,
      argumentsJson: stringifyForLog(activity.arguments),
    });
  }

  console.info("[webui] runtime-activity", activity);
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return error instanceof Error ? `[unserializable: ${error.message}]` : "[unserializable]";
  }
}
