use crate::tools::context::ToolCall;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::models::SearchToolCallParams;
use codex_protocol::models::ShellToolCallParams;
use serde_json::Value;

pub const TOOL_SEARCH_TOOL_NAME: &str = "tool_search";

#[derive(Clone, Debug, Default)]
pub struct ToolRouter;

impl ToolRouter {
    pub fn build_tool_call(&self, item: ResponseItem) -> Result<Option<ToolCall>, String> {
        match item {
            ResponseItem::FunctionCall {
                name,
                namespace,
                arguments,
                call_id,
                ..
            } => Ok(Some(ToolCall {
                tool_name: name,
                tool_namespace: namespace,
                call_id,
                payload: ToolPayload::Function { arguments },
            })),
            ResponseItem::ToolSearchCall {
                call_id, arguments, ..
            } => {
                let arguments = serde_json::from_value::<SearchToolCallParams>(arguments)
                    .map_err(|error| format!("invalid tool_search arguments: {error}"))?;
                Ok(call_id.map(|call_id| ToolCall {
                    tool_name: TOOL_SEARCH_TOOL_NAME.to_string(),
                    tool_namespace: None,
                    call_id,
                    payload: ToolPayload::ToolSearch { arguments },
                }))
            }
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
                    .ok_or_else(|| "LocalShellCall without call_id or id".to_string())?;

                match action {
                    codex_protocol::models::LocalShellAction::Exec(exec) => {
                        let params = ShellToolCallParams {
                            command: exec.command,
                            workdir: exec.working_directory,
                            timeout_ms: exec.timeout_ms,
                            sandbox_permissions: None,
                            additional_permissions: None,
                            prefix_rule: None,
                            justification: None,
                        };
                        Ok(Some(ToolCall {
                            tool_name: "local_shell".to_string(),
                            tool_namespace: None,
                            call_id,
                            payload: ToolPayload::LocalShell { params },
                        }))
                    }
                }
            }
            _ => Ok(None),
        }
    }
}

pub fn tool_output_to_response_input(
    call_id: &str,
    payload: &ToolPayload,
    output: &dyn ToolOutput,
) -> ResponseInputItem {
    output.to_response_item(call_id, payload)
}

pub fn response_input_to_response_item(input: &ResponseInputItem) -> Option<ResponseItem> {
    match input {
        ResponseInputItem::FunctionCallOutput { call_id, output } => {
            Some(ResponseItem::FunctionCallOutput {
                call_id: call_id.clone(),
                output: output.clone(),
            })
        }
        ResponseInputItem::CustomToolCallOutput { call_id, output } => {
            Some(ResponseItem::CustomToolCallOutput {
                call_id: call_id.clone(),
                output: output.clone(),
            })
        }
        ResponseInputItem::ToolSearchOutput {
            call_id,
            status,
            execution,
            tools,
        } => Some(ResponseItem::ToolSearchOutput {
            call_id: Some(call_id.clone()),
            status: status.clone(),
            execution: execution.clone(),
            tools: tools.clone(),
        }),
        _ => None,
    }
}

pub fn raw_assistant_output_text_from_item(item: &ResponseItem) -> Option<String> {
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
        return Some(combined);
    }
    None
}

pub fn last_assistant_message_from_item(item: &ResponseItem) -> Option<String> {
    let combined = raw_assistant_output_text_from_item(item)?;
    if combined.trim().is_empty() {
        return None;
    }
    Some(combined)
}

