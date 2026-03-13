import { bootStore } from "../stores/boot";
import { inspectorStore } from "../stores/inspector";
import { runtimeUiStore } from "../stores/runtime-ui";
import { uiSystemStore } from "../stores/ui-system";
import { workspaceBrowserStore } from "../stores/workspace-browser";
import { subscribeRuntimeActivity } from "../runtime";
import { connectComposerSessionSync } from "./controllers";
import { initializeApp } from "./actions";

export function setupAppLifecycle(options?: {
  onReady?: () => void;
  onError?: () => void;
}): () => void {
  bootStore.setPhase("shell", "Rendering shell");
  const deltaLogState = new Map<string, { count: number; announcedStreaming: boolean }>();

  let disconnectComposerSessionSync = () => {};
  let unsubscribeRuntimeActivity = () => {};
  let unsubscribeUiSystem = () => {};
  let disconnectWorkspaceBrowser = () => {};

  void (async () => {
    bootStore.setPhase("ui", "Loading UI system");
    const ok = await initializeApp();
    if (!ok) {
      bootStore.setPhase("error", "Runtime startup failed");
      options?.onError?.();
      return;
    }

    disconnectComposerSessionSync = connectComposerSessionSync();
    unsubscribeRuntimeActivity = subscribeRuntimeActivity((activity) => {
      logRuntimeActivity(activity, deltaLogState);
      runtimeUiStore.observeActivity(activity);
    });

    bootStore.setPhase("runtime", "Connecting runtime subscriptions");
    unsubscribeUiSystem = uiSystemStore.subscribeToWorkspace((nextSystem) => {
      inspectorStore.setDefaultTab(nextSystem.layout.defaultInspectorTab);
    });

    bootStore.setPhase("workspace", "Loading browser workspace");
    disconnectWorkspaceBrowser = await workspaceBrowserStore.initialize();

    bootStore.setPhase("ready", "Runtime ready");
    options?.onReady?.();
  })().catch((error) => {
    console.error("[webui] lifecycle:failed", error);
    bootStore.setPhase("error", "Lifecycle startup failed");
    options?.onError?.();
  });

  return () => {
    disconnectComposerSessionSync();
    unsubscribeRuntimeActivity();
    unsubscribeUiSystem();
    disconnectWorkspaceBrowser();
  };
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

  if (activity.type === "assistantMessage") {
    return;
  }

  console.info("[webui] runtime-activity", activity);
}
