import { DEFAULT_UI_LAYOUT } from "./layout";
import { DEFAULT_UI_WIDGETS } from "./widgets";
import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { normalizeDashboardsDocument } from "./validators";
import type { UiDashboardsDocument } from "./types";

export const UI_DASHBOARDS_PATH = "/workspace/ui/dashboards.json";
export const UI_DASHBOARDS_GUIDE_PATH = "/workspace/ui/dashboards.README.md";

export const DEFAULT_UI_DASHBOARDS: UiDashboardsDocument = {
  dashboards: [
    {
      id: "mission",
      name: "Chat",
      description: "Chat-first browser demo with citations, tools, and artifacts.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "center",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "mission_state", title: "Chat" },
            { id: "page_state", title: "Surface" },
          ],
          mainBody: [{ id: "remote_mcp", title: "Capability Bridges" }],
          inspector: [
            { id: "citations", title: "Citations" },
            { id: "workspace_files", title: "Artifacts" },
            { id: "session_status", title: "Runtime Status" },
          ],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        metrics: {
          items: ["view", "model", "tools", "workspace", "events"],
        },
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["workspace", "metrics", "settings"],
        },
      },
    },
    {
      id: "street",
      name: "Page",
      description: "Browser surface, AI-readable signals, and zone-local page observations.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "right",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "page_state", title: "Surface" },
            { id: "web_signals", title: "Signals" },
          ],
          mainBody: [{ id: "mission_state", title: "Chat Flow" }],
          inspector: [
            { id: "citations", title: "Citations" },
            { id: "remote_mcp", title: "Capability Bridges" },
            { id: "workspace_files", title: "Artifacts" },
          ],
        },
      },
      widgets: structuredClone(DEFAULT_UI_WIDGETS),
    },
    {
      id: "control",
      name: "Status",
      description: "Runtime pulse, capability telemetry, queue health, and shell pressure.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "left",
        inspectorMode: "column",
        defaultInspectorTab: "status",
        areas: {
          mainTop: [
            { id: "metrics", title: "Runtime Pulse" },
            { id: "session_status", title: "Runtime State" },
          ],
          mainBody: [
            { id: "tool_activity", title: "Capability Telemetry" },
            { id: "plan_status", title: "Current Plan" },
          ],
          inspector: [
            { id: "approvals", title: "Approvals" },
            { id: "citations", title: "Citations" },
            { id: "workspace_files", title: "Artifacts" },
          ],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["status", "plan", "tools", "workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["metrics", "approvals", "settings"],
        },
      },
    },
    {
      id: "signals",
      name: "Signals",
      description: "AI-readable scoring, metadata quality, and surface signal gaps.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "right",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "page_state", title: "Current Surface" },
            { id: "web_signals", title: "Signal Scan" },
          ],
          mainBody: [{ id: "mission_state", title: "Chat Pressure" }],
          inspector: [{ id: "remote_mcp", title: "Capability Bridges" }],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["workspace", "settings"],
        },
      },
    },
    {
      id: "status",
      name: "Events",
      description: "Runtime status, approvals, citations, and artifacts.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "left",
        inspectorMode: "column",
        defaultInspectorTab: "status",
        areas: {
          mainTop: [{ id: "mission_state", title: "Chat" }],
          mainBody: [{ id: "session_status", title: "Runtime Status" }],
          mainBottom: [{ id: "plan_status", title: "Plan" }],
          inspector: [
            { id: "approvals", title: "Approvals" },
            { id: "citations", title: "Citations" },
            { id: "workspace_files", title: "Artifacts" },
          ],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        approvals: {
          compact: true,
        },
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["status", "plan", "tools", "workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["approvals", "metrics", "settings"],
        },
      },
    },
    {
      id: "artifacts",
      name: "Artifacts",
      description: "Workspace-first mode for anchored outputs, actor state, and persistent zone memory.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "right",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "mission_state", title: "Chat" },
            { id: "workspace_files", title: "Artifacts" },
          ],
          mainBody: [
            { id: "agent_swarm", title: "Actors and Anchors" },
            { id: "plan_status", title: "Execution Queue" },
          ],
          inspector: [
            { id: "citations", title: "Citations" },
            { id: "session_status", title: "Runtime Pulse" },
            { id: "metrics", title: "Workspace Metrics" },
          ],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        workspaceFiles: {
          maxItems: 14,
          showPreview: true,
        },
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["workspace", "plan", "tools", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["workspace", "tools", "settings"],
        },
      },
    },
    {
      id: "access",
      name: "Tools",
      description: "Remote MCP bridges and authentication flow.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "left",
        inspectorMode: "column",
        defaultInspectorTab: "tools",
        areas: {
          mainTop: [{ id: "remote_mcp", title: "Capability Bridges" }],
          mainBody: [],
          mainBottom: [],
          inspector: [],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["tools", "workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["tools", "workspace", "settings"],
        },
      },
    },
  ],
};

export async function ensureUiDashboardsDocument(): Promise<UiDashboardsDocument> {
  const content = await ensureWorkspaceDocument(UI_DASHBOARDS_PATH, serializeDashboardsDocument(DEFAULT_UI_DASHBOARDS));
  await ensureWorkspaceDocument(UI_DASHBOARDS_GUIDE_PATH, buildDashboardsGuide());
  return parseDashboardsDocument(content);
}

export function subscribeUiDashboards(listener: (document: UiDashboardsDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiDashboardsDocument());
  });
}

function parseDashboardsDocument(content: string): UiDashboardsDocument {
  try {
    return mergeDefaultDashboards(normalizeDashboardsDocument(JSON.parse(content) as unknown, DEFAULT_UI_DASHBOARDS));
  } catch {
    return structuredClone(DEFAULT_UI_DASHBOARDS);
  }
}

function serializeDashboardsDocument(document: UiDashboardsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildDashboardsGuide(): string {
  return [
    "# Runtime UI Dashboards",
    "",
    `Edit \`${UI_DASHBOARDS_PATH}\` to define named dashboards with task-specific layout/widget overrides.`,
    "",
    "Each dashboard can override:",
    "- `layout`",
    "- `widgets`",
    "",
  ].join("\n");
}

function mergeDefaultDashboards(document: UiDashboardsDocument): UiDashboardsDocument {
  const customDashboards = document.dashboards.filter(
    (dashboard) => !DEFAULT_UI_DASHBOARDS.dashboards.some((defaultDashboard) => defaultDashboard.id === dashboard.id),
  );
  return {
    dashboards: [...DEFAULT_UI_DASHBOARDS.dashboards, ...customDashboards],
  };
}