pub fn parse_tool_arguments_json(call: &ToolCall) -> Result<Value, serde_json::Error> {
    match &call.payload {
        ToolPayload::Function { arguments } => serde_json::from_str(arguments),
        ToolPayload::ToolSearch { arguments } => serde_json::to_value(arguments),
        ToolPayload::Custom { .. } | ToolPayload::LocalShell { .. } | ToolPayload::Mcp { .. } => {
            serde_json::from_str("{}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_protocol::models::LocalShellAction;
    use codex_protocol::models::LocalShellStatus;
    use pretty_assertions::assert_eq;

    #[test]
    fn builds_function_tool_call_from_response_item() {
        let router = ToolRouter;
        let item = ResponseItem::FunctionCall {
            id: Some("fc-1".to_string()),
            name: "read_file".to_string(),
            namespace: None,
            arguments: "{\"path\":\"/workspace/src/lib.rs\"}".to_string(),
            call_id: "call-1".to_string(),
        };

        assert_eq!(
            router.build_tool_call(item).expect("build should succeed"),
            Some(ToolCall {
                tool_name: "read_file".to_string(),
                tool_namespace: None,
                call_id: "call-1".to_string(),
                payload: ToolPayload::Function {
                    arguments: "{\"path\":\"/workspace/src/lib.rs\"}".to_string(),
                },
            })
        );
    }

    #[test]
    fn custom_tool_outputs_roundtrip_to_response_items() {
        let response = ResponseInputItem::CustomToolCallOutput {
            call_id: "call-42".to_string(),
            output: FunctionCallOutputPayload {
                body: FunctionCallOutputBody::Text("patched".to_string()),
                success: Some(true),
            },
        };

        assert_eq!(
            response_input_to_response_item(&response),
            Some(ResponseItem::CustomToolCallOutput {
                call_id: "call-42".to_string(),
                output: FunctionCallOutputPayload {
                    body: FunctionCallOutputBody::Text("patched".to_string()),
                    success: Some(true),
                },
            })
        );
    }

    #[test]
    fn extracts_last_assistant_message_from_response_item() {
        let item = ResponseItem::Message {
            id: Some("msg-1".to_string()),
            role: "assistant".to_string(),
            content: vec![codex_protocol::models::ContentItem::OutputText {
                text: "hello from assistant".to_string(),
            }],
            end_turn: Some(true),
            phase: None,
        };

        assert_eq!(
            last_assistant_message_from_item(&item),
            Some("hello from assistant".to_string())
        );
    }

    #[test]
    fn builds_local_shell_tool_call_from_response_item() {
        let router = ToolRouter;
        let item = ResponseItem::LocalShellCall {
            id: Some("legacy-1".to_string()),
            call_id: None,
            status: LocalShellStatus::Completed,
            action: LocalShellAction::Exec(codex_protocol::models::LocalShellExecAction {
                command: vec!["pwd".to_string()],
                working_directory: Some("/workspace".to_string()),
                timeout_ms: Some(1000),
                env: None,
                user: None,
            }),
        };

        assert_eq!(
            router.build_tool_call(item).expect("build should succeed"),
            Some(ToolCall {
                tool_name: "local_shell".to_string(),
                tool_namespace: None,
                call_id: "legacy-1".to_string(),
                payload: ToolPayload::LocalShell {
                    params: ShellToolCallParams {
                        command: vec!["pwd".to_string()],
                        workdir: Some("/workspace".to_string()),
                        timeout_ms: Some(1000),
                        sandbox_permissions: None,
                        additional_permissions: None,
                        prefix_rule: None,
                        justification: None,
                    },
                },
            })
        );
    }

    #[test]
    fn builds_tool_search_call_from_response_item() {
        let router = ToolRouter;
        let item = ResponseItem::ToolSearchCall {
            id: Some("ts-1".to_string()),
            call_id: Some("search-1".to_string()),
            status: None,
            execution: "client".to_string(),
            arguments: serde_json::json!({
                "query": "notion search",
                "limit": 1,
            }),
        };

        assert_eq!(
            router.build_tool_call(item).expect("build should succeed"),
            Some(ToolCall {
                tool_name: "tool_search".to_string(),
                tool_namespace: None,
                call_id: "search-1".to_string(),
                payload: ToolPayload::ToolSearch {
                    arguments: SearchToolCallParams {
                        query: "notion search".to_string(),
                        limit: Some(1),
                    },
                },
            })
        );
    }
}
