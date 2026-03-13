import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { normalizeViewsDocument } from "./validators";
import type { UiViewsDocument } from "./types";

export const UI_VIEWS_PATH = "/workspace/ui/views.json";
export const UI_VIEWS_GUIDE_PATH = "/workspace/ui/views.README.md";

export const DEFAULT_UI_VIEWS: UiViewsDocument = {
  activeViewId: "default",
  views: [
    {
      id: "default",
      name: "Default View",
      dashboardId: "default",
    },
    {
      id: "agent-ops",
      name: "Agent Ops View",
      dashboardId: "agent-ops",
    },
  ],
};

export async function ensureUiViewsDocument(): Promise<UiViewsDocument> {
  const content = await ensureWorkspaceDocument(UI_VIEWS_PATH, serializeViewsDocument(DEFAULT_UI_VIEWS));
  await ensureWorkspaceDocument(UI_VIEWS_GUIDE_PATH, buildViewsGuide());
  return parseViewsDocument(content);
}

export function subscribeUiViews(listener: (document: UiViewsDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiViewsDocument());
  });
}

function parseViewsDocument(content: string): UiViewsDocument {
  try {
    return normalizeViewsDocument(JSON.parse(content) as unknown, DEFAULT_UI_VIEWS);
  } catch {
    return structuredClone(DEFAULT_UI_VIEWS);
  }
}

function serializeViewsDocument(document: UiViewsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildViewsGuide(): string {
  return [
    "# Runtime UI Views",
    "",
    `Edit \`${UI_VIEWS_PATH}\` to pick the active task-mode and map views to dashboards.`,
    "",
    "Fields:",
    "- `activeViewId`",
    "- `views[].dashboardId`",
    "",
  ].join("\n");
}
