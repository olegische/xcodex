import type { RemoteMcpServerState } from "../../../../../wasm-arch/ts/host-runtime/src/mcp";
import {
  loadStoredWorkspaceSnapshot,
  saveStoredWorkspaceSnapshot,
  upsertWorkspaceFile,
} from "../runtime/storage";
import type {
  ApsixActorSummary,
  ApsixAnchorSummary,
  ApsixArtifactSummary,
  ApsixCitationSourceSummary,
  ApsixLedgerEventSummary,
  ApsixZoneSummary,
  PageEventSummary,
  PageRuntimeSummary,
  WorkspaceFileSummary,
} from "../types";
import { ensureWorkspaceDocument } from "../ui/workspace";

export const APSIX_ROOT = "/workspace/apsix";
export const APSIX_MANIFEST_PATH = `${APSIX_ROOT}/README.md`;
export const APSIX_MCP_PATH = `${APSIX_ROOT}/mcp-servers.json`;
export const APSIX_SIGNALS_PATH = `${APSIX_ROOT}/web-signals.json`;
export const APSIX_PAGE_RUNTIME_PATH = `${APSIX_ROOT}/page-runtime.json`;
export const APSIX_ZONE_STATE_PATH = `${APSIX_ROOT}/zone-state.json`;
export const APSIX_ACTORS_PATH = `${APSIX_ROOT}/actors.json`;
export const APSIX_ARTIFACTS_PATH = `${APSIX_ROOT}/artifacts.json`;
export const APSIX_ANCHORS_PATH = `${APSIX_ROOT}/anchors.json`;
export const APSIX_EVENT_LOG_PATH = `${APSIX_ROOT}/event-log.json`;
export const APSIX_SOURCES_PATH = `${APSIX_ROOT}/sources.json`;

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

export type ApsixWorkspaceSnapshot = {
  zone: ApsixZoneSummary;
  actors: ApsixActorSummary[];
  artifacts: ApsixArtifactSummary[];
  anchors: ApsixAnchorSummary[];
  events: ApsixLedgerEventSummary[];
  sources: ApsixCitationSourceSummary[];
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
  ],
};

const DEFAULT_ZONE_STATE_DOC: ApsixZoneSummary = {
  zoneId: null,
  target: null,
  lifecycleState: "idle",
  phase: "idle",
  summary: "Submit a target to create a zone and start an APSIX run.",
  spawnPolicyVersion: null,
  spawnBudgetTotal: 0,
  spawnBudgetUsed: 0,
  environmentStatus: "pending",
  environmentSummary: "Spawn preparation has not run yet.",
  environmentMutableRefs: [],
  environmentProtectedRefs: [],
  environmentPreparedAt: null,
  environmentVerifiedAt: null,
  authoritativeStateRef: null,
  spawnRequestId: null,
  spawnDecision: null,
  spawnReasonCode: null,
  activeActorId: null,
  artifactIds: [],
  blockers: [],
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

export async function ensureApsixWorkspaceSeed(): Promise<void> {
  await Promise.all([
    ensureWorkspaceDocument(APSIX_MANIFEST_PATH, buildManifestDocument()),
    ensureWorkspaceDocument(APSIX_MCP_PATH, serializeJson(DEFAULT_REMOTE_MCP_DOC)),
    ensureWorkspaceDocument(APSIX_SIGNALS_PATH, serializeJson(DEFAULT_WEB_SIGNALS_DOC)),
    ensureWorkspaceDocument(APSIX_PAGE_RUNTIME_PATH, serializeJson(DEFAULT_PAGE_RUNTIME_DOC)),
    ensureWorkspaceDocument(APSIX_ZONE_STATE_PATH, serializeJson(DEFAULT_ZONE_STATE_DOC)),
    ensureWorkspaceDocument(APSIX_ACTORS_PATH, serializeJson({ actors: [] })),
    ensureWorkspaceDocument(APSIX_ARTIFACTS_PATH, serializeJson({ artifacts: [] })),
    ensureWorkspaceDocument(APSIX_ANCHORS_PATH, serializeJson({ anchors: [] })),
    ensureWorkspaceDocument(APSIX_EVENT_LOG_PATH, serializeJson({ events: [] })),
    ensureWorkspaceDocument(APSIX_SOURCES_PATH, serializeJson({ sources: [] })),
  ]);
}

export async function ensureAiAwareWorkspaceSeed(): Promise<void> {
  await ensureApsixWorkspaceSeed();
}

export function readRemoteMcpServers(workspaceFiles: WorkspaceFileSummary[]): RemoteMcpServer[] {
  const payload = readJsonDocument<{ servers?: RemoteMcpServer[] }>(
    workspaceFiles,
    APSIX_MCP_PATH,
    DEFAULT_REMOTE_MCP_DOC,
  );
  return Array.isArray(payload.servers) ? payload.servers : DEFAULT_REMOTE_MCP_DOC.servers;
}

export async function saveRemoteMcpServersSnapshot(states: RemoteMcpServerState[]): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const current = readJsonDocument<{ servers?: RemoteMcpServer[] }>(
    asWorkspaceFiles(workspace),
    APSIX_MCP_PATH,
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
        description: previous?.description ?? `Remote MCP capability lane for ${prettifyServerName(state.serverName)}.`,
        expiresAt: state.expiresAt,
        lastError: state.lastError,
        clientId: state.clientId,
      } satisfies RemoteMcpServer;
    }),
  };
  await saveWorkspaceJsonDocument(APSIX_MCP_PATH, nextDocument, workspace);
}

