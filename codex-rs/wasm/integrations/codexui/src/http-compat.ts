import type { CodexUiAdapter, CodexUiHttpCompatibility, CodexUiRpcBody, JsonRecord } from "./types";
import { handleCapabilityRoute } from "./capabilities";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function createHttpCompatibility(adapter: CodexUiAdapter): CodexUiHttpCompatibility {
  return {
    async handle(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      const capabilityResponse = await handleCapabilityRoute(adapter, request);
      if (capabilityResponse !== null) {
        return capabilityResponse;
      }
      if (request.method === "POST" && url.pathname === "/codex-api/rpc") {
        return await this.handleRpc(request);
      }
      if (request.method === "GET" && url.pathname === "/codex-api/meta/methods") {
        return await this.handleMethodCatalog();
      }
      if (request.method === "GET" && url.pathname === "/codex-api/meta/notifications") {
        return await this.handleNotificationCatalog();
      }
      if (request.method === "GET" && url.pathname === "/codex-api/server-requests/pending") {
        return await this.handlePendingServerRequests();
      }
      if (request.method === "POST" && url.pathname === "/codex-api/server-requests/respond") {
        return await this.handleRespondServerRequest(request);
      }
      if (request.method === "GET" && url.pathname === "/codex-api/events") {
        return await this.handleEvents();
      }
      if (request.method === "GET" && url.pathname === "/codex-api/ws") {
        return new Response("WebSocket upgrade is not implemented by this compatibility facade", {
          status: 426
        });
      }
      if (url.pathname === "/codex-api" || url.pathname.startsWith("/codex-api/")) {
        return jsonResponse(501, {
          error: `Unsupported codexui compatibility endpoint: ${url.pathname}`
        });
      }
      return null;
    },

    async handleRpc(request: Request): Promise<Response> {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "Invalid body: expected JSON" });
      }

      const record = asRecord(body);
      if (!record || typeof record.method !== "string" || record.method.length === 0) {
        return jsonResponse(400, { error: "Invalid body: expected { method, params? }" });
      }

      const rpcBody: CodexUiRpcBody = {
        method: record.method,
        params: record.params ?? null
      };

      try {
        const result = await adapter.rpc(rpcBody);
        return jsonResponse(200, { result });
      } catch (error) {
        return jsonResponse(500, { error: errorMessage(error, `RPC ${rpcBody.method} failed`) });
      }
    },

    async handleMethodCatalog(): Promise<Response> {
      try {
        const data = await adapter.methodCatalog();
        return jsonResponse(200, { data });
      } catch (error) {
        return jsonResponse(500, { error: errorMessage(error, "Failed to read method catalog") });
      }
    },

    async handleNotificationCatalog(): Promise<Response> {
      try {
        const data = await adapter.notificationCatalog();
        return jsonResponse(200, { data });
      } catch (error) {
        return jsonResponse(500, { error: errorMessage(error, "Failed to read notification catalog") });
      }
    },

    async handlePendingServerRequests(): Promise<Response> {
      try {
        const data = await adapter.listPendingServerRequests();
        return jsonResponse(200, { data });
      } catch (error) {
        return jsonResponse(500, { error: errorMessage(error, "Failed to list pending server requests") });
      }
    },

    async handleRespondServerRequest(request: Request): Promise<Response> {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "Invalid body: expected JSON" });
      }
      const record = asRecord(body);
      if (!record || typeof record.id !== "number") {
        return jsonResponse(400, { error: "Invalid body: expected { id, result?, error? }" });
      }

      try {
        await adapter.respondServerRequest({
          id: record.id,
          result: record.result,
          error: asRecord(record.error) && typeof asRecord(record.error)?.message === "string"
            ? {
                code:
                  typeof asRecord(record.error)?.code === "number"
                    ? (asRecord(record.error)?.code as number)
                    : undefined,
                message: asRecord(record.error)?.message as string,
                data: asRecord(record.error)?.data
              }
            : undefined
        });
        return jsonResponse(200, { ok: true });
      } catch (error) {
        return jsonResponse(500, {
          error: errorMessage(error, "Failed to respond to server request")
        });
      }
    },

    async handleEvents(): Promise<Response> {
      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let keepAlive: ReturnType<typeof globalThis.setInterval> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)
          );
          unsubscribe = adapter.subscribeNotifications((notification) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(notification)}\n\n`));
          });
          keepAlive = globalThis.setInterval(() => {
            controller.enqueue(encoder.encode(": ping\n\n"));
          }, 15000);
        },
        cancel() {
          unsubscribe?.();
          if (keepAlive !== null) {
            globalThis.clearInterval(keepAlive);
          }
          return undefined;
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "cache-control": "no-cache, no-transform",
          "content-type": "text/event-stream; charset=utf-8"
        }
      });
    }
  };
}
