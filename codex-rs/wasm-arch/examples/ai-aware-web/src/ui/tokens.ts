import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { loadStoredWorkspaceSnapshot, saveStoredWorkspaceSnapshot, upsertWorkspaceFile } from "../runtime/storage";
import { normalizeTokensDocument } from "./validators";
import type { UiTheme, UiTokenMap, UiTokensDocument } from "./types";

export const UI_TOKENS_PATH = "/workspace/ui/tokens.json";
export const UI_TOKENS_GUIDE_PATH = "/workspace/ui/tokens.README.md";

export const DEFAULT_UI_TOKENS: UiTokensDocument = {
  themes: {
    dark: {
      bg: "#212121",
      sidebar: "rgba(33, 33, 33, 0.92)",
      surface: "rgba(47, 47, 47, 0.92)",
      surfaceMuted: "rgba(58, 58, 58, 0.94)",
      surfaceElevated: "rgba(42, 42, 42, 0.98)",
      surfaceInput: "rgba(43, 43, 43, 0.98)",
      surfaceCard: "rgba(52, 52, 52, 0.9)",
      border: "rgba(255, 255, 255, 0.1)",
      text: "#ececec",
      textMuted: "#a3a3a3",
      accent: "#c7c7c7",
      accentContrast: "#1f1f1f",
      success: "#52c27d",
      error: "#df6b6b",
      hover: "rgba(255, 255, 255, 0.06)",
      badgeBg: "rgba(60, 60, 60, 0.96)",
      badgeDot: "#c7c7c7",
      successText: "#d6ffe4",
      successBg: "rgba(87, 242, 135, 0.12)",
      successBorder: "rgba(87, 242, 135, 0.32)",
      warningText: "#ffd38b",
      warningBg: "rgba(255, 159, 64, 0.12)",
      warningBorder: "rgba(255, 159, 64, 0.28)",
      warningDot: "#ff9f40",
      messageUserBg: "rgba(80, 80, 80, 0.42)",
      composerFade: "linear-gradient(180deg, rgba(33, 33, 33, 0), rgba(33, 33, 33, 0.97) 32%)",
      overlay: "rgba(0, 0, 0, 0.42)",
      drawerBg: "rgba(33, 33, 33, 0.98)",
      shadow: "0 24px 60px rgba(0, 0, 0, 0.36)",
    },
    light: {
      bg: "#f7f7fb",
      sidebar: "rgba(239, 244, 255, 0.92)",
      surface: "rgba(255, 255, 255, 0.9)",
      surfaceMuted: "rgba(229, 238, 255, 0.92)",
      surfaceElevated: "rgba(255, 255, 255, 0.98)",
      surfaceInput: "rgba(242, 246, 255, 0.98)",
      surfaceCard: "rgba(245, 248, 255, 0.94)",
      border: "rgba(37, 102, 164, 0.18)",
      text: "#071321",
      textMuted: "#5c708a",
      accent: "#ff5f1f",
      accentContrast: "#fff9f2",
      success: "#14804a",
      error: "#c93d63",
      hover: "rgba(255, 95, 31, 0.08)",
      badgeBg: "rgba(233, 240, 255, 0.96)",
      badgeDot: "#ff5f1f",
      successText: "#135d39",
      successBg: "rgba(20, 128, 74, 0.12)",
      successBorder: "rgba(20, 128, 74, 0.28)",
      warningText: "#9a5300",
      warningBg: "rgba(255, 165, 0, 0.12)",
      warningBorder: "rgba(255, 165, 0, 0.22)",
      warningDot: "#ff8f00",
      messageUserBg: "rgba(255, 186, 150, 0.28)",
      composerFade: "linear-gradient(180deg, rgba(247, 247, 251, 0), rgba(247, 247, 251, 0.96) 32%)",
      overlay: "rgba(7, 19, 33, 0.18)",
      drawerBg: "rgba(255, 255, 255, 0.98)",
      shadow: "0 18px 48px rgba(20, 42, 70, 0.14)",
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
      document: mergeBuiltinThemes(normalizeTokensDocument(JSON.parse(content) as unknown, DEFAULT_UI_TOKENS)),
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

function mergeBuiltinThemes(document: UiTokensDocument): UiTokensDocument {
  return {
    themes: {
      ...document.themes,
      dark: {
        ...document.themes.dark,
        ...DEFAULT_UI_TOKENS.themes.dark,
      },
      light: {
        ...document.themes.light,
        ...DEFAULT_UI_TOKENS.themes.light,
      },
    },
  };
}

function serializeTokensDocument(document: UiTokensDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildTokensGuide(): string {
  return [
    "# AI-Aware Web Tokens",
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
