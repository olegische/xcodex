import { WIDGET_REGISTRY } from "./component-registry";
import { resolveActiveUiProfile } from "./profiles";
import type { MetricItem, UiRenderPlan, UiSystemDocument } from "./types";

export function buildUiRenderPlan(document: UiSystemDocument): UiRenderPlan {
  const profile = resolveActiveUiProfile(document.profiles);
  const areas = Object.fromEntries(
    Object.entries(document.layout.areas).map(([areaName, widgets]) => [
      areaName,
      widgets.flatMap((widget) => {
        const definition = WIDGET_REGISTRY[widget.id];
        if (definition === undefined || !definition.allowedAreas.includes(areaName as keyof typeof document.layout.areas)) {
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
    profile,
    sidebarSide: profile.sidebarSide,
    headerVisible: document.layout.showHeader,
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
