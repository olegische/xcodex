export type DynamicToolTarget = {
  toolNamespace: string;
  toolName: string;
};

export function qualifyDynamicToolName(tool: DynamicToolTarget): string {
  if (tool.toolNamespace === "browser") {
    return tool.toolName.startsWith("browser__") ? tool.toolName : `browser__${tool.toolName}`;
  }
  const prefix = `${tool.toolNamespace}__`;
  return tool.toolName.startsWith(prefix) ? tool.toolName : `${prefix}${tool.toolName}`;
}

export function unqualifyBrowserToolName(tool: DynamicToolTarget): string {
  if (tool.toolNamespace !== "browser") {
    return tool.toolName;
  }
  return tool.toolName.replace(/^browser__/, "");
}

export function resolveDynamicToolTarget(toolName: string): DynamicToolTarget | null {
  if (toolName.startsWith("browser__")) {
    return {
      toolNamespace: "browser",
      toolName,
    };
  }
  const match = /^([a-z0-9_]+)__(.+)$/i.exec(toolName);
  if (match === null) {
    return null;
  }
  return {
    toolNamespace: match[1] ?? "browser",
    toolName,
  };
}

export function splitQualifiedToolNameForCodex(name: string): {
  name: string;
  namespace?: string;
} {
  if (name.startsWith("browser__")) {
    return {
      name: name.slice("browser__".length),
      namespace: "browser",
    };
  }
  if (name.startsWith("mcp__")) {
    const stripped = name.slice("mcp__".length);
    const separatorIndex = stripped.indexOf("__");
    if (separatorIndex !== -1) {
      const serverName = stripped.slice(0, separatorIndex);
      return {
        name: stripped.slice(separatorIndex + "__".length),
        namespace: `mcp__${serverName}__`,
      };
    }
  }
  return { name };
}
