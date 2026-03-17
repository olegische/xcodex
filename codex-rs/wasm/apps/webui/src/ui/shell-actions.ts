import type { ShellActionId, ShellActionSpec, UiWidgetsDocument } from "./types";

const SHELL_ACTION_REGISTRY: Record<ShellActionId, ShellActionSpec> = {
  toggle_sidebar: {
    id: "toggle_sidebar",
    label: "Toggle Sidebar",
    shortLabel: "≡",
    ariaLabel: "Toggle sidebar",
  },
  new_thread: {
    id: "new_thread",
    label: "New Chat",
    shortLabel: "New",
    ariaLabel: "Start a new chat",
  },
  status: {
    id: "status",
    label: "Status",
    shortLabel: "S",
    ariaLabel: "Open session status",
  },
  plan: {
    id: "plan",
    label: "Plan",
    shortLabel: "P",
    ariaLabel: "Open plan status",
  },
  metrics: {
    id: "metrics",
    label: "Metrics",
    shortLabel: "M",
    ariaLabel: "Open metrics",
  },
  events: {
    id: "events",
    label: "Events",
    shortLabel: "=",
    ariaLabel: "Open events",
  },
  approvals: {
    id: "approvals",
    label: "Approvals",
    shortLabel: "OK",
    ariaLabel: "Open approvals",
  },
  workspace: {
    id: "workspace",
    label: "Artifacts",
    shortLabel: "FS",
    ariaLabel: "Open workspace files",
  },
  profiles: {
    id: "profiles",
    label: "Skins",
    shortLabel: "UI",
    ariaLabel: "Open profiles",
  },
  settings: {
    id: "settings",
    label: "Settings",
    shortLabel: "..",
    ariaLabel: "Open runtime settings",
  },
};

export function resolveShellAction(id: ShellActionId): ShellActionSpec {
  return SHELL_ACTION_REGISTRY[id];
}

export function buildShellActionSet(widgets: UiWidgetsDocument["shell"]) {
  return {
    sidebarPrimaryAction: resolveShellAction(widgets.sidebarPrimaryAction),
    sidebarFooterActions: widgets.sidebarFooterActions.map(resolveShellAction),
    headerLeadingActions: widgets.headerLeadingActions.map(resolveShellAction),
    headerTrailingActions: widgets.headerTrailingActions.map(resolveShellAction),
  };
}
