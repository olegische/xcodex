import type {
  ChatFoundationPlacement,
  ComposerPosition,
  UiDashboardDefinition,
  UiDashboardsDocument,
  InspectorMode,
  InspectorTab,
  SidebarSide,
  UiAreaName,
  UiLayoutDocument,
  UiProfile,
  UiProfilesDocument,
  ShellActionId,
  UiTheme,
  UiTokenMap,
  UiTokensDocument,
  UiViewDefinition,
  UiViewsDocument,
  UiWidgetId,
  UiWidgetSpec,
  UiWidgetsDocument,
} from "./types";
import { UI_TOKEN_KEYS } from "./types";

const WIDGET_IDS: UiWidgetId[] = [
  "mission_state",
  "ledger",
  "citations",
  "page_state",
  "session_status",
  "plan_status",
  "transcript",
  "composer",
  "metrics",
  "runtime_events",
  "approvals",
  "tool_activity",
  "workspace_files",
  "web_signals",
  "agent_swarm",
];
const AREA_NAMES: UiAreaName[] = ["mainTop", "mainBody", "mainBottom", "inspector"];
const SHELL_ACTION_IDS: ShellActionId[] = [
  "toggle_sidebar",
  "new_thread",
  "status",
  "plan",
  "metrics",
  "events",
  "approvals",
  "workspace",
  "profiles",
  "settings",
];

export function normalizeTokensDocument(value: unknown, fallback: UiTokensDocument): UiTokensDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const themes = payload.themes !== null && typeof payload.themes === "object" ? (payload.themes as Record<string, unknown>) : {};
  const extraThemes = Object.fromEntries(
    Object.entries(themes)
      .filter(([key]) => key !== "dark" && key !== "light")
      .map(([key, themeValue]) => [key, normalizeTokenMap(themeValue, {})]),
  );
  return {
    themes: {
      dark: migrateLegacyDarkTokenMap(normalizeTokenMap(themes.dark, fallback.themes.dark)),
      light: normalizeTokenMap(themes.light, fallback.themes.light),
      ...extraThemes,
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

export function normalizeViewsDocument(value: unknown, fallback: UiViewsDocument): UiViewsDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawViews = Array.isArray(payload.views) ? payload.views : [];
  const views = rawViews.map(normalizeView).filter((view): view is UiViewDefinition => view !== null);
  const nextViews = views.length > 0 ? views : fallback.views;
  const activeViewId =
    typeof payload.activeViewId === "string" && nextViews.some((view) => view.id === payload.activeViewId)
      ? payload.activeViewId
      : nextViews[0]?.id ?? fallback.activeViewId;
  return {
    activeViewId,
    views: nextViews,
  };
}

export function normalizeDashboardsDocument(value: unknown, fallback: UiDashboardsDocument): UiDashboardsDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawDashboards = Array.isArray(payload.dashboards) ? payload.dashboards : [];
  const dashboards = rawDashboards
    .map((dashboard) => normalizeDashboard(dashboard, fallback))
    .filter((dashboard): dashboard is UiDashboardDefinition => dashboard !== null);
  return {
    dashboards: dashboards.length > 0 ? dashboards : fallback.dashboards,
  };
}

