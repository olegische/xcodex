#[cfg(test)]
use codex_app_server_protocol::DynamicToolCallOutputContentItem;
#[cfg(test)]
use codex_app_server_protocol::DynamicToolCallStatus;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::Thread;
use codex_app_server_protocol::ThreadStatus;
#[cfg(test)]
use codex_app_server_protocol::ToolRequestUserInputResponse;
use codex_app_server_protocol::Turn;
#[cfg(test)]
use codex_protocol::models::FunctionCallOutputBody;
#[cfg(test)]
use codex_protocol::models::FunctionCallOutputPayload;
#[cfg(test)]
use codex_protocol::models::ResponseItem;
#[cfg(test)]
use codex_protocol::request_user_input::RequestUserInputAnswer;
#[cfg(test)]
use codex_protocol::request_user_input::RequestUserInputResponse;

use crate::state::ThreadRecord;
use crate::state::TurnRecord;

pub fn initialize_user_agent() -> String {
    format!("codex-wasm-v2-browser/{}", env!("CARGO_PKG_VERSION"))
}

pub fn build_thread(record: &ThreadRecord, include_turns: bool, status: ThreadStatus) -> Thread {
    Thread {
        id: record.id.clone(),
        preview: record.preview.clone(),
        ephemeral: record.ephemeral,
        model_provider: record.model_provider.clone(),
        created_at: record.created_at,
        updated_at: record.updated_at,
        status,
        path: None,
        cwd: record.cwd.clone(),
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        source: record.source.clone().into(),
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: record.name.clone(),
        turns: if include_turns {
            record
                .turns
                .values()
                .cloned()
                .map(turn_to_protocol)
                .collect()
        } else {
            Vec::new()
        },
    }
}

pub fn request_resolved_notification(
    thread_id: String,
    request_id: codex_app_server_protocol::RequestId,
) -> ServerNotification {
    ServerNotification::ServerRequestResolved(
        codex_app_server_protocol::ServerRequestResolvedNotification {
            thread_id,
            request_id,
        },
    )
}

pub fn turn_to_protocol(turn: TurnRecord) -> Turn {
    Turn {
        id: turn.id,
        items: turn.items,
        status: turn.status,
        error: turn.error,
    }
}

#[cfg(test)]
pub fn dynamic_tool_call_started_item(
    event: &codex_protocol::dynamic_tools::DynamicToolCallRequest,
) -> codex_app_server_protocol::ThreadItem {
    codex_app_server_protocol::ThreadItem::DynamicToolCall {
        id: event.call_id.clone(),
        tool: event.tool.clone(),
        arguments: event.arguments.clone(),
        status: DynamicToolCallStatus::InProgress,
        content_items: None,
        success: None,
        duration_ms: None,
    }
}

