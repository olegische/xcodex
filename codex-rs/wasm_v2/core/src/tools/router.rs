use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::mcp_connection_manager::ToolInfo;
use crate::sandboxing::SandboxPermissions;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::SharedTurnDiffTracker;
use crate::tools::context::ToolCall;
use crate::tools::context::ToolPayload;
use crate::tools::context::ToolSearchOutput;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use codex_protocol::models::LocalShellAction;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::models::SearchToolCallParams;
use codex_protocol::models::ShellToolCallParams;
use rmcp::model::Tool;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct ToolRouter;
pub use crate::tools::context::ToolCallSource;

#[derive(Clone, Debug)]
pub struct ToolRouterParams<'a> {
    pub mcp_tools: Option<HashMap<String, Tool>>,
    pub app_tools: Option<HashMap<String, ToolInfo>>,
    pub discoverable_tools: Option<Vec<crate::tools::discoverable::DiscoverableTool>>,
    pub dynamic_tools: &'a [DynamicToolSpec],
}

impl ToolRouter {
    pub fn from_config(
        _config: &crate::tools::spec::ToolsConfig,
        _params: ToolRouterParams<'_>,
    ) -> Self {
        Self
    }

    pub async fn build_tool_call(
        session: &Session,
        item: ResponseItem,
    ) -> Result<Option<ToolCall>, FunctionCallError> {
        match item {
            ResponseItem::FunctionCall {
                name,
                namespace,
                arguments,
                call_id,
                ..
            } => {
                if let Some((server, tool)) = session.parse_mcp_tool_name(&name, &namespace).await {
                    Ok(Some(ToolCall {
                        tool_name: name,
                        tool_namespace: namespace,
                        call_id,
                        payload: ToolPayload::Mcp {
                            server,
                            tool,
                            raw_arguments: arguments,
                        },
                    }))
                } else {
                    Ok(Some(ToolCall {
                        tool_name: name,
                        tool_namespace: namespace,
                        call_id,
                        payload: ToolPayload::Function { arguments },
                    }))
                }
            }
            ResponseItem::ToolSearchCall {
                call_id: Some(call_id),
                execution,
                arguments,
                ..
            } if execution == "client" => {
                let arguments =
                    serde_json::from_value::<SearchToolCallParams>(arguments).map_err(|err| {
                        FunctionCallError::RespondToModel(format!(
                            "failed to parse tool_search arguments: {err}"
                        ))
                    })?;
                Ok(Some(ToolCall {
                    tool_name: "tool_search".to_string(),
                    tool_namespace: None,
                    call_id,
                    payload: ToolPayload::ToolSearch { arguments },
                }))
            }
            ResponseItem::ToolSearchCall { .. } => Ok(None),
            ResponseItem::CustomToolCall {
                name,
                input,
                call_id,
                ..
            } => Ok(Some(ToolCall {
                tool_name: name,
                tool_namespace: None,
                call_id,
                payload: ToolPayload::Custom { input },
            })),
            ResponseItem::LocalShellCall {
                id,
                call_id,
                action,
                ..
            } => {
                let call_id = call_id
                    .or(id)
                    .ok_or(FunctionCallError::MissingLocalShellCallId)?;
                let LocalShellAction::Exec(exec) = action;
                Ok(Some(ToolCall {
                    tool_name: "local_shell".to_string(),
                    tool_namespace: None,
                    call_id,
                    payload: ToolPayload::LocalShell {
                        params: ShellToolCallParams {
                            command: exec.command,
                            workdir: exec.working_directory,
                            timeout_ms: exec.timeout_ms,
                            sandbox_permissions: Some(SandboxPermissions::UseDefault),
                            additional_permissions: None,
                            prefix_rule: None,
                            justification: None,
                        },
                    },
                }))
            }
            _ => Ok(None),
        }
    }

    pub async fn dispatch_tool_call(
        &self,
        _session: Arc<Session>,
        _turn: Arc<TurnContext>,
        _tracker: SharedTurnDiffTracker,
        call: ToolCall,
        _source: ToolCallSource,
    ) -> Result<ResponseInputItem, FunctionCallError> {
        let payload = call.payload.clone();
        let call_id = call.call_id.clone();
        if matches!(payload, ToolPayload::Custom { .. }) && call.tool_name == "shell" {
            return Err(FunctionCallError::Fatal(
                "tool shell invoked with incompatible payload".to_string(),
            ));
        }
        let output: Box<dyn crate::tools::context::ToolOutput> = match payload {
            ToolPayload::ToolSearch { .. } => Box::new(ToolSearchOutput { tools: Vec::new() }),
            _ => Box::new(FunctionToolOutput::from_text(
                format!("tool {} is not implemented in wasm_v2 yet", call.tool_name),
                Some(false),
            )),
        };
        Ok(output.to_response_item(&call_id, &payload))
    }
}

pub fn last_assistant_message_from_item(item: &ResponseItem, _plan_mode: bool) -> Option<String> {
    if let ResponseItem::Message { role, content, .. } = item
        && role == "assistant"
    {
        let combined = content
            .iter()
            .filter_map(|content| match content {
                codex_protocol::models::ContentItem::OutputText { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<String>();
        if combined.trim().is_empty() {
            None
        } else {
            Some(combined)
        }
    } else {
        None
    }
}

impl ToolRouter {
    pub fn specs(&self) -> Vec<crate::client_common::tools::ToolSpec> {
        Vec::new()
    }
}
