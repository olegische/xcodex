export type UiTheme = string;
export type SidebarSide = "left" | "right";
export type ComposerPosition = "top" | "bottom";
export type ChatFoundationPlacement = "center" | "left" | "right";
export type InspectorMode = "hidden" | "drawer" | "column";
export type InspectorTab = "status" | "plan" | "metrics" | "events" | "approvals" | "tools" | "workspace";
export type UiWidgetId =
  | "session_status"
  | "plan_status"
  | "transcript"
  | "composer"
  | "metrics"
  | "runtime_events"
  | "approvals"
  | "tool_activity"
  | "workspace_files";
export type UiAreaName = "mainTop" | "mainBody" | "mainBottom" | "inspector";
export type ShellActionId =
  | "toggle_sidebar"
  | "new_thread"
  | "status"
  | "plan"
  | "metrics"
  | "events"
  | "approvals"
  | "tools"
  | "workspace"
  | "profiles"
  | "settings";

export const UI_TOKEN_KEYS = [
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
  "badgeBg",
  "badgeDot",
  "successText",
  "successBg",
  "successBorder",
  "warningText",
  "warningBg",
  "warningBorder",
  "warningDot",
  "messageUserBg",
  "composerFade",
  "overlay",
  "drawerBg",
  "shadow",
] as const;

export type UiTokenKey = (typeof UI_TOKEN_KEYS)[number];
export type UiTokenMap = Partial<Record<UiTokenKey, string>>;

export type UiTokensDocument = {
  themes: Record<string, UiTokenMap>;
};

export type UiProfile = {
  id: string;
  name: string;
  theme: UiTheme;
  sidebarSide: SidebarSide;
  tokens?: UiTokenMap;
};

export type UiProfilesDocument = {
  activeProfileId: string;
  profiles: UiProfile[];
};

export type UiWidgetSpec = {
  id: UiWidgetId;
  title?: string;
};

export type UiLayoutDocument = {
  showHeader: boolean;
  chatPlacement: ChatFoundationPlacement;
  inspectorMode: InspectorMode;
  defaultInspectorTab: InspectorTab;
  areas: Record<UiAreaName, UiWidgetSpec[]>;
};

export type UiViewDefinition = {
  id: string;
  name: string;
  dashboardId: string;
};

export type UiViewsDocument = {
  activeViewId: string;
  views: UiViewDefinition[];
};

export type MetricsWidgetConfig = {
  items: string[];
};

export type TranscriptWidgetConfig = {
  variant: "bubble" | "flat";
};

export type ComposerWidgetConfig = {
  placeholder: string;
  position: ComposerPosition;
};

export type UiWidgetsDocument = {
  sessionStatus: {
    dense: boolean;
  };
  planStatus: {
    showExplanation: boolean;
  };
  metrics: MetricsWidgetConfig;
  transcript: TranscriptWidgetConfig;
  composer: ComposerWidgetConfig;
  shell: {
    sidebarPrimaryAction: ShellActionId;
    sidebarFooterActions: ShellActionId[];
    headerLeadingActions: ShellActionId[];
    headerTrailingActions: ShellActionId[];
  };
  runtimeEvents: {
    compact: boolean;
  };
  toolActivity: {
    compact: boolean;
  };
  workspaceFiles: {
    maxItems: number;
    showPreview: boolean;
  };
  approvals: {
    compact: boolean;
  };
};

export type UiDashboardDefinition = {
  id: string;
  name: string;
  description?: string;
  layout?: UiLayoutDocument;
  widgets?: UiWidgetsDocument;
};

export type UiDashboardsDocument = {
  dashboards: UiDashboardDefinition[];
};

export type UiSystemDocument = {
  tokens: UiTokensDocument;
  profiles: UiProfilesDocument;
  views: UiViewsDocument;
  dashboards: UiDashboardsDocument;
  layout: UiLayoutDocument;
  widgets: UiWidgetsDocument;
  activeView: UiViewDefinition | null;
  activeDashboard: UiDashboardDefinition | null;
};

export type MetricItem = {
  label: string;
  value: string;
};

export type RenderedWidget = {
  id: UiWidgetId;
  title: string;
};

export type ShellActionSpec = {
  id: ShellActionId;
  label: string;
  shortLabel: string;
  icon?: string;
  ariaLabel: string;
};

export type UiRenderPlan = {
  profile: UiProfile;
  sidebarSide: SidebarSide;
  headerVisible: boolean;
  chatPlacement: ChatFoundationPlacement;
  inspectorMode: InspectorMode;
  defaultInspectorTab: InspectorTab;
  areas: Record<UiAreaName, RenderedWidget[]>;
};
