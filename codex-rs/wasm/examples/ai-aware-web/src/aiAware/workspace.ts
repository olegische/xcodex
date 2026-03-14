import type { RemoteMcpServerState } from "../../../../ts/host-runtime/src/mcp";
import { loadStoredWorkspaceSnapshot, saveStoredWorkspaceSnapshot, upsertWorkspaceFile } from "../runtime/storage";
import type { MissionStateSummary, PageEventSummary, PageRuntimeSummary } from "../types";
import type { WorkspaceFileSummary } from "../types";
import { ensureWorkspaceDocument } from "../ui/workspace";

export const AI_AWARE_ROOT = "/workspace/ai-aware";
export const AI_AWARE_MANIFEST_PATH = `${AI_AWARE_ROOT}/README.md`;
export const AI_AWARE_MCP_PATH = `${AI_AWARE_ROOT}/mcp-servers.json`;
export const AI_AWARE_SIGNALS_PATH = `${AI_AWARE_ROOT}/web-signals.json`;
export const AI_AWARE_SWARM_PATH = `${AI_AWARE_ROOT}/swarm.json`;
export const AI_AWARE_MISSION_STATE_PATH = `${AI_AWARE_ROOT}/mission-state.json`;
export const AI_AWARE_PAGE_RUNTIME_PATH = `${AI_AWARE_ROOT}/page-runtime.json`;
export const AI_AWARE_EVENT_STREAM_PATH = `${AI_AWARE_ROOT}/event-stream.json`;

export type RemoteMcpServer = {
  id: string;
  name: string;
  url: string;
  status: string;
  authMode: string;
  login: string;
  latencyMs: number;
  scopes: string[];
  tools: string[];
  description: string;
  expiresAt?: number | null;
  lastError?: string | null;
  clientId?: string | null;
};

export type WebSignalSite = {
  domain: string;
  intent: string;
  llmsTxt: boolean;
  schemaCoverage: "high" | "medium" | "low";
  freshness: "live" | "steady" | "slow";
  trustScore: number;
  notes: string[];
};

export type LiveWebSignalSnapshot = {
  domain: string;
  pageUrl: string;
  pageTitle: string;
  llmsTxt: boolean;
  schemaCoverage: "high" | "medium" | "low";
  freshness: "live" | "steady" | "slow";
  trustScore: number;
  notes: string[];
};

export type SwarmMission = {
  objective: string;
  operatingMode: string;
  promise: string;
};

export type SwarmAgent = {
  id: string;
  name: string;
  role: string;
  status: string;
  route: string;
  focus: string;
  artifact: string;
};

export type SwarmDocument = {
  mission: SwarmMission;
  agents: SwarmAgent[];
  handoffs: string[];
};

const DEFAULT_REMOTE_MCP_DOC: { servers: RemoteMcpServer[] } = {
  servers: [],
};

const DEFAULT_WEB_SIGNALS_DOC: { sites: WebSignalSite[] } = {
  sites: [
    {
      domain: "openai.com",
      intent: "product and docs",
      llmsTxt: true,
      schemaCoverage: "high",
      freshness: "live",
      trustScore: 95,
      notes: ["canonical docs", "clear content hierarchy", "dense model-facing metadata"],
    },
    {
      domain: "modelcontextprotocol.io",
      intent: "protocol spec",
      llmsTxt: true,
      schemaCoverage: "medium",
      freshness: "steady",
      trustScore: 91,
      notes: ["machine-readable protocol docs", "good fit for remote tool discovery"],
    },
    {
      domain: "schema.org",
      intent: "semantic vocabulary",
      llmsTxt: false,
      schemaCoverage: "high",
      freshness: "steady",
      trustScore: 88,
      notes: ["entity graph substrate", "rich typed markup", "strong extraction base layer"],
    },
    {
      domain: "product.example",
      intent: "legacy marketing site",
      llmsTxt: false,
      schemaCoverage: "low",
      freshness: "slow",
      trustScore: 37,
      notes: ["hero-copy heavy", "few canonical paths", "needs AI-readability retrofit"],
    },
  ],
};