export function readWebSignalSites(workspaceFiles: WorkspaceFileSummary[]): WebSignalSite[] {
  const payload = readJsonDocument<{ sites?: WebSignalSite[] }>(
    workspaceFiles,
    APSIX_SIGNALS_PATH,
    DEFAULT_WEB_SIGNALS_DOC,
  );
  return Array.isArray(payload.sites) ? payload.sites : DEFAULT_WEB_SIGNALS_DOC.sites;
}

export async function saveWebSignalSitesSnapshot(snapshot: LiveWebSignalSnapshot): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const current = readJsonDocument<{ sites?: WebSignalSite[] }>(
    asWorkspaceFiles(workspace),
    APSIX_SIGNALS_PATH,
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
  await saveWorkspaceJsonDocument(APSIX_SIGNALS_PATH, nextDocument, workspace);
}

export function readManifestExcerpt(workspaceFiles: WorkspaceFileSummary[]): string {
  const file = workspaceFiles.find((entry) => entry.path === APSIX_MANIFEST_PATH);
  if (file === undefined) {
    return "APSIX browser runtime with target-defined zones, anchored artifacts, and replayable state.";
  }
  const excerpt = file.content
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.startsWith("#"))
    .slice(0, 2)
    .join(" ");
  return excerpt || "APSIX browser runtime with target-defined zones, anchored artifacts, and replayable state.";
}

export function readPageRuntime(
  workspaceFiles: WorkspaceFileSummary[],
): {
  snapshot: PageRuntimeSummary;
  events: PageEventSummary[];
} {
  return readJsonDocument<{ snapshot: PageRuntimeSummary; events: PageEventSummary[] }>(
    workspaceFiles,
    APSIX_PAGE_RUNTIME_PATH,
    DEFAULT_PAGE_RUNTIME_DOC,
  );
}

export async function savePageRuntimeSnapshot(snapshot: {
  snapshot: PageRuntimeSummary;
  events: PageEventSummary[];
}): Promise<void> {
  await saveWorkspaceJsonDocument(APSIX_PAGE_RUNTIME_PATH, snapshot);
}

export function readApsixZoneState(workspaceFiles: WorkspaceFileSummary[]): ApsixZoneSummary {
  return readJsonDocument<ApsixZoneSummary>(workspaceFiles, APSIX_ZONE_STATE_PATH, DEFAULT_ZONE_STATE_DOC);
}

export function readApsixActors(workspaceFiles: WorkspaceFileSummary[]): ApsixActorSummary[] {
  const payload = readJsonDocument<{ actors?: ApsixActorSummary[] }>(workspaceFiles, APSIX_ACTORS_PATH, { actors: [] });
  return Array.isArray(payload.actors) ? payload.actors : [];
}

export function readApsixArtifacts(workspaceFiles: WorkspaceFileSummary[]): ApsixArtifactSummary[] {
  const payload = readJsonDocument<{ artifacts?: ApsixArtifactSummary[] }>(workspaceFiles, APSIX_ARTIFACTS_PATH, {
    artifacts: [],
  });
  return Array.isArray(payload.artifacts) ? payload.artifacts : [];
}

export function readApsixAnchors(workspaceFiles: WorkspaceFileSummary[]): ApsixAnchorSummary[] {
  const payload = readJsonDocument<{ anchors?: ApsixAnchorSummary[] }>(workspaceFiles, APSIX_ANCHORS_PATH, {
    anchors: [],
  });
  return Array.isArray(payload.anchors) ? payload.anchors : [];
}

