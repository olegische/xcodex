use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::mcp_connection_manager::ToolInfo;
use crate::sandboxing::SandboxPermissions;
use crate::tools::browser_builtin;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::SharedTurnDiffTracker;
use crate::tools::context::ToolCall;
use crate::tools::context::ToolPayload;
use crate::tools::dynamic_handler;
use crate::tools::mcp_handler;
use crate::tools::tool_search_handler;
use crate::tools::tool_suggest_handler;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use codex_protocol::models::LocalShellAction;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::models::SearchToolCallParams;
use codex_protocol::models::ShellToolCallParams;
use codex_utils_stream_parser::strip_citations;
use codex_utils_stream_parser::strip_proposed_plan_blocks;
use rmcp::model::Tool;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct ToolRouter {
    specs: Vec<crate::client_common::tools::ToolSpec>,
    dynamic_tool_names: Vec<String>,
    mcp_tool_names: Vec<String>,
    app_tools: Option<HashMap<String, ToolInfo>>,
    discoverable_tools: Option<Vec<crate::tools::discoverable::DiscoverableTool>>,
}
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
        config: &crate::tools::spec::ToolsConfig,
        params: ToolRouterParams<'_>,
    ) -> Self {
        let ToolRouterParams {
            mcp_tools,
            app_tools,
            discoverable_tools,
            dynamic_tools,
        } = params;
        let mut specs = browser_builtin::builtin_tool_specs(config);
        if config.search_tool
            && let Some(app_tools) = app_tools.as_ref()
        {
            specs.push(tool_search_handler::tool_search_spec(app_tools));
        }
        if config.tool_suggest
            && let Some(discoverable_tools) = discoverable_tools.as_ref()
            && !discoverable_tools.is_empty()
        {
            specs.push(tool_suggest_handler::tool_suggest_spec(discoverable_tools));
        }
        if let Some(mcp_tools) = mcp_tools.as_ref() {
            specs.extend(mcp_handler::mcp_tool_specs(mcp_tools));
        }
        specs.extend(dynamic_handler::dynamic_tool_specs(dynamic_tools));
        Self {
            specs,
            dynamic_tool_names: dynamic_tools.iter().map(|tool| tool.name.clone()).collect(),
            mcp_tool_names: mcp_tools
                .as_ref()
                .map(|tools| tools.keys().cloned().collect())
                .unwrap_or_default(),
            app_tools: if config.search_tool { app_tools } else { None },
            discoverable_tools: if config.tool_suggest {
                discoverable_tools
            } else {
                None
            },
        }
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
        session: Arc<Session>,
        turn: Arc<TurnContext>,
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
        let output: Box<dyn crate::tools::context::ToolOutput> = if let Some(output) =
            browser_builtin::dispatch_builtin_tool_call(
                Arc::clone(&session),
                Arc::clone(&turn),
                call.clone(),
            )
            .await?
        {
            Box::new(output)
        } else if matches!(payload, ToolPayload::Function { .. })
            && self
                .dynamic_tool_names
                .iter()
                .any(|name| name == &call.tool_name)
        {
            Box::new(
                dynamic_handler::handle_dynamic_tool_call(
                    session.as_ref(),
                    turn.as_ref(),
                    call.call_id.clone(),
                    call.tool_name.clone(),
                    payload.clone(),
                )
                .await?,
            )
        } else if matches!(payload, ToolPayload::Mcp { .. })
            && self
                .mcp_tool_names
                .iter()
                .any(|name| name == &call.tool_name)
        {
            Box::new(mcp_handler::handle_mcp_tool_call(session.as_ref(), payload.clone()).await?)
        } else if matches!(payload, ToolPayload::Function { .. })
            && call.tool_name == tool_suggest_handler::TOOL_SUGGEST_TOOL_NAME
        {
            Box::new(
                tool_suggest_handler::handle_tool_suggest(
                    session.as_ref(),
                    turn.as_ref(),
                    call.call_id.clone(),
                    payload.clone(),
                    self.discoverable_tools.as_deref().unwrap_or(&[]),
                )
                .await?,
            )
        } else if matches!(payload, ToolPayload::ToolSearch { .. }) {
            Box::new(tool_search_handler::handle_tool_search(
                self.app_tools.as_ref().unwrap_or(&HashMap::new()),
                payload.clone(),
            )?)
        } else {
            Box::new(FunctionToolOutput::from_text(
                format!("tool {} is not implemented in wasm_v2 yet", call.tool_name),
                Some(false),
            ))
        };
        Ok(output.to_response_item(&call_id, &payload))
    }
}

pub fn last_assistant_message_from_item(item: &ResponseItem, _plan_mode: bool) -> Option<String> {
    let plan_mode = _plan_mode;
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
        if combined.is_empty() {
            return None;
        }
        let (without_citations, _) = strip_citations(&combined);
        let stripped = if plan_mode {
            strip_proposed_plan_blocks(&without_citations)
        } else {
            without_citations
        };
        if stripped.trim().is_empty() {
            None
        } else {
            Some(stripped)
        }
    } else {
        None
    }
}

impl ToolRouter {
    pub fn specs(&self) -> Vec<crate::client_common::tools::ToolSpec> {
        self.specs.clone()
    }

    pub fn tool_supports_parallel(&self, tool_name: &str) -> bool {
        matches!(
            tool_name,
            "read_file" | "list_dir" | "grep_files" | "tool_search" | "tool_suggest"
        ) || self.mcp_tool_names.iter().any(|name| name == tool_name)
    }
}

#[cfg(test)]
#[path = "router_tests.rs"]
mod tests;
