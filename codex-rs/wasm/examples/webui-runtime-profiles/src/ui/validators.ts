import type {
  ComposerPosition,
  InspectorMode,
  InspectorTab,
  SidebarSide,
  UiAreaName,
  UiLayoutDocument,
  UiProfile,
  UiProfilesDocument,
  UiTheme,
  UiTokenMap,
  UiTokensDocument,
  UiWidgetId,
  UiWidgetSpec,
  UiWidgetsDocument,
} from "./types";
import { UI_TOKEN_KEYS } from "./types";

const WIDGET_IDS: UiWidgetId[] = ["transcript", "composer", "metrics", "runtime_events", "approvals"];
const AREA_NAMES: UiAreaName[] = ["mainTop", "mainBody", "mainBottom", "inspector"];

export function normalizeTokensDocument(value: unknown, fallback: UiTokensDocument): UiTokensDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const themes = payload.themes !== null && typeof payload.themes === "object" ? (payload.themes as Record<string, unknown>) : {};
  return {
    themes: {
      dark: normalizeTokenMap(themes.dark, fallback.themes.dark),
      light: normalizeTokenMap(themes.light, fallback.themes.light),
    },
  };
}

export function normalizeProfilesDocument(value: unknown, fallback: UiProfilesDocument): UiProfilesDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const profiles = rawProfiles.map(normalizeProfile).filter((profile): profile is UiProfile => profile !== null);
  const nextProfiles = profiles.length > 0 ? profiles : fallback.profiles;
  const activeProfileId =
    typeof payload.activeProfileId === "string" && nextProfiles.some((profile) => profile.id === payload.activeProfileId)
      ? payload.activeProfileId
      : nextProfiles[0]?.id ?? fallback.activeProfileId;
  return {
    activeProfileId,
    profiles: nextProfiles,
  };
}

export function normalizeLayoutDocument(value: unknown, fallback: UiLayoutDocument): UiLayoutDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const areasPayload = payload.areas !== null && typeof payload.areas === "object" ? (payload.areas as Record<string, unknown>) : {};
  return {
    showHeader: payload.showHeader !== false,
    inspectorMode: normalizeInspectorMode(payload.inspectorMode),
    defaultInspectorTab: normalizeInspectorTab(payload.defaultInspectorTab),
    areas: Object.fromEntries(
      AREA_NAMES.map((area) => [area, normalizeWidgetList(areasPayload[area], fallback.areas[area])]),
    ) as UiLayoutDocument["areas"],
  };
}

export function normalizeWidgetsDocument(value: unknown, fallback: UiWidgetsDocument): UiWidgetsDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const metrics = payload.metrics !== null && typeof payload.metrics === "object" ? (payload.metrics as Record<string, unknown>) : {};
  const transcript =
    payload.transcript !== null && typeof payload.transcript === "object" ? (payload.transcript as Record<string, unknown>) : {};
  const composer =
    payload.composer !== null && typeof payload.composer === "object" ? (payload.composer as Record<string, unknown>) : {};
  const runtimeEvents =
    payload.runtimeEvents !== null && typeof payload.runtimeEvents === "object"
      ? (payload.runtimeEvents as Record<string, unknown>)
      : {};
  const approvals =
    payload.approvals !== null && typeof payload.approvals === "object" ? (payload.approvals as Record<string, unknown>) : {};

  return {
    metrics: {
      items: Array.isArray(metrics.items)
        ? metrics.items.filter((item): item is string => typeof item === "string" && item.length > 0)
        : fallback.metrics.items,
    },
    transcript: {
      variant: transcript.variant === "flat" ? "flat" : fallback.transcript.variant,
    },
    composer: {
      placeholder:
        typeof composer.placeholder === "string" && composer.placeholder.trim().length > 0
          ? composer.placeholder
          : fallback.composer.placeholder,
      position: normalizeComposerPosition(composer.position, fallback.composer.position),
    },
    runtimeEvents: {
      compact: runtimeEvents.compact === true,
    },
    approvals: {
      compact: approvals.compact === true,
    },
  };
}

function normalizeProfile(value: unknown): UiProfile | null {
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
    theme: normalizeTheme(payload.theme),
    sidebarSide: normalizeSidebarSide(payload.sidebarSide),
    tokens: normalizeTokenMap(payload.tokens, {}),
  };
}

function normalizeWidgetList(value: unknown, fallback: UiWidgetSpec[]): UiWidgetSpec[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const widgets = value
    .map((entry) => normalizeWidgetSpec(entry))
    .filter((entry): entry is UiWidgetSpec => entry !== null);
  return widgets.length > 0 ? widgets : fallback;
}

function normalizeWidgetSpec(value: unknown): UiWidgetSpec | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || !WIDGET_IDS.includes(payload.id as UiWidgetId)) {
    return null;
  }
  return {
    id: payload.id as UiWidgetId,
    title: typeof payload.title === "string" ? payload.title : undefined,
  };
}

function normalizeTokenMap(value: unknown, fallback: UiTokenMap): UiTokenMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const payload = value as Record<string, unknown>;
  const nextMap = Object.fromEntries(
    UI_TOKEN_KEYS.flatMap((key) => {
      const candidate = payload[key];
      if (typeof candidate !== "string" || candidate.trim().length === 0) {
        return [];
      }
      return [[key, candidate.trim()]];
    }),
  ) as UiTokenMap;
  return Object.keys(nextMap).length > 0 ? nextMap : fallback;
}

function normalizeTheme(value: unknown): UiTheme {
  return value === "light" ? "light" : "dark";
}

function normalizeSidebarSide(value: unknown): SidebarSide {
  return value === "right" ? "right" : "left";
}

function normalizeInspectorMode(value: unknown): InspectorMode {
  return value === "column" ? "column" : value === "hidden" ? "hidden" : "drawer";
}

function normalizeInspectorTab(value: unknown): InspectorTab {
  return value === "approvals" ? "approvals" : "events";
}

function normalizeComposerPosition(value: unknown, fallback: ComposerPosition): ComposerPosition {
  return value === "top" ? "top" : value === "bottom" ? "bottom" : fallback;
}
