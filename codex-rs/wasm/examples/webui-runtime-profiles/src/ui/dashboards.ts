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
      id: "default",
      name: "Default Dashboard",
      description: "Balanced chat-first dashboard.",
      layout: structuredClone(DEFAULT_UI_LAYOUT),
      widgets: structuredClone(DEFAULT_UI_WIDGETS),
    },
    {
      id: "agent-ops",
      name: "Agent Ops Dashboard",
      description: "Status, plan, tools and workspace centered shell.",
      layout: {
        ...structuredClone(DEFAULT_UI_LAYOUT),
        chatPlacement: "right",
        inspectorMode: "column",
        defaultInspectorTab: "status",
        areas: {
          mainTop: [],
          mainBody: [],
          mainBottom: [],
          inspector: [
            { id: "session_status", title: "Session Status" },
            { id: "plan_status", title: "Plan Status" },
            { id: "tool_activity", title: "Tool Activity" },
            { id: "workspace_files", title: "Workspace Files" },
          ],
        },
      },
      widgets: {
        ...structuredClone(DEFAULT_UI_WIDGETS),
        shell: {
          sidebarPrimaryAction: "new_thread",
          sidebarFooterActions: ["status", "plan", "workspace", "profiles", "settings"],
          headerLeadingActions: ["toggle_sidebar", "new_thread"],
          headerTrailingActions: ["metrics", "events", "tools", "approvals"],
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
    return normalizeDashboardsDocument(JSON.parse(content) as unknown, DEFAULT_UI_DASHBOARDS);
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
