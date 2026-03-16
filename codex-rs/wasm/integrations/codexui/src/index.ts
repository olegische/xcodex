import type { AppServerClientEvent } from "../../../apps/webui/src/runtime/app-server-client";
import {
  CODEX_UI_COMPAT_METHOD_CATALOG,
  CODEX_UI_COMPAT_NOTIFICATION_CATALOG
} from "./catalog";
import { installCodexUiBrowserCompat } from "./browser-compat";
import { createHttpCompatibility } from "./http-compat";
import { NotificationStream } from "./notification-stream";
import { createRuntimeAndClient } from "./runtime-host";
import { PendingServerRequestStore } from "./server-requests";
import type {
  CodexUiAdapter,
  CodexUiAdapterOptions,
  CodexUiNotification,
  CodexUiPendingServerRequest,
  CodexUiRpcBody,
  CodexUiServerRequestReply
} from "./types";

function notification(method: string, params: unknown, atIso = new Date().toISOString()): CodexUiNotification {
  return { method, params, atIso };
}

export async function createCodexUiAdapter(options: CodexUiAdapterOptions): Promise<CodexUiAdapter> {
  const { client } = await createRuntimeAndClient(options);
  const notifications = new NotificationStream();
  const pendingServerRequests = new PendingServerRequestStore();
  let disposed = false;
  let pump: Promise<void> | null = null;

  const startPump = () => {
    if (pump !== null) {
      return;
    }
    pump = (async () => {
      while (!disposed) {
        const event = await client.nextEvent();
        if (event === null) {
          return;
        }
        processEvent(event);
      }
    })();
  };

  const processEvent = (event: AppServerClientEvent) => {
    if (event.type === "lagged") {
      notifications.emit(
        notification("error", {
          message: `Notification stream lagged by ${event.skipped} event(s)`
        })
      );
      return;
    }

    if (event.type === "notification") {
      notifications.emit(notification(event.notification.method, event.notification.params));
      if (event.notification.method === "serverRequest/resolved") {
        const resolved = normalizeResolvedNotification(event.notification.params);
        if (resolved === null) {
          return;
        }
        const pending = pendingServerRequests.takeByRuntimeId(resolved.runtimeId);
        if (pending === null) {
          return;
        }
        notifications.emit(
          notification("server/request/resolved", {
            id: pending.compatId,
            method: pending.method,
            resolvedAtIso: new Date().toISOString()
          })
        );
      }
      return;
    }

    const pending = pendingServerRequests.create(
      event.request.method,
      event.request.id,
      event.request.params
    );
    notifications.emit(
      notification("server/request", {
        id: pending.compatId,
        method: pending.method,
        params: pending.params,
        receivedAtIso: pending.receivedAtIso
      }, pending.receivedAtIso)
    );
  };

  startPump();

  const adapter: CodexUiAdapter = {
    async rpc<T = unknown>(body: CodexUiRpcBody) {
      if (body.method === "setDefaultModel") {
        const model = readStringParam(body.params, "model");
        if (!model) {
          throw new Error("setDefaultModel requires model");
        }
        await client.requestTyped({
          id: `codexui:${crypto.randomUUID()}`,
          method: "config/value/write",
          params: {
            keyPath: "model",
            value: model,
            mergeStrategy: "replace",
            filePath: null,
            expectedVersion: null
          }
        });
        return null as T;
      }

      if (body.method === "generate-thread-title") {
        const prompt = readStringParam(body.params, "prompt");
        return { title: generateThreadTitle(prompt) } as T;
      }

      return await client.requestTyped<T>({
        id: `codexui:${crypto.randomUUID()}`,
        method: body.method,
        params: body.params ?? null
      });
    },

    subscribeNotifications(cb) {
      return notifications.subscribe(cb);
    },

    async listPendingServerRequests(): Promise<CodexUiPendingServerRequest[]> {
      return pendingServerRequests.list().map((entry) => ({
        id: entry.compatId,
        method: entry.method,
        params: entry.params,
        receivedAtIso: entry.receivedAtIso
      }));
    },

    async respondServerRequest(body: CodexUiServerRequestReply): Promise<void> {
      const pending = pendingServerRequests.getByCompatId(body.id);
      if (pending === null) {
        throw new Error(`No pending server request found for id ${body.id}`);
      }

      if (body.error) {
        await client.rejectServerRequest(pending.runtimeId, {
          code: body.error.code ?? -32000,
          message: body.error.message,
          data: body.error.data as never
        });
        return;
      }

      await client.resolveServerRequest(pending.runtimeId, (body.result ?? {}) as never);
    },

    async methodCatalog(): Promise<string[]> {
      return [...CODEX_UI_COMPAT_METHOD_CATALOG];
    },

    async notificationCatalog(): Promise<string[]> {
      return [...CODEX_UI_COMPAT_NOTIFICATION_CATALOG];
    },

    http() {
      return createHttpCompatibility(adapter);
    },

    async dispose(): Promise<void> {
      disposed = true;
      await client.shutdown();
      await pump;
    }
  };

  return adapter;
}

function readStringParam(params: unknown, key: string): string {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return "";
  }
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function generateThreadTitle(prompt: string): string {
  const flattened = prompt
    .replaceAll(/\s+/g, " ")
    .replaceAll(/^#+\s*/g, "")
    .trim();
  if (flattened.length === 0) {
    return "";
  }
  const withoutAttachmentPrefix = flattened.replace(/^Files mentioned by the user:\s*/i, "").trim();
  const candidate = withoutAttachmentPrefix.length > 0 ? withoutAttachmentPrefix : flattened;
  if (candidate.length <= 60) {
    return candidate;
  }
  const words = candidate.split(" ");
  let title = "";
  for (const word of words) {
    const next = title.length === 0 ? word : `${title} ${word}`;
    if (next.length > 60) {
      break;
    }
    title = next;
  }
  return title || candidate.slice(0, 60).trim();
}

function normalizeResolvedNotification(params: unknown): { runtimeId: string | number } | null {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const runtimeId = "requestId" in params ? params.requestId : null;
  if (typeof runtimeId !== "string" && typeof runtimeId !== "number") {
    return null;
  }
  return { runtimeId };
}

export {
  installCodexUiBrowserCompat,
  CODEX_UI_COMPAT_METHOD_CATALOG,
  CODEX_UI_COMPAT_NOTIFICATION_CATALOG
};

export type {
  CodexUiAdapter,
  CodexUiAdapterOptions,
  CodexUiBrowserCompatHandle,
  CodexUiBrowserCompatOptions,
  CodexUiHttpCompatibility,
  CodexUiNotification,
  CodexUiPendingServerRequest,
  CodexUiRpcBody,
  CodexUiServerRequestReply
} from "./types";
