#!/usr/bin/env node

// Vendored and adapted from xcodexui (MIT):
// https://github.com/olegische/xcodexui
//
// This is a minimal browser-facing bridge for the local `codex app-server`.
// It exposes only the endpoints needed by the wasm webui Local Codex transport.

import { spawn } from "node:child_process";
import http from "node:http";

const DEFAULT_PORT = 5999;

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--port" || arg === "-p") && typeof argv[index + 1] === "string") {
      const parsed = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        port = parsed;
      }
      index += 1;
    }
  }
  return { port };
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = typeof req.headers.origin === "string" && req.headers.origin.length > 0
    ? req.headers.origin
    : "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

class CodexAppServerProcess {
  constructor() {
    this.process = null;
    this.initialized = false;
    this.initializePromise = null;
    this.readBuffer = "";
    this.nextId = 1;
    this.stopping = false;
    this.pending = new Map();
    this.notificationListeners = new Set();
    this.pendingServerRequests = new Map();
    this.appServerArgs = [
      "app-server",
      "-c",
      'approval_policy="never"',
      "-c",
      'sandbox_mode="danger-full-access"',
    ];
  }

  start() {
    if (this.process !== null) {
      return;
    }

    this.stopping = false;
    const proc = spawn("codex", this.appServerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = proc;

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      this.readBuffer += chunk;

      let lineEnd = this.readBuffer.indexOf("\n");
      while (lineEnd !== -1) {
        const line = this.readBuffer.slice(0, lineEnd).trim();
        this.readBuffer = this.readBuffer.slice(lineEnd + 1);
        if (line.length > 0) {
          this.handleLine(line);
        }
        lineEnd = this.readBuffer.indexOf("\n");
      }
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", () => {
      // Keep stderr quiet; request failures are returned via JSON-RPC.
    });

    proc.on("exit", () => {
      const failure = new Error(
        this.stopping ? "codex app-server stopped" : "codex app-server exited unexpectedly",
      );
      for (const request of this.pending.values()) {
        request.reject(failure);
      }

      this.pending.clear();
      this.pendingServerRequests.clear();
      this.process = null;
      this.initialized = false;
      this.initializePromise = null;
      this.readBuffer = "";
    });
  }

  sendLine(payload) {
    if (this.process === null) {
      throw new Error("codex app-server is not running");
    }
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  notify(method, params) {
    this.start();
    const payload = { method };
    if (params !== undefined) {
      payload.params = params;
    }
    this.sendLine(payload);
  }

  emitNotification(notification) {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  handleServerRequest(requestId, method, params) {
    const pendingRequest = {
      id: requestId,
      method,
      params,
      receivedAtIso: new Date().toISOString(),
    };
    this.pendingServerRequests.set(requestId, pendingRequest);
    this.emitNotification({
      method: "server/request",
      params: pendingRequest,
    });
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pendingRequest = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (pendingRequest === undefined) {
        return;
      }

      if (message.error) {
        pendingRequest.reject(new Error(message.error.message));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string" && typeof message.id !== "number") {
      this.emitNotification({
        method: message.method,
        params: message.params ?? null,
      });
      return;
    }

    if (typeof message.id === "number" && typeof message.method === "string") {
      this.handleServerRequest(message.id, message.method, message.params ?? null);
    }
  }

  async call(method, params) {
    this.start();
    const id = this.nextId;
    this.nextId += 1;

    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendLine({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    });
  }

  async ensureInitialized() {
    if (this.initialized) {
      return;
    }
    if (this.initializePromise !== null) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = this.call("initialize", {
      clientInfo: {
        name: "xcodex-webui-local-bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    }).then(() => {
      this.notify("initialized");
      this.initialized = true;
    }).finally(() => {
      this.initializePromise = null;
    });

    await this.initializePromise;
  }

  async rpc(method, params) {
    await this.ensureInitialized();
    return await this.call(method, params);
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  sendServerRequestReply(requestId, reply) {
    if (reply.error) {
      this.sendLine({
        jsonrpc: "2.0",
        id: requestId,
        error: reply.error,
      });
      return;
    }

    this.sendLine({
      jsonrpc: "2.0",
      id: requestId,
      result: reply.result ?? {},
    });
  }

  resolvePendingServerRequest(requestId, reply) {
    const pendingRequest = this.pendingServerRequests.get(requestId);
    if (pendingRequest === undefined) {
      throw new Error(`No pending server request found for id ${String(requestId)}`);
    }

    this.pendingServerRequests.delete(requestId);
    this.sendServerRequestReply(requestId, reply);
    this.emitNotification({
      method: "server/request/resolved",
      params: {
        id: requestId,
        method: pendingRequest.method,
        resolvedAtIso: new Date().toISOString(),
      },
    });
  }

  async respondToServerRequest(payload) {
    await this.ensureInitialized();

    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error('Invalid response payload: expected object');
    }

    const id = payload.id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new Error('Invalid response payload: "id" must be an integer');
    }

    const rawError = payload.error;
    if (rawError !== null && typeof rawError === "object" && !Array.isArray(rawError)) {
      const message =
        typeof rawError.message === "string" && rawError.message.trim().length > 0
          ? rawError.message.trim()
          : "Server request rejected by client";
      const code =
        typeof rawError.code === "number" && Number.isFinite(rawError.code)
          ? Math.trunc(rawError.code)
          : -32000;
      this.resolvePendingServerRequest(id, { error: { code, message } });
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(payload, "result")) {
      throw new Error('Invalid response payload: expected "result" or "error"');
    }

    this.resolvePendingServerRequest(id, { result: payload.result });
  }

  listPendingServerRequests() {
    return Array.from(this.pendingServerRequests.values());
  }

  dispose() {
    if (this.process === null) {
      return;
    }

    const proc = this.process;
    this.stopping = true;
    this.process = null;
    this.initialized = false;
    this.initializePromise = null;
    this.readBuffer = "";

    const failure = new Error("codex app-server stopped");
    for (const request of this.pending.values()) {
      request.reject(failure);
    }
    this.pending.clear();
    this.pendingServerRequests.clear();

    try {
      proc.stdin.end();
    } catch {}

    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }, 2000).unref();
  }
}