#[cfg(test)]
pub fn raw_response_item_started_tool_item(
    item: &ResponseItem,
) -> Option<codex_app_server_protocol::ThreadItem> {
    match item {
        ResponseItem::FunctionCall {
            name,
            namespace,
            arguments,
            call_id,
            ..
        } if is_browser_builtin_tool(name, namespace.as_deref()) => {
            Some(codex_app_server_protocol::ThreadItem::DynamicToolCall {
                id: call_id.clone(),
                tool: name.clone(),
                arguments: parse_tool_arguments(arguments),
                status: DynamicToolCallStatus::InProgress,
                content_items: None,
                success: None,
                duration_ms: None,
            })
        }
        ResponseItem::CustomToolCall {
            call_id,
            name,
            input,
            ..
        } if is_browser_builtin_tool(name, None) => {
            Some(codex_app_server_protocol::ThreadItem::DynamicToolCall {
                id: call_id.clone(),
                tool: name.clone(),
                arguments: parse_tool_arguments(input),
                status: DynamicToolCallStatus::InProgress,
                content_items: None,
                success: None,
                duration_ms: None,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
pub fn raw_response_item_completed_tool_item(
    item: &ResponseItem,
    existing: &codex_app_server_protocol::ThreadItem,
) -> Option<codex_app_server_protocol::ThreadItem> {
    match (item, existing) {
        (
            ResponseItem::FunctionCallOutput { call_id, output }
            | ResponseItem::CustomToolCallOutput { call_id, output },
            codex_app_server_protocol::ThreadItem::DynamicToolCall {
                id,
                tool,
                arguments,
                ..
            },
        ) if id == call_id && is_browser_builtin_tool(tool.as_str(), None) => {
            Some(codex_app_server_protocol::ThreadItem::DynamicToolCall {
                id: id.clone(),
                tool: tool.clone(),
                arguments: arguments.clone(),
                status: dynamic_tool_call_status_from_output(output),
                content_items: dynamic_tool_output_content_items(output),
                success: output.success,
                duration_ms: None,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
pub fn dynamic_tool_call_completed_item(
    event: &codex_protocol::protocol::DynamicToolCallResponseEvent,
) -> codex_app_server_protocol::ThreadItem {
    codex_app_server_protocol::ThreadItem::DynamicToolCall {
        id: event.call_id.clone(),
        tool: event.tool.clone(),
        arguments: event.arguments.clone(),
        status: if event.success {
            DynamicToolCallStatus::Completed
        } else {
            DynamicToolCallStatus::Failed
        },
        content_items: Some(
            event
                .content_items
                .iter()
                .cloned()
                .map(|item| {
                    match item {
                    codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputText {
                        text,
                    } => DynamicToolCallOutputContentItem::InputText { text },
                    codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputImage {
                        image_url,
                    } => DynamicToolCallOutputContentItem::InputImage { image_url },
                }
                })
                .collect(),
        ),
        success: Some(event.success),
        duration_ms: i64::try_from(event.duration.as_millis()).ok(),
    }
}

#[cfg(test)]
fn dynamic_tool_call_status_from_output(
    output: &FunctionCallOutputPayload,
) -> DynamicToolCallStatus {
    match output.success {
        Some(false) => DynamicToolCallStatus::Failed,
        Some(true) | None => DynamicToolCallStatus::Completed,
    }
}

#[cfg(test)]
fn dynamic_tool_output_content_items(
    output: &FunctionCallOutputPayload,
) -> Option<Vec<DynamicToolCallOutputContentItem>> {
    match &output.body {
        FunctionCallOutputBody::Text(text) => {
            Some(vec![DynamicToolCallOutputContentItem::InputText {
                text: text.clone(),
            }])
        }
        FunctionCallOutputBody::ContentItems(items) => Some(
            items
                .iter()
                .map(|item| match item {
                    codex_protocol::models::FunctionCallOutputContentItem::InputText { text } => {
                        DynamicToolCallOutputContentItem::InputText { text: text.clone() }
                    }
                    codex_protocol::models::FunctionCallOutputContentItem::InputImage {
                        image_url,
                        ..
                    } => DynamicToolCallOutputContentItem::InputImage {
                        image_url: image_url.clone(),
                    },
                })
                .collect(),
        ),
    }
}

#[cfg(test)]
fn parse_tool_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments)
        .unwrap_or_else(|_| serde_json::Value::String(arguments.to_string()))
}

#[cfg(test)]
fn is_browser_builtin_tool(name: &str, namespace: Option<&str>) -> bool {
    matches!(namespace, None | Some("browser"))
        && matches!(
            name,
            "read_file"
                | "list_dir"
                | "grep_files"
                | "apply_patch"
                | "update_plan"
                | "request_user_input"
        )
}

#[cfg(test)]
pub fn tool_request_user_input_response_to_core(
    response: ToolRequestUserInputResponse,
) -> RequestUserInputResponse {
    RequestUserInputResponse {
        answers: response
            .answers
            .into_iter()
            .map(|(id, answer)| {
                (
                    id,
                    RequestUserInputAnswer {
                        answers: answer.answers,
                    },
                )
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::Duration;

    use codex_app_server_protocol::DynamicToolCallOutputContentItem;
    use codex_app_server_protocol::DynamicToolCallStatus;
    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::ThreadItem;
    use codex_app_server_protocol::ThreadStatus;
    use codex_protocol::dynamic_tools::DynamicToolCallRequest;
    use codex_protocol::models::FunctionCallOutputPayload;
    use codex_protocol::models::ResponseItem;
    use codex_protocol::protocol::DynamicToolCallResponseEvent;
    use codex_protocol::protocol::SessionSource;
    use pretty_assertions::assert_eq;

    use super::build_thread;
    use super::dynamic_tool_call_completed_item;
    use super::dynamic_tool_call_started_item;
    use super::raw_response_item_completed_tool_item;
    use super::raw_response_item_started_tool_item;
    use super::request_resolved_notification;
    use super::tool_request_user_input_response_to_core;
    use crate::state::ThreadRecord;

    #[test]
    fn tool_request_user_input_response_maps_to_core_shape() {
        let response = codex_app_server_protocol::ToolRequestUserInputResponse {
            answers: HashMap::from([(
                "api_key".to_string(),
                codex_app_server_protocol::ToolRequestUserInputAnswer {
                    answers: vec!["secret".to_string()],
                },
            )]),
        };

        let actual = tool_request_user_input_response_to_core(response);
        let expected = codex_protocol::request_user_input::RequestUserInputResponse {
            answers: HashMap::from([(
                "api_key".to_string(),
                codex_protocol::request_user_input::RequestUserInputAnswer {
                    answers: vec!["secret".to_string()],
                },
            )]),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn build_thread_converts_core_session_source() {
        let thread = build_thread(
            &ThreadRecord {
                id: "thread-1".to_string(),
                preview: "hello".to_string(),
                ephemeral: false,
                model_provider: "openai".to_string(),
                cwd: PathBuf::from("/workspace"),
                source: SessionSource::Unknown,
                name: None,
                created_at: 10,
                updated_at: 11,
                archived: false,
                turns: BTreeMap::new(),
                active_turn_id: None,
                waiting_on_approval: false,
                waiting_on_user_input: false,
            },
            false,
            ThreadStatus::Idle,
        );

        assert_eq!(
            thread.source,
            codex_app_server_protocol::SessionSource::Unknown
        );
    }

    #[test]
    fn request_resolved_notification_preserves_request_id() {
        let notification =
            request_resolved_notification("thread-1".to_string(), RequestId::Integer(7));

        match notification {
            codex_app_server_protocol::ServerNotification::ServerRequestResolved(payload) => {
                assert_eq!(
                    payload,
                    codex_app_server_protocol::ServerRequestResolvedNotification {
                        thread_id: "thread-1".to_string(),
                        request_id: RequestId::Integer(7),
                    }
                );
            }
            other => panic!("unexpected notification: {other:?}"),
        }
    }

    #[test]
    fn dynamic_tool_call_request_maps_to_protocol_thread_item() {
        let actual = dynamic_tool_call_started_item(&DynamicToolCallRequest {
            call_id: "call-1".to_string(),
            turn_id: "turn-1".to_string(),
            tool: "list_dir".to_string(),
            arguments: serde_json::json!({ "dir_path": "/workspace" }),
        });

        assert_eq!(
            actual,
            ThreadItem::DynamicToolCall {
                id: "call-1".to_string(),
                tool: "list_dir".to_string(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::InProgress,
                content_items: None,
                success: None,
                duration_ms: None,
            }
        );
    }

    #[test]
    fn dynamic_tool_call_response_maps_to_protocol_thread_item() {
        let actual = dynamic_tool_call_completed_item(&DynamicToolCallResponseEvent {
            call_id: "call-1".to_string(),
            turn_id: "turn-1".to_string(),
            tool: "list_dir".to_string(),
            arguments: serde_json::json!({ "dir_path": "/workspace" }),
            content_items: vec![
                codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputText {
                    text: "Absolute path: /workspace".to_string(),
                },
            ],
            success: true,
            error: None,
            duration: Duration::from_millis(42),
        });

        assert_eq!(
            actual,
            ThreadItem::DynamicToolCall {
                id: "call-1".to_string(),
                tool: "list_dir".to_string(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                    text: "Absolute path: /workspace".to_string(),
                }]),
                success: Some(true),
                duration_ms: Some(42),
            }
        );
    }

    #[test]
    fn raw_response_item_function_call_maps_browser_builtin_to_started_tool_item() {
        let actual = raw_response_item_started_tool_item(&ResponseItem::FunctionCall {
            id: None,
            name: "list_dir".to_string(),
            namespace: None,
            arguments: r#"{ "dir_path": "/workspace" }"#.to_string(),
            call_id: "call-1".to_string(),
        });

        assert_eq!(
            actual,
            Some(ThreadItem::DynamicToolCall {
                id: "call-1".to_string(),
                tool: "list_dir".to_string(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::InProgress,
                content_items: None,
                success: None,
                duration_ms: None,
            })
        );
    }

    #[test]
    fn raw_response_item_function_call_output_completes_browser_builtin_tool_item() {
        let started = ThreadItem::DynamicToolCall {
            id: "call-1".to_string(),
            tool: "list_dir".to_string(),
            arguments: serde_json::json!({ "dir_path": "/workspace" }),
            status: DynamicToolCallStatus::InProgress,
            content_items: None,
            success: None,
            duration_ms: None,
        };

        let actual = raw_response_item_completed_tool_item(
            &ResponseItem::FunctionCallOutput {
                call_id: "call-1".to_string(),
                output: FunctionCallOutputPayload::from_text("Absolute path: /workspace".into()),
            },
            &started,
        );

        assert_eq!(
            actual,
            Some(ThreadItem::DynamicToolCall {
                id: "call-1".to_string(),
                tool: "list_dir".to_string(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                    text: "Absolute path: /workspace".to_string(),
                }]),
                success: None,
                duration_ms: None,
            })
        );
    }
}
