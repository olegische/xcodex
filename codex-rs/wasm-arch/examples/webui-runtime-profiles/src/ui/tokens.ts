import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { loadStoredWorkspaceSnapshot, saveStoredWorkspaceSnapshot, upsertWorkspaceFile } from "../runtime/storage";
import { normalizeTokensDocument } from "./validators";
import type { UiTheme, UiTokenMap, UiTokensDocument } from "./types";

export const UI_TOKENS_PATH = "/workspace/ui/tokens.json";
export const UI_TOKENS_GUIDE_PATH = "/workspace/ui/tokens.README.md";

export const DEFAULT_UI_TOKENS: UiTokensDocument = {
  themes: {
    dark: {
      bg: "#201f1d",
      sidebar: "#292826",
      surface: "#312f2d",
      surfaceMuted: "#393633",
      surfaceElevated: "#2b2927",
      surfaceInput: "#252321",
      surfaceCard: "#35322f",
      border: "#4c4843",
      text: "#e4e7ed",
      textMuted: "#aaa39a",
      accent: "#b89d6a",
      accentContrast: "#1e1a14",
      success: "#78c27d",
      error: "#f08080",
      hover: "#3a3632",
      badgeBg: "#34302c",
      badgeDot: "#90877a",
      successText: "#c8f0cb",
      successBg: "rgba(120, 194, 125, 0.12)",
      successBorder: "rgba(120, 194, 125, 0.28)",
      warningText: "#ffd89a",
      warningBg: "rgba(245, 158, 11, 0.12)",
      warningBorder: "rgba(245, 158, 11, 0.28)",
      warningDot: "#f59e0b",
      messageUserBg: "#3a3632",
      composerFade: "linear-gradient(180deg, rgba(37, 35, 33, 0), rgba(37, 35, 33, 0.96) 32%)",
      overlay: "rgba(18, 17, 15, 0.32)",
      drawerBg: "rgba(43, 40, 37, 0.98)",
      shadow: "none",
    },
    light: {
      bg: "#f5f4ef",
      sidebar: "#ece7dd",
      surface: "#fffdf8",
      surfaceMuted: "#e7e0d4",
      surfaceElevated: "#fffaf1",
      surfaceInput: "#f6f0e6",
      surfaceCard: "#f1ebdf",
      border: "#d4cab8",
      text: "#1e2330",
      textMuted: "#667085",
      accent: "#1d7f63",
      accentContrast: "#f9fffd",
      success: "#2f855a",
      error: "#c05656",
      hover: "#e6dece",
      badgeBg: "#e8e0d3",
      badgeDot: "#8e836f",
      successText: "#226145",
      successBg: "rgba(47, 133, 90, 0.12)",
      successBorder: "rgba(47, 133, 90, 0.28)",
      warningText: "#9a5b00",
      warningBg: "rgba(208, 135, 43, 0.16)",
      warningBorder: "rgba(208, 135, 43, 0.28)",
      warningDot: "#d0872b",
      messageUserBg: "#dde7e1",
      composerFade: "linear-gradient(180deg, rgba(245, 244, 239, 0), rgba(245, 244, 239, 0.96) 32%)",
      overlay: "rgba(31, 35, 48, 0.16)",
      drawerBg: "rgba(255, 250, 241, 0.98)",
      shadow: "none",
    },
  },
};

export async function ensureUiTokensDocument(): Promise<UiTokensDocument> {
  const content = await ensureWorkspaceDocument(UI_TOKENS_PATH, serializeTokensDocument(DEFAULT_UI_TOKENS));
  await ensureWorkspaceDocument(UI_TOKENS_GUIDE_PATH, buildTokensGuide());
  const parsed = parseTokensDocument(content);
  if (!parsed.ok) {
    await repairInvalidUiJsonDocument(UI_TOKENS_PATH, `${UI_TOKENS_PATH}.invalid.bak`, content, serializeTokensDocument(DEFAULT_UI_TOKENS));
  }
  return parsed.document;
}

export function subscribeUiTokens(listener: (document: UiTokensDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiTokensDocument());
  });
}

export function applyThemeTokens(theme: UiTheme, tokens: UiTokenMap): void {
  document.documentElement.dataset.uiTheme = theme;
  document.documentElement.style.colorScheme = theme;
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === "string" && value.length > 0) {
      document.documentElement.style.setProperty(`--${camelToKebab(key)}`, value);
    }
  }
}

function parseTokensDocument(content: string): { document: UiTokensDocument; ok: boolean } {
  try {
    return {
      document: normalizeTokensDocument(JSON.parse(content) as unknown, DEFAULT_UI_TOKENS),
      ok: true,
    };
  } catch (error) {
    console.warn("[webui] ui.tokens:parse-failed", error, content);
    return {
      document: structuredClone(DEFAULT_UI_TOKENS),
      ok: false,
    };
  }
}

function serializeTokensDocument(document: UiTokensDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildTokensGuide(): string {
  return [
    "# Runtime UI Tokens",
    "",
    `Edit \`${UI_TOKENS_PATH}\` to control the base theme palettes.`,
    "",
    "The document must look like:",
    "",
    "```json",
    "{",
    '  "themes": {',
    '    "dark": { "accent": "#b89d6a" },',
    '    "light": { "accent": "#1d7f63" }',
    "  }",
    "}",
    "```",
    "",
    "Any token value may be any valid CSS color or background string.",
    "",
  ].join("\n");
}

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

async function repairInvalidUiJsonDocument(
  path: string,
  backupPath: string,
  invalidContent: string,
  repairedContent: string,
): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: backupPath,
    content: invalidContent,
  });
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path,
    content: repairedContent,
  });
  await saveStoredWorkspaceSnapshot(workspace);
}
