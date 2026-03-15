use crate::host::HostToolSpec;
use bm25::Document;
use bm25::Language;
use bm25::SearchEngineBuilder;
use serde::Deserialize;
use serde_json::Map;
use serde_json::Value;
use std::collections::BTreeMap;

pub const TOOL_SEARCH_TOOL_NAME: &str = "tool_search";
pub const DEFAULT_LIMIT: usize = 8;
const BROWSER_NAMESPACE_DESCRIPTION: &str = "Browser-native page and interaction tools.";
const TOOL_SEARCH_DESCRIPTION_TEMPLATE: &str =
    include_str!("../../../core/templates/search_tool/tool_description.md");

#[derive(Debug, Deserialize, PartialEq, Eq)]
pub struct ToolSearchArgs {
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Clone)]
struct MatchedTool<'a> {
    spec: &'a HostToolSpec,
    namespace: Option<String>,
    child_name: String,
}

pub fn create_tool_search_transport_tool(host_tools: &[HostToolSpec]) -> Option<Value> {
    if host_tools.is_empty() {
        return None;
    }

    let description = tool_search_description(host_tools);
    Some(Value::Object(Map::from_iter([
        ("type".to_string(), Value::String("tool_search".to_string())),
        ("execution".to_string(), Value::String("client".to_string())),
        ("description".to_string(), Value::String(description)),
        (
            "parameters".to_string(),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for apps tools."
                    },
                    "limit": {
                        "type": "number",
                        "description": format!("Maximum number of tools to return (defaults to {DEFAULT_LIMIT}).")
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        ),
    ])))
}

pub fn qualify_tool_name(name: &str, namespace: Option<&str>) -> String {
    match namespace {
        Some("browser") if !name.starts_with("browser__") => format!("browser__{name}"),
        Some(namespace) if !name.starts_with("mcp__") => format!("mcp__{namespace}__{name}"),
        _ => name.to_string(),
    }
}

pub fn search_tools(
    host_tools: &[HostToolSpec],
    query: &str,
    limit: usize,
) -> Result<Vec<Value>, serde_json::Error> {
    let query = query.trim();
    if query.is_empty() || host_tools.is_empty() {
        return Ok(Vec::new());
    }

    let documents = host_tools
        .iter()
        .enumerate()
        .map(|(idx, tool)| Document::new(idx, build_search_text(tool)))
        .collect::<Vec<_>>();
    let search_engine =
        SearchEngineBuilder::<usize>::with_documents(Language::English, documents).build();
    let matches = search_engine.search(query, limit);
    let matched_tools = matches
        .into_iter()
        .filter_map(|result| host_tools.get(result.document.id))
        .map(|spec| MatchedTool {
            spec,
            namespace: spec.tool_namespace.clone(),
            child_name: spec.tool_name.clone(),
        })
        .collect::<Vec<_>>();

    serialize_tool_search_output_tools(&matched_tools)
}

fn tool_search_description(host_tools: &[HostToolSpec]) -> String {
    let mut app_names = host_tools
        .iter()
        .filter_map(|tool| tool.tool_namespace.as_deref())
        .map(|namespace| {
            namespace
                .strip_prefix("mcp__")
                .and_then(|trimmed| trimmed.strip_suffix("__"))
                .unwrap_or(namespace)
                .to_string()
        })
        .collect::<Vec<_>>();
    app_names.sort();
    app_names.dedup();
    let app_names = if app_names.is_empty() {
        "available apps".to_string()
    } else {
        app_names.join(", ")
    };

    TOOL_SEARCH_DESCRIPTION_TEMPLATE.replace("{{app_names}}", &app_names)
}

