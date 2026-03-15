use crate::client_common::tools::ResponsesApiTool;
use crate::client_common::tools::ToolSpec as ClientToolSpec;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::compat::rmcp::RequestId;
use crate::connectors;
use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::discoverable::DiscoverableTool;
use crate::tools::discoverable::DiscoverableToolAction;
use crate::tools::discoverable::DiscoverableToolType;
use codex_app_server_protocol::AppInfo;
use codex_app_server_protocol::McpElicitationObjectType;
use codex_app_server_protocol::McpElicitationSchema;
use codex_app_server_protocol::McpServerElicitationRequest;
use codex_app_server_protocol::McpServerElicitationRequestParams;
use codex_protocol::models::FunctionCallOutputContentItem;
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::collections::HashSet;

pub(crate) const TOOL_SUGGEST_TOOL_NAME: &str = "tool_suggest";
const TOOL_SUGGEST_APPROVAL_KIND_VALUE: &str = "tool_suggestion";
const TOOL_SUGGEST_DESCRIPTION_TEMPLATE: &str =
    include_str!("../../templates/search_tool/tool_suggest_description.md");

#[derive(Debug, Deserialize)]
struct ToolSuggestArgs {
    tool_type: DiscoverableToolType,
    action_type: DiscoverableToolAction,
    tool_id: String,
    suggest_reason: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct ToolSuggestResult {
    completed: bool,
    user_confirmed: bool,
    tool_type: DiscoverableToolType,
    action_type: DiscoverableToolAction,
    tool_id: String,
    tool_name: String,
    suggest_reason: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct ToolSuggestMeta<'a> {
    codex_approval_kind: &'static str,
    tool_type: DiscoverableToolType,
    suggest_type: DiscoverableToolAction,
    suggest_reason: &'a str,
    tool_id: &'a str,
    tool_name: &'a str,
    install_url: &'a str,
}

pub(crate) fn tool_suggest_spec(discoverable_tools: &[DiscoverableTool]) -> ClientToolSpec {
    ClientToolSpec::Function(ResponsesApiTool {
        name: TOOL_SUGGEST_TOOL_NAME.to_string(),
        description: TOOL_SUGGEST_DESCRIPTION_TEMPLATE.replace(
            "{{discoverable_tools}}",
            format_discoverable_tools(discoverable_tools).as_str(),
        ),
        strict: false,
        defer_loading: None,
        parameters: json!({
            "type": "object",
            "properties": {
                "tool_type": {
                    "type": "string",
                    "description": "Type of discoverable tool to suggest. Use \"connector\" or \"plugin\"."
                },
                "action_type": {
                    "type": "string",
                    "description": "Suggested action for the tool. Use \"install\" or \"enable\"."
                },
                "tool_id": {
                    "type": "string",
                    "description": format!(
                        "Connector or plugin id to suggest. Must be one of: {}.",
                        discoverable_tools
                            .iter()
                            .map(DiscoverableTool::id)
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                },
                "suggest_reason": {
                    "type": "string",
                    "description": "Concise one-line user-facing reason why this tool can help with the current request."
                }
            },
            "required": ["tool_type", "action_type", "tool_id", "suggest_reason"],
            "additionalProperties": false
        }),
        output_schema: None,
    })
}

pub(crate) async fn handle_tool_suggest(
    session: &Session,
    turn: &TurnContext,
    call_id: String,
    payload: ToolPayload,
    discoverable_tools: &[DiscoverableTool],
) -> Result<FunctionToolOutput, FunctionCallError> {
    let arguments = match payload {
        ToolPayload::Function { arguments } => arguments,
        _ => {
            return Err(FunctionCallError::Fatal(format!(
                "{TOOL_SUGGEST_TOOL_NAME} handler received unsupported payload"
            )));
        }
    };

    let args: ToolSuggestArgs = serde_json::from_str(&arguments).map_err(|err| {
        FunctionCallError::RespondToModel(format!("failed to parse function arguments: {err}"))
    })?;
    let suggest_reason = args.suggest_reason.trim();
    if suggest_reason.is_empty() {
        return Err(FunctionCallError::RespondToModel(
            "suggest_reason must not be empty".to_string(),
        ));
    }
    if args.tool_type == DiscoverableToolType::Plugin {
        return Err(FunctionCallError::RespondToModel(
            "plugin tool suggestions are not currently available".to_string(),
        ));
    }
    if args.action_type != DiscoverableToolAction::Install {
        return Err(FunctionCallError::RespondToModel(
            "connector tool suggestions currently support only action_type=\"install\"".to_string(),
        ));
    }

    let connector = discoverable_tools
        .iter()
        .find_map(|tool| match tool {
            DiscoverableTool::Connector(connector) if connector.id == args.tool_id => {
                Some(connector.as_ref().clone())
            }
            DiscoverableTool::Connector(_) | DiscoverableTool::Plugin(_) => None,
        })
        .ok_or_else(|| {
            FunctionCallError::RespondToModel(format!(
                "tool_id must match one of the discoverable tools exposed by {TOOL_SUGGEST_TOOL_NAME}"
            ))
        })?;

    let request_id = RequestId::String(format!("tool_suggestion_{call_id}").into());
    let params = build_tool_suggestion_elicitation_request(
        session.conversation_id.to_string(),
        turn.sub_id.clone(),
        &args,
        suggest_reason,
        &connector,
    );
    let response = session
        .request_mcp_server_elicitation(turn, request_id, params)
        .await;
    let user_confirmed = response
        .as_ref()
        .is_some_and(|response| response.action == crate::compat::rmcp::ElicitationAction::Accept);

    // Browser runtime currently lacks a post-install refresh source equivalent
    // to core's native refresh path, so completion is keyed to explicit user
    // confirmation until app-list host plumbing is added.
    let completed = user_confirmed;
    if completed {
        session
            .merge_connector_selection(HashSet::from([connector.id.clone()]))
            .await;
    }

    let content = serde_json::to_string(&ToolSuggestResult {
        completed,
        user_confirmed,
        tool_type: args.tool_type,
        action_type: args.action_type,
        tool_id: connector.id,
        tool_name: connector.name,
        suggest_reason: suggest_reason.to_string(),
    })
    .map_err(|err| {
        FunctionCallError::Fatal(format!(
            "failed to serialize {TOOL_SUGGEST_TOOL_NAME} response: {err}"
        ))
    })?;

    Ok(FunctionToolOutput {
        body: vec![FunctionCallOutputContentItem::InputText { text: content }],
        success: Some(true),
    })
}

fn format_discoverable_tools(discoverable_tools: &[DiscoverableTool]) -> String {
    let mut discoverable_tools = discoverable_tools.to_vec();
    discoverable_tools.sort_by(|left, right| {
        left.name()
            .cmp(right.name())
            .then_with(|| left.id().cmp(right.id()))
    });

    discoverable_tools
        .into_iter()
        .map(|tool| {
            let description = tool
                .description()
                .filter(|description| !description.trim().is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| match &tool {
                    DiscoverableTool::Connector(_) => "No description provided.".to_string(),
                    DiscoverableTool::Plugin(plugin) => format_plugin_summary(plugin),
                });
            let default_action = match tool.tool_type() {
                DiscoverableToolType::Connector => DiscoverableToolAction::Install,
                DiscoverableToolType::Plugin => DiscoverableToolAction::Enable,
            };
            format!(
                "- {} (id: `{}`, type: {}, action: {}): {}",
                tool.name(),
                tool.id(),
                tool.tool_type().as_str(),
                default_action.as_str(),
                description
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_plugin_summary(plugin: &crate::tools::discoverable::DiscoverablePluginInfo) -> String {
    let mut details = Vec::new();
    if plugin.has_skills {
        details.push("skills".to_string());
    }
    if !plugin.mcp_server_names.is_empty() {
        details.push(format!(
            "MCP servers: {}",
            plugin.mcp_server_names.join(", ")
        ));
    }
    if !plugin.app_connector_ids.is_empty() {
        details.push(format!(
            "app connectors: {}",
            plugin.app_connector_ids.join(", ")
        ));
    }
    if details.is_empty() {
        "No description provided.".to_string()
    } else {
        details.join("; ")
    }
}

fn build_tool_suggestion_elicitation_request(
    thread_id: String,
    turn_id: String,
    args: &ToolSuggestArgs,
    suggest_reason: &str,
    connector: &AppInfo,
) -> McpServerElicitationRequestParams {
    let tool_name = connector.name.clone();
    let install_url = connector
        .install_url
        .clone()
        .unwrap_or_else(|| connectors::connector_install_url(&tool_name, &connector.id));
    let message = format!(
        "{tool_name} could help with this request.\n\n{suggest_reason}\n\nOpen ChatGPT to {} it, then confirm here if you finish.",
        args.action_type.as_str()
    );

    McpServerElicitationRequestParams {
        thread_id,
        turn_id: Some(turn_id),
        server_name: crate::mcp::CODEX_APPS_MCP_SERVER_NAME.to_string(),
        request: McpServerElicitationRequest::Form {
            meta: Some(json!(build_tool_suggestion_meta(
                args.tool_type,
                args.action_type,
                suggest_reason,
                connector.id.as_str(),
                tool_name.as_str(),
                install_url.as_str(),
            ))),
            message,
            requested_schema: McpElicitationSchema {
                schema_uri: None,
                type_: McpElicitationObjectType::Object,
                properties: BTreeMap::new(),
                required: None,
            },
        },
    }
}

fn build_tool_suggestion_meta<'a>(
    tool_type: DiscoverableToolType,
    action_type: DiscoverableToolAction,
    suggest_reason: &'a str,
    tool_id: &'a str,
    tool_name: &'a str,
    install_url: &'a str,
) -> ToolSuggestMeta<'a> {
    ToolSuggestMeta {
        codex_approval_kind: TOOL_SUGGEST_APPROVAL_KIND_VALUE,
        tool_type,
        suggest_type: action_type,
        suggest_reason,
        tool_id,
        tool_name,
        install_url,
    }
}

#[cfg(test)]
pub(crate) fn verified_connector_suggestion_completed(
    action_type: DiscoverableToolAction,
    tool_id: &str,
    accessible_connectors: &[AppInfo],
) -> bool {
    accessible_connectors
        .iter()
        .find(|connector| connector.id == tool_id)
        .is_some_and(|connector| match action_type {
            DiscoverableToolAction::Install => connector.is_accessible,
            DiscoverableToolAction::Enable => connector.is_accessible && connector.is_enabled,
        })
}

#[cfg(test)]
#[path = "tool_suggest_handler_tests.rs"]
mod tests;