const DEFAULT_SWARM_DOC: SwarmDocument = {
  mission: {
    objective: "Turn the browser runtime into an AI-aware operating deck, not a chat box.",
    operatingMode: "Browser-native. Page-aware in sandbox, deeper when extension/devtools exists.",
    promise: "No fake desktop powers. Remote MCP, AI-readable web signals and agent lanes only.",
  },
  agents: [
    {
      id: "navigator",
      name: "Navigator",
      role: "Surface mapper",
      status: "running",
      route: "page graph",
      focus: "Entry points, navigation seams, primary user journeys.",
      artifact: "/workspace/ai-aware/site-map.md",
    },
    {
      id: "broker",
      name: "Broker",
      role: "Remote MCP negotiator",
      status: "awaiting login",
      route: "remote mcp",
      focus: "OAuth, scopes, tenant policies, capability routing.",
      artifact: "/workspace/ai-aware/mcp-servers.json",
    },
    {
      id: "forger",
      name: "Forger",
      role: "Artifact builder",
      status: "ready",
      route: "workspace",
      focus: "Structured notes, patches, manifests, long-running research state.",
      artifact: "/workspace/ui/dashboards.json",
    },
    {
      id: "signal",
      name: "Signal",
      role: "AI-readability scanner",
      status: "running",
      route: "metadata mesh",
      focus: "llms.txt, schema.org, feeds, canonicals, trust gaps.",
      artifact: "/workspace/ai-aware/web-signals.json",
    },
  ],
  handoffs: [
    "Navigator -> Signal when a page graph is stable enough to score.",
    "Signal -> Broker when external systems must be queried over remote MCP.",
    "Broker -> Forger when capability login is complete and artifacts can be persisted.",
  ],
};

const DEFAULT_MISSION_STATE_DOC: MissionStateSummary = {
  goal: "No mission running yet.",
  phase: "idle",
  lane: "idle",
  summary: "Set a goal in the mission theater to start the runtime loop.",
  blockers: [],
  steps: [
    {
      id: "observe",
      title: "Observe page context",
      status: "pending",
      detail: "Inspect the browser surface, signals, and interactives.",
    },
    {
      id: "plan",
      title: "Plan the route",
      status: "pending",
      detail: "Decide whether to stay in-page or bridge outward through MCP.",
    },
    {
      id: "act",
      title: "Act through tools",
      status: "pending",
      detail: "Use browser actions or remote tools to move the task forward.",
    },
    {
      id: "persist",
      title: "Persist artifacts",
      status: "pending",
      detail: "Write durable state into the workspace.",
    },
  ],
  updatedAt: null,
};

