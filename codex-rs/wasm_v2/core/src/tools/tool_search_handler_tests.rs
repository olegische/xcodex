use super::*;
use crate::client_common::tools::ResponsesApiNamespace;
use crate::mcp::CODEX_APPS_MCP_SERVER_NAME;
use pretty_assertions::assert_eq;
use rmcp::model::JsonObject;
use serde_json::json;
use std::sync::Arc;

fn tool(
    name: &str,
    description: &str,
    namespace: &str,
    connector_name: Option<&str>,
    connector_description: Option<&str>,
) -> ToolInfo {
    ToolInfo {
        server_name: CODEX_APPS_MCP_SERVER_NAME.to_string(),
        tool_name: name.to_string(),
        tool_namespace: namespace.to_string(),
        tool: Tool {
            name: name.to_string().into(),
            title: None,
            description: Some(description.to_string().into()),
            input_schema: Arc::new(JsonObject::from_iter([
                ("type".to_string(), json!("object")),
                (
                    "properties".to_string(),
                    json!({
                        "email": { "type": "string" }
                    }),
                ),
            ])),
            output_schema: None,
            annotations: None,
            execution: None,
            icons: None,
            meta: None,
        },
        connector_id: connector_name.map(str::to_lowercase),
        connector_name: connector_name.map(str::to_string),
        plugin_display_names: Vec::new(),
        connector_description: connector_description.map(str::to_string),
    }
}

#[test]
fn tool_search_spec_lists_enabled_apps() {
    let spec = tool_search_spec(&HashMap::from([
        (
            "mcp__codex_apps__calendar_create_event".to_string(),
            tool(
                "-create-event",
                "Create a calendar event.",
                "mcp__codex_apps__calendar",
                Some("Calendar"),
                Some("Plan events"),
            ),
        ),
        (
            "mcp__codex_apps__gmail_read_email".to_string(),
            tool(
                "-read-email",
                "Read an email.",
                "mcp__codex_apps__gmail",
                Some("Gmail"),
                Some("Read mail"),
            ),
        ),
    ]));

    let crate::client_common::tools::ToolSpec::ToolSearch { description, .. } = spec else {
        panic!("expected tool_search spec");
    };

    assert!(description.contains("Calendar"));
    assert!(description.contains("Gmail"));
}

#[test]
fn tool_search_spec_handles_no_enabled_apps() {
    let crate::client_common::tools::ToolSpec::ToolSearch { description, .. } =
        tool_search_spec(&HashMap::new())
    else {
        panic!("expected tool_search spec");
    };

    assert!(description.contains("(None currently enabled)"));
    assert!(!description.contains("{{app_names}}"));
}

#[test]
fn serialize_tool_search_output_tools_groups_results_by_namespace() {
    let entries = [
        (
            "mcp__codex_apps__calendar_create_event".to_string(),
            tool(
                "-create-event",
                "Create a calendar event.",
                "mcp__codex_apps__calendar",
                Some("Calendar"),
                Some("Plan events"),
            ),
        ),
        (
            "mcp__codex_apps__gmail_read_email".to_string(),
            tool(
                "-read-email",
                "Read an email.",
                "mcp__codex_apps__gmail",
                Some("Gmail"),
                Some("Read mail"),
            ),
        ),
        (
            "mcp__codex_apps__calendar_list_events".to_string(),
            tool(
                "-list-events",
                "List calendar events.",
                "mcp__codex_apps__calendar",
                Some("Calendar"),
                Some("Plan events"),
            ),
        ),
    ];

    let tools = serialize_tool_search_output_tools(&[
        (&entries[0].0, &entries[0].1),
        (&entries[1].0, &entries[1].1),
        (&entries[2].0, &entries[2].1),
    ])
    .expect("serialize tool search output");

    assert_eq!(
        tools,
        vec![
            ToolSearchOutputTool::Namespace(ResponsesApiNamespace {
                name: "mcp__codex_apps__calendar".to_string(),
                description: "Plan events".to_string(),
                tools: vec![
                    ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                        name: "-create-event".to_string(),
                        description: "Create a calendar event.".to_string(),
                        strict: false,
                        defer_loading: Some(true),
                        parameters: json!({
                            "type": "object",
                            "properties": {
                                "email": {
                                    "type": "string",
                                    "properties": {}
                                }
                            }
                        }),
                        output_schema: None,
                    }),
                    ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                        name: "-list-events".to_string(),
                        description: "List calendar events.".to_string(),
                        strict: false,
                        defer_loading: Some(true),
                        parameters: json!({
                            "type": "object",
                            "properties": {
                                "email": {
                                    "type": "string",
                                    "properties": {}
                                }
                            }
                        }),
                        output_schema: None,
                    }),
                ],
            }),
            ToolSearchOutputTool::Namespace(ResponsesApiNamespace {
                name: "mcp__codex_apps__gmail".to_string(),
                description: "Read mail".to_string(),
                tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                    name: "-read-email".to_string(),
                    description: "Read an email.".to_string(),
                    strict: false,
                    defer_loading: Some(true),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "email": {
                                "type": "string",
                                "properties": {}
                            }
                        }
                    }),
                    output_schema: None,
                })],
            }),
        ]
    );
}

