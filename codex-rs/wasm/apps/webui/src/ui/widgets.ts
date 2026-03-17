import { ensureWorkspaceDocument, subscribeWorkspaceDocument, upsertWorkspaceDocument } from "./workspace";
import { normalizeWidgetsDocument } from "./validators";
import type { UiWidgetsDocument } from "./types";

export const UI_WIDGETS_PATH = "/workspace/ui/widgets.json";
export const UI_WIDGETS_GUIDE_PATH = "/workspace/ui/widgets.README.md";

export const DEFAULT_UI_WIDGETS: UiWidgetsDocument = {
  sessionStatus: {
    dense: false,
  },
  planStatus: {
    showExplanation: true,
  },
  metrics: {
    items: ["view", "dashboard", "profile", "theme", "model", "events", "approvals", "workspace"],
  },
  transcript: {
    variant: "bubble",
  },
  composer: {
    placeholder: "Describe a browser task or ask a question.",
    position: "bottom",
  },
  shell: {
    sidebarPrimaryAction: "new_thread",
    sidebarFooterActions: [],
    headerLeadingActions: ["toggle_sidebar", "new_thread"],
    headerTrailingActions: ["metrics", "workspace", "settings"],
  },
  runtimeEvents: {
    compact: false,
  },
  toolActivity: {
    compact: true,
  },
  workspaceFiles: {
    maxItems: 8,
    showPreview: true,
  },
  approvals: {
    compact: false,
  },
};

export async function ensureUiWidgetsDocument(): Promise<UiWidgetsDocument> {
  const content = await ensureWorkspaceDocument(UI_WIDGETS_PATH, serializeWidgetsDocument(DEFAULT_UI_WIDGETS));
  await upsertWorkspaceDocument(UI_WIDGETS_GUIDE_PATH, buildWidgetsGuide());
  return parseWidgetsDocument(content);
}

export function subscribeUiWidgets(listener: (document: UiWidgetsDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiWidgetsDocument());
  });
}

function parseWidgetsDocument(content: string): UiWidgetsDocument {
  try {
    return normalizeWidgetsDocument(JSON.parse(content) as unknown, DEFAULT_UI_WIDGETS);
  } catch {
    return structuredClone(DEFAULT_UI_WIDGETS);
  }
}

function serializeWidgetsDocument(document: UiWidgetsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildWidgetsGuide(): string {
  return [
    "# WASM Codex Widgets",
    "",
    `Edit \`${UI_WIDGETS_PATH}\` to configure widget variants and defaults.`,
    "",
    "Current sections:",
    "- `sessionStatus.dense`",
    "- `planStatus.showExplanation`",
    "- `metrics.items`",
    "- `transcript.variant`",
    "- `composer.placeholder`",
    "- `composer.position`",
    "- `shell.sidebarPrimaryAction`",
    "- `shell.sidebarFooterActions`",
    "- `shell.headerLeadingActions`",
    "- `shell.headerTrailingActions`",
    "- `runtimeEvents.compact`",
    "- `toolActivity.compact`",
    "- `workspaceFiles.maxItems`",
    "- `workspaceFiles.showPreview`",
    "- `approvals.compact`",
    "",
    "Additional runtime widgets consume workspace documents directly:",
    "- `web_signals` reads `/workspace/codex/web-signals.json`",
    "- `workspace_files` reads the current browser workspace snapshot",
    "- `citations` reads `/workspace/codex/{artifacts,anchors,sources}.json`",
    "",
  ].join("\n");
}
