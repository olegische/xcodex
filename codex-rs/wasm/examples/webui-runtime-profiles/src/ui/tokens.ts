import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { normalizeTokensDocument } from "./validators";
import type { UiTheme, UiTokenMap, UiTokensDocument } from "./types";

export const UI_TOKENS_PATH = "/workspace/ui/tokens.json";
export const UI_TOKENS_GUIDE_PATH = "/workspace/ui/tokens.README.md";

export const DEFAULT_UI_TOKENS: UiTokensDocument = {
  themes: {
    dark: {
      bg: "#1f2024",
      sidebar: "#2a2c31",
      surface: "#303239",
      surfaceMuted: "#373a42",
      surfaceElevated: "#2b2f38",
      surfaceInput: "#232730",
      surfaceCard: "#313640",
      border: "#474b55",
      text: "#e4e7ed",
      textMuted: "#a0a6b1",
      accent: "#6f8cff",
      accentContrast: "#f8faff",
      success: "#78c27d",
      error: "#f08080",
      hover: "#353a45",
      badgeBg: "#2f3440",
      badgeDot: "#7f8796",
      successText: "#c8f0cb",
      successBg: "rgba(120, 194, 125, 0.12)",
      successBorder: "rgba(120, 194, 125, 0.28)",
      warningText: "#ffd89a",
      warningBg: "rgba(245, 158, 11, 0.12)",
      warningBorder: "rgba(245, 158, 11, 0.28)",
      warningDot: "#f59e0b",
      messageUserBg: "#323845",
      composerFade: "linear-gradient(180deg, rgba(35, 37, 43, 0), rgba(35, 37, 43, 0.96) 32%)",
      overlay: "rgba(17, 24, 39, 0.32)",
      drawerBg: "rgba(43, 47, 56, 0.98)",
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
  return parseTokensDocument(content);
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

function parseTokensDocument(content: string): UiTokensDocument {
  try {
    return normalizeTokensDocument(JSON.parse(content) as unknown, DEFAULT_UI_TOKENS);
  } catch {
    return structuredClone(DEFAULT_UI_TOKENS);
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
    '    "dark": { "accent": "#6f8cff" },',
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
