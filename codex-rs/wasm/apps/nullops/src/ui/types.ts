export type UiTheme = string;
export type SidebarSide = "left" | "right";
export type ComposerPosition = "top" | "bottom";
export type ChatFoundationPlacement = "center" | "left" | "right";
export type InspectorMode = "hidden" | "drawer" | "column";
export type InspectorTab =
  | "mission"
  | "ledger"
  | "citations"
  | "page"
  | "signals"
  | "status"
  | "plan"
  | "metrics"
  | "events"
  | "approvals"
  | "workspace";
export type UiWidgetId =
  | "mission_state"
  | "ledger"
  | "citations"
  | "page_state"
  | "session_status"
  | "plan_status"
  | "transcript"
  | "composer"
  | "metrics"
  | "runtime_events"
  | "approvals"
  | "tool_activity"
  | "workspace_files"
  | "web_signals"
  | "agent_swarm";
export type UiAreaName = "mainTop" | "mainBody" | "mainBottom" | "inspector";
export type ShellActionId =
  | "toggle_sidebar"
  | "new_thread"
  | "status"
  | "plan"
  | "metrics"
  | "events"
  | "approvals"
  | "workspace"
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

export type UiSystemDocument = {
  tokens: UiTokensDocument;
  views: UiViewsDocument;
  layout: UiLayoutDocument;
  widgets: UiWidgetsDocument;
  activeView: UiViewDefinition | null;
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
  sidebarSide: SidebarSide;
  headerVisible: boolean;
  chatPlacement: ChatFoundationPlacement;
  inspectorMode: InspectorMode;
  defaultInspectorTab: InspectorTab;
  areas: Record<UiAreaName, RenderedWidget[]>;
};
