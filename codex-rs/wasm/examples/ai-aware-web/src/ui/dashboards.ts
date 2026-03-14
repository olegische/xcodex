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
      name: "Mission",
      description: "Goal, execution phase, page state, tools, and event stream around the command theater.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "center",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "mission_state", title: "Mission" },
            { id: "page_state", title: "Page" },
          ],
          mainBody: [{ id: "remote_mcp", title: "Tools" }],
          mainBottom: [{ id: "runtime_events", title: "Event Stream" }],
          inspector: [
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
      description: "Page state, AI-readable signals, and browser event flow.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "right",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "page_state", title: "Page" },
            { id: "web_signals", title: "Signals" },
          ],
          mainBody: [{ id: "mission_state", title: "Mission Flow" }],
          mainBottom: [{ id: "runtime_events", title: "Event Stream" }],
          inspector: [
            { id: "remote_mcp", title: "Tools" },
            { id: "workspace_files", title: "Artifacts" },
          ],
        },
      },
      widgets: structuredClone(DEFAULT_UI_WIDGETS),
    },
    {
      id: "control",
      name: "Status",
      description: "Runtime pulse, tool telemetry, queue health, and shell pressure.",
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
            { id: "tool_activity", title: "Tool Telemetry" },
            { id: "plan_status", title: "Current Plan" },
          ],
          mainBottom: [{ id: "runtime_events", title: "Event Stream" }],
          inspector: [
            { id: "approvals", title: "Approvals" },
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
          headerTrailingActions: ["metrics", "events", "approvals", "settings"],
        },
      },
    },
    {
      id: "signals",
      name: "Signals",
      description: "AI-readable scoring, metadata quality, and page signal gaps.",
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
          mainBody: [{ id: "mission_state", title: "Mission Pressure" }],
          mainBottom: [{ id: "runtime_events", title: "Event Stream" }],
          inspector: [{ id: "remote_mcp", title: "Tools" }],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["workspace", "events", "settings"],
        },
      },
    },
    {
      id: "status",
      name: "Events",
      description: "Chronological event stream for model turns, page activity, and runtime state changes.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "left",
        inspectorMode: "hidden",
        defaultInspectorTab: "events",
        areas: {
          mainTop: [{ id: "mission_state", title: "Mission" }],
          mainBody: [{ id: "runtime_events", title: "Unified Event Stream" }],
          mainBottom: [{ id: "tool_activity", title: "Tool Telemetry" }],
          inspector: [],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        runtimeEvents: {
          compact: true,
        },
        approvals: {
          compact: true,
        },
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["status", "plan", "tools", "workspace", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["events", "approvals", "metrics", "settings"],
        },
      },
    },
    {
      id: "artifacts",
      name: "Artifacts",
      description: "Workspace-first mode for files, plans, and persistent mission state.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "right",
        inspectorMode: "column",
        defaultInspectorTab: "workspace",
        areas: {
          mainTop: [
            { id: "mission_state", title: "Mission" },
            { id: "workspace_files", title: "Artifacts" },
          ],
          mainBody: [
            { id: "agent_swarm", title: "Mission Manifests" },
            { id: "plan_status", title: "Build Queue" },
          ],
          mainBottom: [{ id: "runtime_events", title: "Event Stream" }],
          inspector: [
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
          mainTop: [{ id: "remote_mcp", title: "Remote MCP" }],
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
