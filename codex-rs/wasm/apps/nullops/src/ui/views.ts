import { ensureWorkspaceDocument, subscribeWorkspaceDocument, upsertWorkspaceDocument } from "./workspace";
import { loadStoredWorkspaceSnapshot, saveStoredWorkspaceSnapshot, upsertWorkspaceFile } from "../runtime/storage";
import { normalizeViewsDocument } from "./validators";
import type { UiViewsDocument } from "./types";

export const UI_VIEWS_PATH = "/workspace/ui/views.json";
export const UI_VIEWS_GUIDE_PATH = "/workspace/ui/views.README.md";

export const DEFAULT_UI_VIEWS: UiViewsDocument = {
  activeViewId: "mission",
  views: [
    {
      id: "mission",
      name: "Chat",
    },
  ],
};

export async function ensureUiViewsDocument(): Promise<UiViewsDocument> {
  const content = await ensureWorkspaceDocument(UI_VIEWS_PATH, serializeViewsDocument(DEFAULT_UI_VIEWS));
  await upsertWorkspaceDocument(UI_VIEWS_GUIDE_PATH, buildViewsGuide());
  return parseViewsDocument(content);
}

export function subscribeUiViews(listener: (document: UiViewsDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiViewsDocument());
  });
}

export async function saveUiViewsDocument(document: UiViewsDocument): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: UI_VIEWS_PATH,
    content: serializeViewsDocument(document),
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

export function setActiveUiView(document: UiViewsDocument, viewId: string): UiViewsDocument {
  return {
    ...document,
    activeViewId: DEFAULT_UI_VIEWS.activeViewId,
  };
}

function parseViewsDocument(content: string): UiViewsDocument {
  try {
    return mergeDefaultViews(normalizeViewsDocument(JSON.parse(content) as unknown, DEFAULT_UI_VIEWS));
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
    `Edit \`${UI_VIEWS_PATH}\` to pick the active task-mode.`,
    "",
    "Fields:",
    "- `activeViewId`",
    "- `views[].id`",
    "- `views[].name`",
    "",
  ].join("\n");
}

function mergeDefaultViews(document: UiViewsDocument): UiViewsDocument {
  return {
    activeViewId: DEFAULT_UI_VIEWS.activeViewId,
    views: structuredClone(DEFAULT_UI_VIEWS.views),
  };
}