export function readApsixEventLog(workspaceFiles: WorkspaceFileSummary[]): ApsixLedgerEventSummary[] {
  const payload = readJsonDocument<{ events?: ApsixLedgerEventSummary[] }>(workspaceFiles, APSIX_EVENT_LOG_PATH, {
    events: [],
  });
  return Array.isArray(payload.events) ? payload.events : [];
}

export function readApsixSources(workspaceFiles: WorkspaceFileSummary[]): ApsixCitationSourceSummary[] {
  const payload = readJsonDocument<{ sources?: ApsixCitationSourceSummary[] }>(workspaceFiles, APSIX_SOURCES_PATH, {
    sources: [],
  });
  return Array.isArray(payload.sources) ? payload.sources : [];
}

export async function saveApsixWorkspaceSnapshot(snapshot: ApsixWorkspaceSnapshot): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: APSIX_ZONE_STATE_PATH,
    content: serializeJson(snapshot.zone),
  });
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: APSIX_ACTORS_PATH,
    content: serializeJson({ actors: snapshot.actors }),
  });
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: APSIX_ARTIFACTS_PATH,
    content: serializeJson({ artifacts: snapshot.artifacts }),
  });
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: APSIX_ANCHORS_PATH,
    content: serializeJson({ anchors: snapshot.anchors }),
  });
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: APSIX_EVENT_LOG_PATH,
    content: serializeJson({ events: snapshot.events }),
  });
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: APSIX_SOURCES_PATH,
    content: serializeJson({ sources: snapshot.sources }),
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

export async function saveApsixArtifactBody(artifactId: string, content: string): Promise<string> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const path = `${APSIX_ROOT}/generated/${artifactId}.md`;
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path,
    content,
  });
  await saveStoredWorkspaceSnapshot(workspace);
  return path;
}

function asWorkspaceFiles(workspace: Awaited<ReturnType<typeof loadStoredWorkspaceSnapshot>>): WorkspaceFileSummary[] {
  return workspace.files.map((file) => ({
    path: file.path,
    content: file.content,
    bytes: file.content.length,
    preview: file.content.slice(0, 240),
  }));
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

async function saveWorkspaceJsonDocument(
  path: string,
  value: unknown,
  workspace?: Awaited<ReturnType<typeof loadStoredWorkspaceSnapshot>>,
): Promise<void> {
  const resolvedWorkspace = workspace ?? (await loadStoredWorkspaceSnapshot());
  const nextContent = serializeJson(value);
  const existing = resolvedWorkspace.files.find((file) => file.path === path);
  if (existing?.content === nextContent) {
    return;
  }
  resolvedWorkspace.files = upsertWorkspaceFile(resolvedWorkspace.files, {
    path,
    content: nextContent,
  });
  await saveStoredWorkspaceSnapshot(resolvedWorkspace);
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
    "# APSIX Web",
    "",
    "This workspace is the source of truth for an APSIX browser runtime.",
    "",
    "Design constraints:",
    "- the target defines the zone",
    "- user-supplied targets remain unvalidated external input",
    "- spawn may admit a single actor or a larger population",
    "- generated artifacts are not authoritative until anchored",
    "- freeze closes the zone after authoritative outputs exist",
    "",
    "Primary runtime docs:",
    `- \`${APSIX_ZONE_STATE_PATH}\` for current zone lifecycle`,
    `- \`${APSIX_ACTORS_PATH}\` for admitted actors and run posture`,
    `- \`${APSIX_ARTIFACTS_PATH}\` for generated and anchored artifacts`,
    `- \`${APSIX_ANCHORS_PATH}\` for anchor decisions`,
    `- \`${APSIX_EVENT_LOG_PATH}\` for ordered lifecycle events`,
    `- \`${APSIX_SOURCES_PATH}\` for citation sources and evidence keys`,
    `- \`${APSIX_MCP_PATH}\` for remote MCP capability lanes`,
    `- \`${APSIX_SIGNALS_PATH}\` for AI-readable web signals`,
    `- \`${APSIX_PAGE_RUNTIME_PATH}\` for page state and browser events`,
    "- `/workspace/ui/*.json` for the live shell itself",
    "",
    "The browser is not a fake desktop. It is one APSIX runtime substrate.",
    "",
  ].join("\n");
}
