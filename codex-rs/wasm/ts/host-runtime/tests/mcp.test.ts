import test from "node:test";
import assert from "node:assert/strict";

import {
  RemoteMcpController,
  createRemoteMcpToolExecutor,
  resolveQualifiedToolName,
} from "../src/mcp.ts";

test("remote MCP controller completes OAuth login and lists tools", async () => {
  const fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];
  const { controller } = createRemoteMcpToolExecutor({
    servers: [
      {
        serverName: "notion",
        serverUrl: "https://mcp.notion.test/mcp",
        oauthScopes: ["read", "search"],
      },
    ],
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : null;
      fetchCalls.push({ url, method, body });

      if (url === "https://mcp.notion.test/.well-known/oauth-protected-resource/mcp") {
        return Response.json({
          authorization_servers: ["https://auth.notion.test"],
        });
      }
      if (url === "https://auth.notion.test/.well-known/oauth-authorization-server") {
        return Response.json({
          authorization_endpoint: "https://auth.notion.test/oauth/authorize",
          token_endpoint: "https://auth.notion.test/oauth/token",
          registration_endpoint: "https://auth.notion.test/oauth/register",
        });
      }
      if (url === "https://auth.notion.test/oauth/register") {
        return Response.json({
          client_id: "client-123",
        });
      }
      if (url === "https://auth.notion.test/oauth/token") {
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url === "https://mcp.notion.test/mcp") {
        const payload = body === null ? {} : (JSON.parse(body) as Record<string, unknown>);
        if (payload.method === "initialize") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: payload.id,
              result: {
                protocolVersion: "2025-06-18",
              },
            }),
            {
              headers: {
                "content-type": "application/json",
                "mcp-session-id": "sess-1",
              },
            },
          );
        }
        if (payload.method === "notifications/initialized") {
          return new Response("", {
            headers: {
              "mcp-session-id": "sess-1",
            },
          });
        }
        if (payload.method === "tools/list") {
          return Response.json({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              tools: [
                {
                  name: "search",
                  description: "Search pages",
                  inputSchema: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                    required: ["query"],
                    additionalProperties: false,
                  },
                },
              ],
            },
          });
        }
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    },
  });

  const start = await controller.beginLogin({
    serverName: "notion",
    redirectUri: "https://app.example/callback",
  });
  assert.equal(start.serverName, "notion");
  assert.match(start.authorizationUrl, /client_id=client-123/);
  assert.match(start.authorizationUrl, /code_challenge=/);

  const callback = new URL("https://app.example/callback");
  callback.searchParams.set("state", new URL(start.authorizationUrl).searchParams.get("state")!);
  callback.searchParams.set("code", "auth-code-1");

  const state = await controller.completeLogin({
    serverName: "notion",
    callbackUrl: callback.toString(),
  });

  assert.equal(state.authStatus, "connected");
  assert.equal(state.toolCount, 1);
  assert.equal(state.tools[0]?.qualifiedName, "mcp__notion__search");
  assert.ok(fetchCalls.some((call) => call.url === "https://auth.notion.test/oauth/token"));
});

test("remote MCP tool executor routes tool invocation", async () => {
  const { controller, toolExecutor } = createRemoteMcpToolExecutor({
    servers: [
      {
        serverName: "notion",
        serverUrl: "https://mcp.notion.test/mcp",
      },
    ],
    fetch: async (input, init) => {
      const url = String(input);
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};

      if (url.endsWith("/.well-known/oauth-protected-resource/mcp")) {
        return Response.json({
          authorization_servers: ["https://auth.notion.test"],
        });
      }
      if (url === "https://auth.notion.test/.well-known/oauth-authorization-server") {
        return Response.json({
          authorization_endpoint: "https://auth.notion.test/oauth/authorize",
          token_endpoint: "https://auth.notion.test/oauth/token",
          registration_endpoint: "https://auth.notion.test/oauth/register",
        });
      }
      if (url === "https://auth.notion.test/oauth/register") {
        return Response.json({ client_id: "client-123" });
      }
      if (url === "https://auth.notion.test/oauth/token") {
        return Response.json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url === "https://mcp.notion.test/mcp" && body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
            },
          }),
          {
            headers: {
              "content-type": "application/json",
              "mcp-session-id": "sess-1",
            },
          },
        );
      }
      if (url === "https://mcp.notion.test/mcp" && body.method === "notifications/initialized") {
        return new Response("", {
          headers: {
            "mcp-session-id": "sess-1",
          },
        });
      }
      if (url === "https://mcp.notion.test/mcp" && body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "search",
                description: "Search pages",
                inputSchema: { type: "object" },
              },
            ],
          },
        });
      }
      if (url === "https://mcp.notion.test/mcp" && body.method === "tools/call") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "match 1" }],
            structuredContent: { count: 1 },
          },
        });
      }

      throw new Error(`Unhandled request ${url}`);
    },
  });

  const start = await controller.beginLogin({
    serverName: "notion",
    redirectUri: "https://app.example/callback",
  });
  const callback = new URL("https://app.example/callback");
  callback.searchParams.set("state", new URL(start.authorizationUrl).searchParams.get("state")!);
  callback.searchParams.set("code", "auth-code-1");
  await controller.completeLogin({
    serverName: "notion",
    callbackUrl: callback.toString(),
  });

  const listedTools = await toolExecutor.list();
  assert.deepEqual(listedTools.tools.map((tool) => tool.name), ["mcp__notion__search"]);

  const invoked = await toolExecutor.invoke({
    callId: "call-1",
    toolName: "mcp__notion__search",
    input: { query: "roadmap" },
  });

  assert.equal(invoked.callId, "call-1");
  assert.deepEqual(invoked.output, {
    content: [{ type: "text", text: "match 1" }],
    structuredContent: { count: 1 },
  });
  assert.deepEqual(resolveQualifiedToolName("mcp__notion__search"), {
    serverName: "notion",
    toolName: "search",
  });
});
