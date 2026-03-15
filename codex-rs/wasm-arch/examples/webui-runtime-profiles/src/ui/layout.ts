import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { normalizeLayoutDocument } from "./validators";
import type { UiLayoutDocument } from "./types";

export const UI_LAYOUT_PATH = "/workspace/ui/layout.json";
export const UI_LAYOUT_GUIDE_PATH = "/workspace/ui/layout.README.md";

export const DEFAULT_UI_LAYOUT: UiLayoutDocument = {
  showHeader: true,
  chatPlacement: "center",
  inspectorMode: "hidden",
  defaultInspectorTab: "events",
  areas: {
    mainTop: [],
    mainBody: [],
    mainBottom: [],
    inspector: [],
  },
};

export async function ensureUiLayoutDocument(): Promise<UiLayoutDocument> {
  const content = await ensureWorkspaceDocument(UI_LAYOUT_PATH, serializeLayoutDocument(DEFAULT_UI_LAYOUT));
  await ensureWorkspaceDocument(UI_LAYOUT_GUIDE_PATH, buildLayoutGuide());
  return parseLayoutDocument(content);
}

export function subscribeUiLayout(listener: (document: UiLayoutDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiLayoutDocument());
  });
}

function parseLayoutDocument(content: string): UiLayoutDocument {
  try {
    return normalizeLayoutDocument(JSON.parse(content) as unknown, DEFAULT_UI_LAYOUT);
  } catch {
    return structuredClone(DEFAULT_UI_LAYOUT);
  }
}

function serializeLayoutDocument(document: UiLayoutDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildLayoutGuide(): string {
  return [
    "# Runtime UI Layout",
    "",
    `Edit \`${UI_LAYOUT_PATH}\` to rearrange the shell live in the browser.`,
    "",
    "The runtime-configurable areas are:",
    "- `chatPlacement`: `center`, `left`, or `right`",
    "- `mainTop`",
    "- `mainBody`",
    "- `mainBottom`",
    "- `inspector`",
    "",
    "Chat foundation is fixed in code:",
    "- transcript",
    "- composer",
    "",
    "Allowed runtime widget ids:",
    "- `session_status`",
    "- `plan_status`",
    "- `metrics`",
    "- `runtime_events`",
    "- `tool_activity`",
    "- `workspace_files`",
    "- `approvals`",
    "",
  ].join("\n");
}
