use crate::client_common::tools::ResponsesApiNamespace;
use crate::client_common::tools::ResponsesApiNamespaceTool;
use crate::client_common::tools::ResponsesApiTool;
use crate::client_common::tools::ToolSearchOutputTool;
use crate::client_common::tools::ToolSpec as ClientToolSpec;
use crate::compat::rmcp::Tool;
use crate::function_tool::FunctionCallError;
use crate::mcp_connection_manager::ToolInfo;
use crate::tools::context::ToolPayload;
use crate::tools::context::ToolSearchOutput;
use bm25::Document;
use bm25::Language;
use bm25::SearchEngineBuilder;
use codex_protocol::models::SearchToolCallParams;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::HashMap;

pub(crate) const TOOL_SEARCH_TOOL_NAME: &str = "tool_search";
pub(crate) const DEFAULT_LIMIT: usize = 8;
const TOOL_SEARCH_DESCRIPTION_TEMPLATE: &str =
    include_str!("../../templates/search_tool/tool_description.md");

pub(crate) fn tool_search_spec(app_tools: &HashMap<String, ToolInfo>) -> ClientToolSpec {
    let mut app_names = app_tools
        .values()
        .filter_map(|tool| tool.connector_name.clone())
        .collect::<Vec<_>>();
    app_names.sort();
    app_names.dedup();
    let app_names = app_names.join(", ");
    let description = if app_names.is_empty() {
        TOOL_SEARCH_DESCRIPTION_TEMPLATE
            .replace("({{app_names}})", "(None currently enabled)")
            .replace("{{app_names}}", "available apps")
    } else {
        TOOL_SEARCH_DESCRIPTION_TEMPLATE.replace("{{app_names}}", app_names.as_str())
    };

    ClientToolSpec::ToolSearch {
        execution: "client".to_string(),
        description,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query for apps tools."
                },
                "limit": {
                    "type": "number",
                    "description": format!(
                        "Maximum number of tools to return (defaults to {DEFAULT_LIMIT})."
                    )
                }
            },
            "required": ["query"],
            "additionalProperties": false
        }),
    }
}

pub(crate) fn handle_tool_search(
    tools: &HashMap<String, ToolInfo>,
    payload: ToolPayload,
) -> Result<ToolSearchOutput, FunctionCallError> {
    let args = match payload {
        ToolPayload::ToolSearch { arguments } => arguments,
        _ => {
            return Err(FunctionCallError::Fatal(format!(
                "{TOOL_SEARCH_TOOL_NAME} handler received unsupported payload"
            )));
        }
    };

    search_tools(tools, args)
}

fn search_tools(
    tools: &HashMap<String, ToolInfo>,
    args: SearchToolCallParams,
) -> Result<ToolSearchOutput, FunctionCallError> {
    let query = args.query.trim();
    if query.is_empty() {
        return Err(FunctionCallError::RespondToModel(
            "query must not be empty".to_string(),
        ));
    }

    let limit = args.limit.unwrap_or(DEFAULT_LIMIT);
    if limit == 0 {
        return Err(FunctionCallError::RespondToModel(
            "limit must be greater than zero".to_string(),
        ));
    }

    let mut entries = tools.iter().collect::<Vec<_>>();
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    if entries.is_empty() {
        return Ok(ToolSearchOutput { tools: Vec::new() });
    }

    let documents = entries
        .iter()
        .enumerate()
        .map(|(idx, (name, info))| Document::new(idx, build_search_text(name, info)))
        .collect::<Vec<_>>();
    let search_engine =
        SearchEngineBuilder::<usize>::with_documents(Language::English, documents).build();
    let matched_entries = search_engine
        .search(query, limit)
        .into_iter()
        .filter_map(|result| entries.get(result.document.id).copied())
        .collect::<Vec<_>>();
    let tools = serialize_tool_search_output_tools(&matched_entries).map_err(|err| {
        FunctionCallError::Fatal(format!("failed to encode tool_search output: {err}"))
    })?;

    Ok(ToolSearchOutput { tools })
}