const DEFAULT_PAGE_RUNTIME_DOC: {
  snapshot: PageRuntimeSummary;
  events: PageEventSummary[];
} = {
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

export async function ensureAiAwareWorkspaceSeed(): Promise<void> {
  await Promise.all([
    ensureWorkspaceDocument(AI_AWARE_MANIFEST_PATH, buildManifestDocument()),
    ensureWorkspaceDocument(AI_AWARE_MCP_PATH, serializeJson(DEFAULT_REMOTE_MCP_DOC)),
    ensureWorkspaceDocument(AI_AWARE_SIGNALS_PATH, serializeJson(DEFAULT_WEB_SIGNALS_DOC)),
    ensureWorkspaceDocument(AI_AWARE_SWARM_PATH, serializeJson(DEFAULT_SWARM_DOC)),
    ensureWorkspaceDocument(AI_AWARE_MISSION_STATE_PATH, serializeJson(DEFAULT_MISSION_STATE_DOC)),
    ensureWorkspaceDocument(AI_AWARE_PAGE_RUNTIME_PATH, serializeJson(DEFAULT_PAGE_RUNTIME_DOC)),
    ensureWorkspaceDocument(AI_AWARE_EVENT_STREAM_PATH, serializeJson({ events: [] })),
  ]);
}

export function readRemoteMcpServers(workspaceFiles: WorkspaceFileSummary[]): RemoteMcpServer[] {
  const payload = readJsonDocument<{ servers?: RemoteMcpServer[] }>(workspaceFiles, AI_AWARE_MCP_PATH, DEFAULT_REMOTE_MCP_DOC);
  return Array.isArray(payload.servers) ? payload.servers : DEFAULT_REMOTE_MCP_DOC.servers;
}

export async function saveRemoteMcpServersSnapshot(states: RemoteMcpServerState[]): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const current = readJsonDocument<{ servers?: RemoteMcpServer[] }>(
    workspace.files.map((file) => ({
      path: file.path,
      content: file.content,
      bytes: file.content.length,
      preview: file.content.slice(0, 240),
    })),
    AI_AWARE_MCP_PATH,
    DEFAULT_REMOTE_MCP_DOC,
  );
  const previousById = new Map(
    (Array.isArray(current.servers) ? current.servers : []).map((server) => [server.id, server]),
  );
  const nextDocument = {
    servers: states.map((state) => {
      const previous = previousById.get(state.serverName);
      return {
        id: state.serverName,
        name: previous?.name ?? prettifyServerName(state.serverName),
        url: state.serverUrl,
        status: state.authStatus,
        authMode: "oauth",
        login: state.authStatus === "connected" ? "authenticated" : "required",
        latencyMs: previous?.latencyMs ?? 0,
        scopes: state.scopes,
        tools: state.tools.map((tool) => tool.originalName),
        description:
          previous?.description ?? `Remote MCP capability lane for ${prettifyServerName(state.serverName)}.`,
        expiresAt: state.expiresAt,
        lastError: state.lastError,
        clientId: state.clientId,
      } satisfies RemoteMcpServer;
    }),
  };
  const nextContent = serializeJson(nextDocument);
  const existing = workspace.files.find((file) => file.path === AI_AWARE_MCP_PATH);
  if (existing?.content === nextContent) {
    return;
  }
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: AI_AWARE_MCP_PATH,
    content: nextContent,
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

export function readWebSignalSites(workspaceFiles: WorkspaceFileSummary[]): WebSignalSite[] {
  const payload = readJsonDocument<{ sites?: WebSignalSite[] }>(workspaceFiles, AI_AWARE_SIGNALS_PATH, DEFAULT_WEB_SIGNALS_DOC);
  return Array.isArray(payload.sites) ? payload.sites : DEFAULT_WEB_SIGNALS_DOC.sites;
}

export async function saveWebSignalSitesSnapshot(snapshot: LiveWebSignalSnapshot): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const current = readJsonDocument<{ sites?: WebSignalSite[] }>(
    workspace.files.map((file) => ({
      path: file.path,
      content: file.content,
      bytes: file.content.length,
      preview: file.content.slice(0, 240),
    })),
    AI_AWARE_SIGNALS_PATH,
    DEFAULT_WEB_SIGNALS_DOC,
  );
  const liveSite: WebSignalSite = {
    domain: snapshot.domain,
    intent: snapshot.pageTitle || "current page",
    llmsTxt: snapshot.llmsTxt,
    schemaCoverage: snapshot.schemaCoverage,
    freshness: snapshot.freshness,
    trustScore: snapshot.trustScore,
    notes: [`live ${snapshot.pageUrl}`, ...snapshot.notes].slice(0, 8),
  };
  const nextDocument = {
    sites: [
      liveSite,
      ...(Array.isArray(current.sites) ? current.sites : []).filter((site) => site.domain !== snapshot.domain),
    ],
  };
  const nextContent = serializeJson(nextDocument);
  const existing = workspace.files.find((file) => file.path === AI_AWARE_SIGNALS_PATH);
  if (existing?.content === nextContent) {
    return;
  }
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: AI_AWARE_SIGNALS_PATH,
    content: nextContent,
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

export function readSwarmDocument(workspaceFiles: WorkspaceFileSummary[]): SwarmDocument {
  return readJsonDocument<SwarmDocument>(workspaceFiles, AI_AWARE_SWARM_PATH, DEFAULT_SWARM_DOC);
}

export function readManifestExcerpt(workspaceFiles: WorkspaceFileSummary[]): string {
  const file = workspaceFiles.find((entry) => entry.path === AI_AWARE_MANIFEST_PATH);
  if (file === undefined) {
    return "Browser-native Codex deck for remote MCP, AI-readable web and multi-agent flow.";
  }
  const excerpt = file.content
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.startsWith("#"))
    .slice(0, 2)
    .join(" ");
  return excerpt || "Browser-native Codex deck for remote MCP, AI-readable web and multi-agent flow.";
}

