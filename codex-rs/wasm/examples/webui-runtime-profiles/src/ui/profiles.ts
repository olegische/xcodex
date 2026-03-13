import { ensureWorkspaceDocument, subscribeWorkspaceDocument } from "./workspace";
import { loadStoredWorkspaceSnapshot, saveStoredWorkspaceSnapshot, upsertWorkspaceFile } from "../runtime/storage";
import { normalizeProfilesDocument } from "./validators";
import type { UiProfile, UiProfilesDocument } from "./types";

export const UI_PROFILES_PATH = "/workspace/ui/profiles.json";
export const UI_PROFILES_GUIDE_PATH = "/workspace/ui/profiles.README.md";

export const DEFAULT_UI_PROFILES: UiProfilesDocument = {
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
      tokens: {
        accent: "#ff4f88",
      },
    },
  ],
};

export async function ensureUiProfilesDocument(): Promise<UiProfilesDocument> {
  const content = await ensureWorkspaceDocument(UI_PROFILES_PATH, serializeProfilesDocument(DEFAULT_UI_PROFILES));
  await ensureWorkspaceDocument(UI_PROFILES_GUIDE_PATH, buildProfilesGuide());
  return parseProfilesDocument(content);
}

export function subscribeUiProfiles(listener: (document: UiProfilesDocument) => void): () => void {
  return subscribeWorkspaceDocument(async () => {
    listener(await ensureUiProfilesDocument());
  });
}

export function resolveActiveUiProfile(document: UiProfilesDocument): UiProfile {
  return document.profiles.find((profile) => profile.id === document.activeProfileId) ?? document.profiles[0];
}

export function createUiProfile(document: UiProfilesDocument): UiProfilesDocument {
  const baseProfile = resolveActiveUiProfile(document);
  const nextIndex = document.profiles.length + 1;
  const nextProfile: UiProfile = {
    ...baseProfile,
    id: `profile-${Date.now()}`,
    name: `Profile ${nextIndex}`,
  };
  return {
    activeProfileId: nextProfile.id,
    profiles: [...document.profiles, nextProfile],
  };
}

export function updateActiveUiProfile(document: UiProfilesDocument, nextProfile: UiProfile): UiProfilesDocument {
  return {
    activeProfileId: nextProfile.id,
    profiles: document.profiles.map((profile) => (profile.id === nextProfile.id ? nextProfile : profile)),
  };
}

export function deleteActiveUiProfile(document: UiProfilesDocument): UiProfilesDocument {
  if (document.profiles.length <= 1) {
    return document;
  }
  const profiles = document.profiles.filter((profile) => profile.id !== document.activeProfileId);
  return {
    activeProfileId: profiles[0]?.id ?? document.activeProfileId,
    profiles,
  };
}

export function setActiveUiProfile(document: UiProfilesDocument, profileId: string): UiProfilesDocument {
  return {
    ...document,
    activeProfileId: profileId,
  };
}

export async function saveUiProfilesDocument(document: UiProfilesDocument): Promise<void> {
  const workspace = await loadStoredWorkspaceSnapshot();
  workspace.files = upsertWorkspaceFile(workspace.files, {
    path: UI_PROFILES_PATH,
    content: serializeProfilesDocument(document),
  });
  await saveStoredWorkspaceSnapshot(workspace);
}

function parseProfilesDocument(content: string): UiProfilesDocument {
  try {
    return normalizeProfilesDocument(JSON.parse(content) as unknown, DEFAULT_UI_PROFILES);
  } catch {
    return structuredClone(DEFAULT_UI_PROFILES);
  }
}

function serializeProfilesDocument(document: UiProfilesDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function buildProfilesGuide(): string {
  return [
    "# Runtime UI Profiles",
    "",
    `Edit \`${UI_PROFILES_PATH}\` to switch themes, sidebar side, and token overrides.`,
    "",
    "Each profile supports:",
    "",
    "- `id`",
    "- `name`",
    "- `theme`: `dark` or `light`",
    "- `sidebarSide`: `left` or `right`",
    "- `tokens`: optional overrides on top of the active theme from `tokens.json`",
    "",
  ].join("\n");
}
