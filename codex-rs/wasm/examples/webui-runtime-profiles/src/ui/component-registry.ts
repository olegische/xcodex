import type { UiAreaName, UiWidgetId } from "./types";

export type WidgetDefinition = {
  id: UiWidgetId;
  title: string;
  allowedAreas: UiAreaName[];
};

export const WIDGET_REGISTRY: Record<UiWidgetId, WidgetDefinition> = {
  transcript: {
    id: "transcript",
    title: "Transcript",
    allowedAreas: ["mainTop", "mainBody", "mainBottom"],
  },
  composer: {
    id: "composer",
    title: "Composer",
    allowedAreas: ["mainTop", "mainBottom"],
  },
  metrics: {
    id: "metrics",
    title: "Metrics",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
  },
  runtime_events: {
    id: "runtime_events",
    title: "Runtime Events",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
  },
  approvals: {
    id: "approvals",
    title: "Approvals",
    allowedAreas: ["inspector", "mainTop", "mainBottom"],
  },
};
