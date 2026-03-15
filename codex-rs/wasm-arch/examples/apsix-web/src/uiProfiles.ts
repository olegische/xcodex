import {
  loadStoredWorkspaceSnapshot,
  normalizeWorkspaceFilePath,
  saveStoredWorkspaceSnapshot,
  upsertWorkspaceFile,
} from "./runtime/storage";

export type UiTheme = "dark" | "light";
export type SidebarSide = "left" | "right";
export const UI_COLOR_TOKENS = [
  "bg",
  "sidebar",
  "surface",
  "surfaceMuted",
  "surfaceElevated",
  "surfaceInput",
  "surfaceCard",
  "border",
  "text",
  "textMuted",
  "accent",
  "accentContrast",
  "success",
  "error",
  "hover",
  "messageUserBg",
] as const;
export type UiColorToken = (typeof UI_COLOR_TOKENS)[number];
export type UiColorOverrides = Partial<Record<UiColorToken, string>>;

export type UiProfile = {
  id: string;
  name: string;
  theme: UiTheme;
  sidebarSide: SidebarSide;
  colors?: UiColorOverrides;
};

export type UiProfilesDocument = {
  activeProfileId: string;
  profiles: UiProfile[];
};

export const UI_PROFILES_PATH = "/workspace/ui/profiles.json";
export const UI_PROFILES_GUIDE_PATH = "/workspace/ui/README.md";

const DEFAULT_UI_PROFILES: UiProfilesDocument = {
  activeProfileId: "classic-dark",
  profiles: [
    {
      id: "classic-dark",
      name: "Classic Dark",
      theme: "dark",
      sidebarSide: "left",
    },
    {
      id: "lefty-light",
      name: "Lefty Light",
      theme: "light",
      sidebarSide: "right",
    },
  ],
};

export async function ensureUiProfilesDocument(): Promise<UiProfilesDocument> {
  const workspace = await loadStoredWorkspaceSnapshot();
  const profilesPath = normalizeWorkspaceFilePath(UI_PROFILES_PATH);
  const guidePath = normalizeWorkspaceFilePath(UI_PROFILES_GUIDE_PATH);
  const profilesFile = workspace.files.find((entry) => entry.path === profilesPath);
  const guideFile = workspace.files.find((entry) => entry.path === guidePath);

  if (profilesFile === undefined) {
    workspace.files = upsertWorkspaceFile(workspace.files, {
      path: profilesPath,
      content: serializeUiProfiles(DEFAULT_UI_PROFILES),
    });
  }

  if (guideFile === undefined) {
    workspace.files = upsertWorkspaceFile(workspace.files, {
      path: guidePath,
      content: buildUiProfilesGuide(),
    });
  }

  if (profilesFile === undefined || guideFile === undefined) {
    await saveStoredWorkspaceSnapshot(workspace);
  }

  if (profilesFile === undefined) {
    return structuredClone(DEFAULT_UI_PROFILES);
  }

  return parseUiProfiles(profilesFile.content);
}

export async function saveUiProfilesDocument(document: UiProfilesDocument): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: UI_PROFILES_PATH,
    content: serializeUiProfiles(document),
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

export function subscribeUiProfiles(listener: (document: UiProfilesDocument) => void): () => void {
  const handleWorkspaceChange = async () => {
    listener(await ensureUiProfilesDocument());
  };

  window.addEventListener("codex:workspace-changed", handleWorkspaceChange);
  return () => {
    window.removeEventListener("codex:workspace-changed", handleWorkspaceChange);
  };
}

export function resolveActiveUiProfile(document: UiProfilesDocument): UiProfile {
  return (
    document.profiles.find((profile) => profile.id === document.activeProfileId) ??
    document.profiles[0] ??
    DEFAULT_UI_PROFILES.profiles[0]
  );
}

export function applyUiProfile(profile: UiProfile): void {
  document.documentElement.dataset.uiTheme = profile.theme;
  document.documentElement.style.colorScheme = profile.theme;
  for (const token of UI_COLOR_TOKENS) {
    const value = profile.colors?.[token];
    if (typeof value === "string" && value.trim().length > 0) {
      document.documentElement.style.setProperty(`--${token}`, value.trim());
    } else {
      document.documentElement.style.removeProperty(`--${token}`);
    }
  }
}