#[test]
fn serialize_tool_search_output_tools_falls_back_to_connector_name_description() {
    let entry = (
        "mcp__codex_apps__gmail_batch_read_email".to_string(),
        tool(
            "-batch-read-email",
            "Read multiple emails.",
            "mcp__codex_apps__gmail",
            Some("Gmail"),
            None,
        ),
    );

    let tools = serialize_tool_search_output_tools(&[(&entry.0, &entry.1)]).expect("serialize");

    assert_eq!(
        tools,
        vec![ToolSearchOutputTool::Namespace(ResponsesApiNamespace {
            name: "mcp__codex_apps__gmail".to_string(),
            description: "Tools for working with Gmail.".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: "-batch-read-email".to_string(),
                description: "Read multiple emails.".to_string(),
                strict: false,
                defer_loading: Some(true),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "email": {
                            "type": "string",
                            "properties": {}
                        }
                    }
                }),
                output_schema: None,
            })],
        })]
    );
}

#[test]
fn handle_tool_search_rejects_empty_query() {
    let err = match handle_tool_search(
        &HashMap::new(),
        ToolPayload::ToolSearch {
            arguments: SearchToolCallParams {
                query: "   ".to_string(),
                limit: None,
            },
        },
    ) {
        Ok(_) => panic!("expected empty query to fail"),
        Err(err) => err,
    };

    assert_eq!(
        err,
        FunctionCallError::RespondToModel("query must not be empty".to_string())
    );
}

#[test]
fn handle_tool_search_rejects_zero_limit() {
    let err = match handle_tool_search(
        &HashMap::new(),
        ToolPayload::ToolSearch {
            arguments: SearchToolCallParams {
                query: "calendar".to_string(),
                limit: Some(0),
            },
        },
    ) {
        Ok(_) => panic!("expected zero limit to fail"),
        Err(err) => err,
    };

    assert_eq!(
        err,
        FunctionCallError::RespondToModel("limit must be greater than zero".to_string())
    );
}

#[test]
fn handle_tool_search_returns_ranked_namespace_matches() {
    let tools = HashMap::from([
        (
            "mcp__codex_apps__calendar_create_event".to_string(),
            tool(
                "-create-event",
                "Create a calendar event.",
                "mcp__codex_apps__calendar",
                Some("Calendar"),
                Some("Plan events"),
            ),
        ),
        (
            "mcp__codex_apps__gmail_read_email".to_string(),
            tool(
                "-read-email",
                "Read an email.",
                "mcp__codex_apps__gmail",
                Some("Gmail"),
                Some("Read mail"),
            ),
        ),
    ]);

    let output = handle_tool_search(
        &tools,
        ToolPayload::ToolSearch {
            arguments: SearchToolCallParams {
                query: "calendar event".to_string(),
                limit: Some(2),
            },
        },
    )
    .expect("tool search should succeed");

    assert_eq!(output.tools.len(), 1);
    assert_eq!(
        output.tools[0],
        ToolSearchOutputTool::Namespace(ResponsesApiNamespace {
            name: "mcp__codex_apps__calendar".to_string(),
            description: "Plan events".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: "-create-event".to_string(),
                description: "Create a calendar event.".to_string(),
                strict: false,
                defer_loading: Some(true),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "email": {
                            "type": "string",
                            "properties": {}
                        }
                    }
                }),
                output_schema: None,
            })],
        })
    );
}
