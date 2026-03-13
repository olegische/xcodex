import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { normalizeWidgetsDocument } from "./validators";
import type { UiWidgetsDocument } from "./types";

export const UI_WIDGETS_PATH = "/workspace/ui/widgets.json";
export const UI_WIDGETS_GUIDE_PATH = "/workspace/ui/widgets.README.md";

export const DEFAULT_UI_WIDGETS: UiWidgetsDocument = {
  metrics: {
    items: ["profile", "theme", "sidebar", "transcript", "events", "approvals"],
  },
  transcript: {
    variant: "bubble",
  },
  composer: {
    placeholder: "Ask for follow-up changes",
    position: "bottom",
  },
  runtimeEvents: {
    compact: false,
  },
  approvals: {
    compact: false,
  },
};

export async function ensureUiWidgetsDocument(): Promise<UiWidgetsDocument> {
  const content = await ensureWorkspaceDocument(UI_WIDGETS_PATH, serializeWidgetsDocument(DEFAULT_UI_WIDGETS));
  await ensureWorkspaceDocument(UI_WIDGETS_GUIDE_PATH, buildWidgetsGuide());
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
    "# Runtime UI Widgets",
    "",
    `Edit \`${UI_WIDGETS_PATH}\` to configure widget variants and defaults.`,
    "",
    "Current sections:",
    "- `metrics.items`",
    "- `transcript.variant`",
    "- `composer.placeholder`",
    "- `composer.position`",
    "- `runtimeEvents.compact`",
    "- `approvals.compact`",
    "",
  ].join("\n");
}