export function readMissionState(workspaceFiles: WorkspaceFileSummary[]): MissionStateSummary {
  return readJsonDocument<MissionStateSummary>(workspaceFiles, AI_AWARE_MISSION_STATE_PATH, DEFAULT_MISSION_STATE_DOC);
}

export function readPageRuntime(
  workspaceFiles: WorkspaceFileSummary[],
): {
  snapshot: PageRuntimeSummary;
  events: PageEventSummary[];
} {
  return readJsonDocument<{ snapshot: PageRuntimeSummary; events: PageEventSummary[] }>(
    workspaceFiles,
    AI_AWARE_PAGE_RUNTIME_PATH,
    DEFAULT_PAGE_RUNTIME_DOC,
  );
}

export async function saveMissionStateSnapshot(snapshot: MissionStateSummary): Promise<void> {
  await saveWorkspaceJsonDocument(AI_AWARE_MISSION_STATE_PATH, snapshot);
}

export async function savePageRuntimeSnapshot(snapshot: {
  snapshot: PageRuntimeSummary;
  events: PageEventSummary[];
}): Promise<void> {
  await Promise.all([
    saveWorkspaceJsonDocument(AI_AWARE_PAGE_RUNTIME_PATH, snapshot),
    saveWorkspaceJsonDocument(AI_AWARE_EVENT_STREAM_PATH, { events: snapshot.events }),
  ]);
}

function readJsonDocument<T>(workspaceFiles: WorkspaceFileSummary[], path: string, fallback: T): T {
  const file = workspaceFiles.find((entry) => entry.path === path);
  if (file === undefined) {
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(file.content) as T;
  } catch {
    return structuredClone(fallback);
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function saveWorkspaceJsonDocument(path: string, value: unknown): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const nextContent = serializeJson(value);
  const existing = workspace.files.find((file) => file.path === path);
  if (existing?.content === nextContent) {
    return;
  }
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path,
    content: nextContent,
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

function prettifyServerName(serverName: string): string {
  return serverName
    .split(/[_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(" ");
}

function buildManifestDocument(): string {
  return [
    "# AI-Aware Web",
    "",
    "This workspace is the source of truth for a browser-native Codex operating deck.",
    "",
    "Design constraints:",
    "- do not assume local shell, desktop file access, or local MCP processes",
    "- remote MCP over URL is first-class and login state matters",
    "- the browser runtime may live inside a page sandbox or an extension with devtools access",
    "- the web should become machine-readable through llms.txt, schema.org and canonical structure",
    "",
    "Primary runtime docs:",
    `- \`${AI_AWARE_MCP_PATH}\` for remote MCP capability lanes`,
    `- \`${AI_AWARE_SIGNALS_PATH}\` for AI-readability signal maps`,
    `- \`${AI_AWARE_SWARM_PATH}\` for multi-agent mission routing`,
    `- \`${AI_AWARE_MISSION_STATE_PATH}\` for mission execution state`,
    `- \`${AI_AWARE_PAGE_RUNTIME_PATH}\` for page state and browser events`,
    "- `/workspace/ui/*.json` for the live shell itself",
    "",
    "The product goal is simple: the browser becomes the world, the deck, and the artifact forge.",
    "",
  ].join("\n");
}
