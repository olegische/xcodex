import { WIDGET_REGISTRY } from "./component-registry";
import type { MetricItem, UiRenderPlan, UiSystemDocument } from "./types";

export function buildUiRenderPlan(document: UiSystemDocument): UiRenderPlan {
  const rawAreas = {
    mainTop: document.layout.areas.mainTop ?? [],
    mainBody: document.layout.areas.mainBody ?? [],
    mainBottom: document.layout.areas.mainBottom ?? [],
    inspector: document.layout.areas.inspector ?? [],
  };
  const areas = Object.fromEntries(
    Object.entries(rawAreas).map(([areaName, widgets]) => [
      areaName,
      widgets.flatMap((widget) => {
        const definition = WIDGET_REGISTRY[widget.id];
        if (definition === undefined || !definition.allowedAreas.includes(areaName as keyof typeof rawAreas)) {
          return [];
        }
        return [
          {
            id: widget.id,
            title: widget.title ?? definition.title,
          },
        ];
      }),
    ]),
  ) as UiRenderPlan["areas"];

  return {
    sidebarSide: "left",
    headerVisible: document.layout.showHeader,
    chatPlacement: document.layout.chatPlacement,
    inspectorMode: document.layout.inspectorMode,
    defaultInspectorTab: document.layout.defaultInspectorTab,
    areas,
  };
}

export function buildMetrics(items: string[], values: Record<string, string>): MetricItem[] {
  return items.map((item) => ({
    label: metricLabel(item),
    value: values[item] ?? "n/a",
  }));
}

function metricLabel(item: string): string {
  return item
    .split(/[_-]/)
    .map((part) => (part.length > 0 ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}