fn serialize_tool_search_output_tools(
    matched_tools: &[MatchedTool<'_>],
) -> Result<Vec<Value>, serde_json::Error> {
    let mut grouped = BTreeMap::<String, Vec<&MatchedTool<'_>>>::new();
    let mut results = Vec::new();

    for tool in matched_tools {
        if let Some(namespace) = tool.namespace.clone() {
            grouped.entry(namespace).or_default().push(tool);
        } else {
            results.push(deferred_function_tool_json(
                &tool.spec.tool_name,
                &tool.spec.description,
                tool.spec.input_schema.clone(),
            )?);
        }
    }

    for (namespace, tools) in grouped {
        let description = tools
            .first()
            .map(|tool| namespace_description(&namespace, tool.spec.description.as_str()))
            .unwrap_or_default();
        let child_tools = tools
            .into_iter()
            .map(|tool| {
                deferred_function_tool_json(
                    &tool.child_name,
                    &tool.spec.description,
                    tool.spec.input_schema.clone(),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        results.push(serde_json::json!({
            "type": "namespace",
            "name": namespace,
            "description": description,
            "tools": child_tools,
        }));
    }

    Ok(results)
}

fn deferred_function_tool_json(
    name: &str,
    description: &str,
    parameters: Value,
) -> Result<Value, serde_json::Error> {
    serde_json::to_value(serde_json::json!({
        "type": "function",
        "name": name,
        "description": description,
        "strict": false,
        "defer_loading": true,
        "parameters": parameters,
    }))
}

fn namespace_description(namespace: &str, fallback: &str) -> String {
    if namespace == "browser" {
        return BROWSER_NAMESPACE_DESCRIPTION.to_string();
    }
    if namespace.is_empty() {
        return fallback.to_string();
    }
    let display_namespace = namespace
        .strip_prefix("mcp__")
        .and_then(|trimmed| trimmed.strip_suffix("__"))
        .unwrap_or(namespace);
    format!("Tools for working with {display_namespace}.")
}

fn build_search_text(tool: &HostToolSpec) -> String {
    let mut parts = vec![tool.tool_name.clone(), tool.description.clone()];
    if let Some(namespace) = tool.tool_namespace.clone() {
        parts.push(namespace);
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    #[test]
    fn qualify_tool_name_appends_namespace_prefix_for_deferred_children() {
        assert_eq!(
            qualify_tool_name("notion-search", Some("notion")),
            "mcp__notion__notion-search"
        );
        assert_eq!(
            qualify_tool_name("mcp__notion__notion-search", Some("mcp__notion__")),
            "mcp__notion__notion-search"
        );
        assert_eq!(
            qualify_tool_name("click", Some("browser")),
            "browser__click"
        );
    }

    #[test]
    fn create_tool_search_transport_tool_uses_responses_shape() {
        let tool = create_tool_search_transport_tool(&[HostToolSpec {
            tool_name: "notion-search".to_string(),
            tool_namespace: Some("notion".to_string()),
            description: "Search Notion".to_string(),
            input_schema: json!({"type": "object"}),
        }])
        .expect("tool_search should be exposed");

        assert_eq!(
            tool,
            json!({
                "type": "tool_search",
                "execution": "client",
                "description": "# Apps tool discovery\n\nSearches over apps tool metadata with BM25 and exposes matching tools for the next model call.\n\nTools of the apps (notion) are hidden until you search for them with this tool (`tool_search`).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for apps tools."
                        },
                        "limit": {
                            "type": "number",
                            "description": "Maximum number of tools to return (defaults to 8)."
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }
            })
        );
    }

    #[test]
    fn search_tools_groups_browser_and_mcp_tools_by_namespace() {
        let tools = vec![
            HostToolSpec {
                tool_name: "page_context".to_string(),
                tool_namespace: Some("browser".to_string()),
                description: "Inspect the current page context.".to_string(),
                input_schema: json!({"type": "object"}),
            },
            HostToolSpec {
                tool_name: "notion-search".to_string(),
                tool_namespace: Some("mcp__notion__".to_string()),
                description: "Search Notion workspace content.".to_string(),
                input_schema: json!({"type": "object"}),
            },
        ];

        let output = search_tools(&tools, "page notion", 8).expect("search tools");

        assert_eq!(
            output,
            vec![
                json!({
                    "type": "namespace",
                    "name": "browser",
                    "description": "Browser-native page and interaction tools.",
                    "tools": [{
                        "type": "function",
                        "name": "page_context",
                        "description": "Inspect the current page context.",
                        "strict": false,
                        "defer_loading": true,
                        "parameters": {"type": "object"}
                    }]
                }),
                json!({
                    "type": "namespace",
                    "name": "mcp__notion__",
                    "description": "Tools for working with notion.",
                    "tools": [{
                        "type": "function",
                        "name": "notion-search",
                        "description": "Search Notion workspace content.",
                        "strict": false,
                        "defer_loading": true,
                        "parameters": {"type": "object"}
                    }]
                }),
            ]
        );
    }
}
