export type UiTheme = "dark" | "light";
export type SidebarSide = "left" | "right";
export type ComposerPosition = "top" | "bottom";
export type InspectorMode = "hidden" | "drawer" | "column";
export type InspectorTab = "events" | "approvals";
export type UiWidgetId = "transcript" | "composer" | "metrics" | "runtime_events" | "approvals";
export type UiAreaName = "mainTop" | "mainBody" | "mainBottom" | "inspector";

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
  themes: Record<UiTheme, UiTokenMap>;
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
  inspectorMode: InspectorMode;
  defaultInspectorTab: InspectorTab;
  areas: Record<UiAreaName, UiWidgetSpec[]>;
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
  metrics: MetricsWidgetConfig;
  transcript: TranscriptWidgetConfig;
  composer: ComposerWidgetConfig;
  runtimeEvents: {
    compact: boolean;
  };
  approvals: {
    compact: boolean;
  };
};

export type UiSystemDocument = {
  tokens: UiTokensDocument;
  profiles: UiProfilesDocument;
  layout: UiLayoutDocument;
  widgets: UiWidgetsDocument;
};

export type MetricItem = {
  label: string;
  value: string;
};

export type RenderedWidget = {
  id: UiWidgetId;
  title: string;
};

export type UiRenderPlan = {
  profile: UiProfile;
  sidebarSide: SidebarSide;
  headerVisible: boolean;
  inspectorMode: InspectorMode;
  defaultInspectorTab: InspectorTab;
  areas: Record<UiAreaName, RenderedWidget[]>;
};
