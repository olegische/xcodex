import {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceFilePath,
  saveStoredWorkspaceSnapshot,
  upsertWorkspaceFile,
} from "./runtime/storage";

export type ComposerPosition = "top" | "bottom";
export type InspectorMode = "hidden" | "drawer" | "column";
export type InspectorTab = "events" | "approvals";

export type UiLayoutDocument = {
  showHeader: boolean;
  composerPosition: ComposerPosition;
  inspectorMode: InspectorMode;
  defaultInspectorTab: InspectorTab;
  showMetrics: boolean;
  showEvents: boolean;
  showApprovals: boolean;
};

export const UI_LAYOUT_PATH = "/workspace/ui/layout.json";
export const UI_LAYOUT_GUIDE_PATH = "/workspace/ui/layout.README.md";

const DEFAULT_UI_LAYOUT: UiLayoutDocument = {
  showHeader: true,
  composerPosition: "bottom",
  inspectorMode: "drawer",
  defaultInspectorTab: "events",
  showMetrics: true,
  showEvents: true,
  showApprovals: true,
};

export async function ensureUiLayoutDocument(): Promise<UiLayoutDocument> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const layoutPath = normalizeWorkspaceFilePath(UI_LAYOUT_PATH);
  const guidePath = normalizeWorkspaceFilePath(UI_LAYOUT_GUIDE_PATH);
  const layoutFile = workspace.files.find((entry) => entry.path === layoutPath);
  const guideFile = workspace.files.find((entry) => entry.path === guidePath);

  if (layoutFile === undefined) {
    workspace.files = upsertWorkspaceFile(workspace.files, {
      path: layoutPath,
      content: serializeUiLayout(DEFAULT_UI_LAYOUT),
    });
  }

  if (guideFile === undefined) {
    workspace.files = upsertWorkspaceFile(workspace.files, {
      path: guidePath,
      content: buildUiLayoutGuide(),
    });
  }

  if (layoutFile === undefined || guideFile === undefined) {
    await saveStoredWorkspaceSnapshot(workspace);
  }

  if (layoutFile === undefined) {
    return structuredClone(DEFAULT_UI_LAYOUT);
  }

  return parseUiLayout(layoutFile.content);
}

export function subscribeUiLayout(listener: (document: UiLayoutDocument) => void): () => void {
  const handleWorkspaceChange = async () => {
    listener(await ensureUiLayoutDocument());
  };

  window.addEventListener("codex:workspace-changed", handleWorkspaceChange);
  return () => {
    window.removeEventListener("codex:workspace-changed", handleWorkspaceChange);
  };
}

function parseUiLayout(content: string): UiLayoutDocument {
  try {
    return normalizeUiLayout(JSON.parse(content) as unknown);
  } catch {
    return structuredClone(DEFAULT_UI_LAYOUT);
  }
}

function normalizeUiLayout(value: unknown): UiLayoutDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    showHeader: payload.showHeader !== false,
    composerPosition: payload.composerPosition === "top" ? "top" : "bottom",
    inspectorMode:
      payload.inspectorMode === "column" ? "column" : payload.inspectorMode === "hidden" ? "hidden" : "drawer",
    defaultInspectorTab: payload.defaultInspectorTab === "approvals" ? "approvals" : "events",
    showMetrics: payload.showMetrics !== false,
    showEvents: payload.showEvents !== false,
    showApprovals: payload.showApprovals !== false,
  };
}

function serializeUiLayout(document: UiLayoutDocument): string {
  return `${JSON.stringify(normalizeUiLayout(document), null, 2)}\n`;
}

function buildUiLayoutGuide(): string {
  return [
    "# Runtime UI Layout",
    "",
    `Edit \`${UI_LAYOUT_PATH}\` to rearrange the shell live in the browser.`,
    "",
    "Supported fields:",
    "",
    "- `showHeader`: boolean",
    "- `composerPosition`: `top` or `bottom`",
    "- `inspectorMode`: `hidden`, `drawer`, or `column`",
    "- `defaultInspectorTab`: `events` or `approvals`",
    "- `showMetrics`: boolean",
    "- `showEvents`: boolean",
    "- `showApprovals`: boolean",
    "",
    "Example:",
    "",
    "```json",
    "{",
    '  "showHeader": false,',
    '  "composerPosition": "top",',
    '  "inspectorMode": "column",',
    '  "defaultInspectorTab": "events",',
    '  "showMetrics": true,',
    '  "showEvents": true,',
    '  "showApprovals": false',
    "}",
    "```",
    "",
  ].join("\n");
}