function createBridgeServer({ port }) {
  const appServer = new CodexAppServerProcess();
  const sseClients = new Set();

  const unsubscribe = appServer.onNotification((notification) => {
    const event = JSON.stringify({
      ...notification,
      atIso: new Date().toISOString(),
    });
    for (const res of sseClients) {
      if (res.writableEnded || res.destroyed) {
        sseClients.delete(res);
        continue;
      }
      res.write(`data: ${event}\n\n`);
    }
  });

  const server = http.createServer(async (req, res) => {
    try {
      applyCors(req, res);

      if (req.url === undefined) {
        writeJson(res, 404, { error: "Missing URL" });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex-api/rpc") {
        const body = await readJsonBody(req);
        if (body === null || typeof body !== "object" || Array.isArray(body) || typeof body.method !== "string") {
          writeJson(res, 400, { error: "Invalid body: expected { method, params? }" });
          return;
        }

        const result = await appServer.rpc(body.method, body.params ?? null);
        writeJson(res, 200, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/codex-api/server-requests/respond") {
        const body = await readJsonBody(req);
        await appServer.respondToServerRequest(body);
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex-api/server-requests/pending") {
        writeJson(res, 200, { data: appServer.listPendingServerRequests() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex-api/meta/methods") {
        writeJson(res, 200, { data: [] });
        return;
      }

      if (req.method === "GET" && url.pathname === "/codex-api/events") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        sseClients.add(res);

        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        const keepAlive = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            res.write(": ping\n\n");
          }
        }, 15000);

        const close = () => {
          clearInterval(keepAlive);
          sseClients.delete(res);
          if (!res.writableEnded) {
            res.end();
          }
        };

        req.on("close", close);
        req.on("aborted", close);
        return;
      }

      writeJson(res, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[local-codex-bridge] ${req.method ?? "?"} ${req.url ?? "?"}: ${error.message}`);
      } else {
        console.error(`[local-codex-bridge] ${req.method ?? "?"} ${req.url ?? "?"}: ${String(error)}`);
      }
      writeJson(res, 502, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const shutdown = () => {
    unsubscribe();
    for (const res of sseClients) {
      if (!res.writableEnded) {
        res.end();
      }
    }
    sseClients.clear();
    server.close();
    appServer.dispose();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, "127.0.0.1", () => {
    console.log(`[local-codex-bridge] listening on http://localhost:${String(port)}`);
  });
}

createBridgeServer(parseArgs(process.argv.slice(2)));