fn serialize_tool_search_output_tools(
    matched_entries: &[(&String, &ToolInfo)],
) -> Result<Vec<ToolSearchOutputTool>, serde_json::Error> {
    let grouped = matched_entries.iter().fold(
        BTreeMap::<String, Vec<&ToolInfo>>::new(),
        |mut acc, (_, tool)| {
            acc.entry(tool.tool_namespace.clone())
                .or_default()
                .push(*tool);
            acc
        },
    );

    let mut results = Vec::with_capacity(grouped.len());
    for (namespace, tools) in grouped {
        let Some(first_tool) = tools.first() else {
            continue;
        };

        let description = first_tool.connector_description.clone().or_else(|| {
            first_tool
                .connector_name
                .as_deref()
                .map(str::trim)
                .filter(|connector_name| !connector_name.is_empty())
                .map(|connector_name| format!("Tools for working with {connector_name}."))
        });

        let tools = tools
            .into_iter()
            .map(|tool| {
                mcp_tool_to_deferred_openai_tool(tool.tool_name.clone(), tool.tool.clone())
                    .map(ResponsesApiNamespaceTool::Function)
            })
            .collect::<Result<Vec<_>, _>>()?;

        results.push(ToolSearchOutputTool::Namespace(ResponsesApiNamespace {
            name: namespace,
            description: description.unwrap_or_default(),
            tools,
        }));
    }

    Ok(results)
}

fn mcp_tool_to_deferred_openai_tool(
    name: String,
    tool: Tool,
) -> Result<ResponsesApiTool, serde_json::Error> {
    let mut input_schema = Value::Object(tool.input_schema.as_ref().clone());
    sanitize_json_schema(&mut input_schema);

    Ok(ResponsesApiTool {
        name,
        description: tool.description.unwrap_or_default().to_string(),
        strict: false,
        defer_loading: Some(true),
        parameters: input_schema,
        output_schema: tool
            .output_schema
            .map(|schema| Value::Object(schema.as_ref().clone())),
    })
}

fn sanitize_json_schema(schema: &mut Value) {
    match schema {
        Value::Object(map) => {
            if map.get("properties").is_none_or(Value::is_null) {
                map.insert(
                    "properties".to_string(),
                    Value::Object(serde_json::Map::new()),
                );
            }

            if let Some(properties) = map.get_mut("properties")
                && let Value::Object(properties) = properties
            {
                for value in properties.values_mut() {
                    sanitize_json_schema(value);
                }
            }

            if let Some(items) = map.get_mut("items") {
                sanitize_json_schema(items);
            }

            if let Some(additional_properties) = map.get_mut("additionalProperties")
                && !matches!(additional_properties, Value::Bool(_))
            {
                sanitize_json_schema(additional_properties);
            }
        }
        Value::Array(items) => {
            for item in items {
                sanitize_json_schema(item);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn build_search_text(name: &str, info: &ToolInfo) -> String {
    let mut parts = vec![
        name.to_string(),
        info.tool_name.clone(),
        info.server_name.clone(),
    ];

    if let Some(title) = info.tool.title.as_deref()
        && !title.trim().is_empty()
    {
        parts.push(title.to_string());
    }

    if let Some(description) = info.tool.description.as_deref()
        && !description.trim().is_empty()
    {
        parts.push(description.to_string());
    }

    if let Some(connector_name) = info.connector_name.as_deref()
        && !connector_name.trim().is_empty()
    {
        parts.push(connector_name.to_string());
    }

    if let Some(connector_description) = info.connector_description.as_deref()
        && !connector_description.trim().is_empty()
    {
        parts.push(connector_description.to_string());
    }

    parts.extend(
        info.tool
            .input_schema
            .get("properties")
            .and_then(Value::as_object)
            .map(|map| map.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
    );

    parts.join(" ")
}

#[cfg(test)]
#[path = "tool_search_handler_tests.rs"]
mod tests;