export function updateActiveUiProfile(
  document: UiProfilesDocument,
  nextProfile: UiProfile,
): UiProfilesDocument {
  const profiles = document.profiles.map((profile) => (profile.id === nextProfile.id ? nextProfile : profile));
  return normalizeUiProfiles({
    activeProfileId: nextProfile.id,
    profiles,
  });
}

export function createUiProfile(document: UiProfilesDocument): UiProfilesDocument {
  const baseProfile = resolveActiveUiProfile(document);
  const nextIndex = document.profiles.length + 1;
  const nextProfile: UiProfile = {
    ...baseProfile,
    id: `profile-${Date.now()}`,
    name: `Profile ${nextIndex}`,
  };
  return normalizeUiProfiles({
    activeProfileId: nextProfile.id,
    profiles: [...document.profiles, nextProfile],
  });
}

export function deleteActiveUiProfile(document: UiProfilesDocument): UiProfilesDocument {
  if (document.profiles.length <= 1) {
    return document;
  }
  const remainingProfiles = document.profiles.filter((profile) => profile.id !== document.activeProfileId);
  return normalizeUiProfiles({
    activeProfileId: remainingProfiles[0]?.id ?? DEFAULT_UI_PROFILES.activeProfileId,
    profiles: remainingProfiles,
  });
}

export function setActiveUiProfile(document: UiProfilesDocument, profileId: string): UiProfilesDocument {
  return normalizeUiProfiles({
    ...document,
    activeProfileId: profileId,
  });
}

function serializeUiProfiles(document: UiProfilesDocument): string {
  return `${JSON.stringify(normalizeUiProfiles(document), null, 2)}\n`;
}

function parseUiProfiles(content: string): UiProfilesDocument {
  try {
    return normalizeUiProfiles(JSON.parse(content) as unknown);
  } catch {
    return structuredClone(DEFAULT_UI_PROFILES);
  }
}

function normalizeUiProfiles(value: unknown): UiProfilesDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const profiles = rawProfiles
    .map(normalizeUiProfile)
    .filter((profile): profile is UiProfile => profile !== null);

  const nextProfiles = profiles.length > 0 ? profiles : structuredClone(DEFAULT_UI_PROFILES.profiles);
  const activeProfileId =
    typeof payload.activeProfileId === "string" && nextProfiles.some((profile) => profile.id === payload.activeProfileId)
      ? payload.activeProfileId
      : nextProfiles[0]?.id ?? DEFAULT_UI_PROFILES.activeProfileId;

  return {
    activeProfileId,
    profiles: nextProfiles,
  };
}

function normalizeUiProfile(value: unknown): UiProfile | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || typeof payload.name !== "string") {
    return null;
  }
  return {
    id: payload.id,
    name: payload.name,
    theme: payload.theme === "light" ? "light" : "dark",
    sidebarSide: payload.sidebarSide === "right" ? "right" : "left",
    colors: normalizeUiColorOverrides(payload.colors),
  };
}

function normalizeUiColorOverrides(value: unknown): UiColorOverrides | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const payload = value as Record<string, unknown>;
  const colors = Object.fromEntries(
    UI_COLOR_TOKENS.flatMap((token) => {
      const candidate = payload[token];
      if (typeof candidate !== "string" || candidate.trim().length === 0) {
        return [];
      }
      return [[token, candidate.trim()]];
    }),
  ) as UiColorOverrides;

  return Object.keys(colors).length > 0 ? colors : undefined;
}

function buildUiProfilesGuide(): string {
  return [
    "# APSIX Web Profiles",
    "",
    `Edit \`${UI_PROFILES_PATH}\` to change the app shell live in the browser.`,
    "",
    "Document shape:",
    "",
    "```json",
    "{",
    '  "activeProfileId": "lefty-light",',
    '  "profiles": [',
    "    {",
    '      "id": "lefty-light",',
    '      "name": "Lefty Light",',
    '      "theme": "light",',
    '      "sidebarSide": "right",',
    '      "colors": {',
    '        "accent": "#ff4f88",',
    '        "bg": "#f7efe4",',
    '        "sidebar": "#f1dfc8"',
    "      }",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Supported color keys:",
    "",
    ...UI_COLOR_TOKENS.map((token) => `- \`${token}\``),
    "",
    "Use any valid CSS color string: hex, rgb(), hsl(), oklch(), or named colors.",
    "",
  ].join("\n");
}