export function normalizeLayoutDocument(value: unknown, fallback: UiLayoutDocument): UiLayoutDocument {
  const payload = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const areasPayload = payload.areas !== null && typeof payload.areas === "object" ? (payload.areas as Record<string, unknown>) : {};
  return {
    showHeader: payload.showHeader !== false,
    chatPlacement: normalizeChatPlacement(payload.chatPlacement),
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
  const shell = payload.shell !== null && typeof payload.shell === "object" ? (payload.shell as Record<string, unknown>) : {};
  const runtimeEvents =
    payload.runtimeEvents !== null && typeof payload.runtimeEvents === "object"
      ? (payload.runtimeEvents as Record<string, unknown>)
      : {};
  const toolActivity =
    payload.toolActivity !== null && typeof payload.toolActivity === "object"
      ? (payload.toolActivity as Record<string, unknown>)
      : {};
  const workspaceFiles =
    payload.workspaceFiles !== null && typeof payload.workspaceFiles === "object"
      ? (payload.workspaceFiles as Record<string, unknown>)
      : {};
  const approvals =
    payload.approvals !== null && typeof payload.approvals === "object" ? (payload.approvals as Record<string, unknown>) : {};

  return {
    sessionStatus: {
      dense: payload.sessionStatus !== null && typeof payload.sessionStatus === "object"
        ? (payload.sessionStatus as Record<string, unknown>).dense === true
        : fallback.sessionStatus.dense,
    },
    planStatus: {
      showExplanation:
        payload.planStatus !== null && typeof payload.planStatus === "object"
          ? (payload.planStatus as Record<string, unknown>).showExplanation !== false
          : fallback.planStatus.showExplanation,
    },
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
    shell: {
      sidebarPrimaryAction: normalizeShellAction(shell.sidebarPrimaryAction, fallback.shell.sidebarPrimaryAction),
      sidebarFooterActions: normalizeShellActionList(shell.sidebarFooterActions, fallback.shell.sidebarFooterActions),
      headerLeadingActions: normalizeShellActionList(shell.headerLeadingActions, fallback.shell.headerLeadingActions),
      headerTrailingActions: normalizeShellActionList(shell.headerTrailingActions, fallback.shell.headerTrailingActions),
    },
    runtimeEvents: {
      compact: runtimeEvents.compact === true,
    },
    toolActivity: {
      compact: toolActivity.compact === true,
    },
    workspaceFiles: {
      maxItems:
        typeof workspaceFiles.maxItems === "number" && Number.isFinite(workspaceFiles.maxItems) && workspaceFiles.maxItems > 0
          ? Math.floor(workspaceFiles.maxItems)
          : fallback.workspaceFiles.maxItems,
      showPreview: workspaceFiles.showPreview !== false,
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

function normalizeView(value: unknown): UiViewDefinition | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || typeof payload.name !== "string" || typeof payload.dashboardId !== "string") {
    return null;
  }
  return {
    id: payload.id,
    name: payload.name,
    dashboardId: payload.dashboardId,
  };
}

function normalizeDashboard(value: unknown, fallback: UiDashboardsDocument): UiDashboardDefinition | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.id !== "string" || typeof payload.name !== "string") {
    return null;
  }
  const fallbackDashboard = fallback.dashboards.find((dashboard) => dashboard.id === payload.id) ?? fallback.dashboards[0];
  const fallbackLayout = fallbackDashboard?.layout ?? fallback.dashboards.find((dashboard) => dashboard.layout !== undefined)?.layout;
  const fallbackWidgets =
    fallbackDashboard?.widgets ?? fallback.dashboards.find((dashboard) => dashboard.widgets !== undefined)?.widgets;
  return {
    id: payload.id,
    name: payload.name,
    description: typeof payload.description === "string" ? payload.description : undefined,
    layout:
      payload.layout !== null && typeof payload.layout === "object" && fallbackLayout !== undefined
        ? normalizeLayoutDocument(payload.layout, fallbackLayout)
        : fallbackLayout,
    widgets:
      payload.widgets !== null && typeof payload.widgets === "object" && fallbackWidgets !== undefined
        ? normalizeWidgetsDocument(payload.widgets, fallbackWidgets)
        : fallbackWidgets,
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

function migrateLegacyDarkTokenMap(tokens: UiTokenMap): UiTokenMap {
  const migrated = { ...tokens };
  const replacements: Array<[keyof UiTokenMap, string, string]> = [
    ["bg", "#1f2024", "#201f1d"],
    ["sidebar", "#2a2c31", "#292826"],
    ["surface", "#303239", "#312f2d"],
    ["surfaceMuted", "#373a42", "#393633"],
    ["surfaceElevated", "#2b2f38", "#2b2927"],
    ["surfaceInput", "#232730", "#252321"],
    ["surfaceCard", "#313640", "#35322f"],
    ["border", "#474b55", "#4c4843"],
    ["textMuted", "#a0a6b1", "#aaa39a"],
    ["accent", "#6f8cff", "#b89d6a"],
    ["accentContrast", "#f8faff", "#1e1a14"],
    ["hover", "#353a45", "#3a3632"],
    ["badgeBg", "#2f3440", "#34302c"],
    ["badgeDot", "#7f8796", "#90877a"],
    ["messageUserBg", "#323845", "#3a3632"],
    ["composerFade", "linear-gradient(180deg, rgba(35, 37, 43, 0), rgba(35, 37, 43, 0.96) 32%)", "linear-gradient(180deg, rgba(37, 35, 33, 0), rgba(37, 35, 33, 0.96) 32%)"],
    ["overlay", "rgba(17, 24, 39, 0.32)", "rgba(18, 17, 15, 0.32)"],
    ["drawerBg", "rgba(43, 47, 56, 0.98)", "rgba(43, 40, 37, 0.98)"],
  ];
  for (const [key, legacyValue, nextValue] of replacements) {
    if (migrated[key] === legacyValue) {
      migrated[key] = nextValue;
    }
  }
  return migrated;
}

function normalizeTheme(value: unknown): UiTheme {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "dark";
}

function normalizeSidebarSide(value: unknown): SidebarSide {
  return value === "right" ? "right" : "left";
}

function normalizeInspectorMode(value: unknown): InspectorMode {
  return value === "column" ? "column" : value === "hidden" ? "hidden" : "drawer";
}

function normalizeChatPlacement(value: unknown): ChatFoundationPlacement {
  return value === "left" ? "left" : value === "right" ? "right" : "center";
}

function normalizeInspectorTab(value: unknown): InspectorTab {
  return value === "mission" ||
    value === "ledger" ||
    value === "citations" ||
    value === "page" ||
    value === "signals" ||
    value === "status" ||
    value === "plan" ||
    value === "metrics" ||
    value === "approvals" ||
    value === "workspace"
    ? value
    : "events";
}

function normalizeComposerPosition(value: unknown, fallback: ComposerPosition): ComposerPosition {
  return value === "top" ? "top" : value === "bottom" ? "bottom" : fallback;
}

function normalizeShellAction(value: unknown, fallback: ShellActionId): ShellActionId {
  return typeof value === "string" && SHELL_ACTION_IDS.includes(value as ShellActionId) ? (value as ShellActionId) : fallback;
}

function normalizeShellActionList(value: unknown, fallback: ShellActionId[]): ShellActionId[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const actions = value.filter(
    (entry): entry is ShellActionId => typeof entry === "string" && SHELL_ACTION_IDS.includes(entry as ShellActionId),
  );
  return actions.length > 0 ? actions : fallback;
}
