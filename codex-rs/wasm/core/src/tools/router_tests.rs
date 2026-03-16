use super::*;
use crate::mcp::CODEX_APPS_MCP_SERVER_NAME;
use crate::tools::discoverable::DiscoverableTool;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use pretty_assertions::assert_eq;
use rmcp::model::JsonObject;
use serde_json::json;
use std::sync::Arc;

fn app_tool(name: &str, namespace: &str, connector_name: &str) -> ToolInfo {
    ToolInfo {
        server_name: CODEX_APPS_MCP_SERVER_NAME.to_string(),
        tool_name: name.to_string(),
        tool_namespace: namespace.to_string(),
        tool: Tool {
            name: name.to_string().into(),
            title: None,
            description: Some(format!("{name} description").into()),
            input_schema: Arc::new(JsonObject::from_iter([(
                "type".to_string(),
                json!("object"),
            )])),
            output_schema: None,
            annotations: None,
            execution: None,
            icons: None,
            meta: None,
        },
        connector_id: Some(connector_name.to_lowercase()),
        connector_name: Some(connector_name.to_string()),
        plugin_display_names: Vec::new(),
        connector_description: None,
    }
}

#[test]
fn router_publishes_tool_search_when_enabled_for_apps() {
    let router = ToolRouter::from_config(
        &crate::tools::spec::ToolsConfig {
            search_tool: true,
            ..crate::tools::spec::ToolsConfig::default()
        },
        ToolRouterParams {
            mcp_tools: None,
            app_tools: Some(HashMap::from([(
                "mcp__codex_apps__calendar_create_event".to_string(),
                app_tool("-create-event", "mcp__codex_apps__calendar", "Calendar"),
            )])),
            discoverable_tools: None,
            dynamic_tools: &[],
        },
    );

    assert_eq!(
        router
            .specs()
            .into_iter()
            .filter(|spec| matches!(
                spec,
                crate::client_common::tools::ToolSpec::ToolSearch { .. }
            ))
            .count(),
        1
    );
    assert!(router.tool_supports_parallel("tool_search"));
}

#[test]
fn router_omits_tool_search_without_app_tools() {
    let router = ToolRouter::from_config(
        &crate::tools::spec::ToolsConfig {
            search_tool: true,
            ..crate::tools::spec::ToolsConfig::default()
        },
        ToolRouterParams {
            mcp_tools: None,
            app_tools: None,
            discoverable_tools: None,
            dynamic_tools: &[],
        },
    );

    assert!(!router.specs().into_iter().any(|spec| matches!(
        spec,
        crate::client_common::tools::ToolSpec::ToolSearch { .. }
    )));
}

#[test]
fn router_publishes_tool_suggest_when_enabled_for_discoverable_tools() {
    let router = ToolRouter::from_config(
        &crate::tools::spec::ToolsConfig {
            tool_suggest: true,
            ..crate::tools::spec::ToolsConfig::default()
        },
        ToolRouterParams {
            mcp_tools: None,
            app_tools: None,
            discoverable_tools: Some(vec![DiscoverableTool::Connector(Box::new(
                crate::connectors::AppInfo {
                    id: "calendar".to_string(),
                    name: "Google Calendar".to_string(),
                    description: Some("Plan events and schedules.".to_string()),
                    logo_url: None,
                    logo_url_dark: None,
                    distribution_channel: None,
                    branding: None,
                    app_metadata: None,
                    labels: None,
                    install_url: Some(
                        "https://chatgpt.com/apps/google-calendar/calendar".to_string(),
                    ),
                    is_accessible: false,
                    is_enabled: false,
                    plugin_display_names: Vec::new(),
                },
            ))]),
            dynamic_tools: &[],
        },
    );

    assert_eq!(
        router
            .specs()
            .into_iter()
            .filter(|spec| matches!(
                spec,
                crate::client_common::tools::ToolSpec::Function(tool) if tool.name == "tool_suggest"
            ))
            .count(),
        1
    );
    assert!(router.tool_supports_parallel("tool_suggest"));
}

#[test]
fn router_resolves_browser_namespace_dynamic_tools() {
    let dynamic_tools = [DynamicToolSpec {
        name: "browser__page_context".to_string(),
        description: "Inspect page context".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
    }];
    let router = ToolRouter::from_config(
        &crate::tools::spec::ToolsConfig::default(),
        ToolRouterParams {
            mcp_tools: None,
            app_tools: None,
            discoverable_tools: None,
            dynamic_tools: &dynamic_tools,
        },
    );

    assert_eq!(
        router.resolve_dynamic_tool_name("page_context", Some("browser")),
        Some("browser__page_context".to_string())
    );
    assert_eq!(
        router.resolve_dynamic_tool_name("page_context", None),
        Some("browser__page_context".to_string())
    );
}
