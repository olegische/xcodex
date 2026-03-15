#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use std::collections::HashMap;

use codex_app_server_protocol::AgentMessageDeltaNotification;
use codex_app_server_protocol::CodexErrorInfo;
use codex_app_server_protocol::DynamicToolCallOutputContentItem;
use codex_app_server_protocol::DynamicToolCallStatus;
use codex_app_server_protocol::ErrorNotification;
use codex_app_server_protocol::ItemCompletedNotification;
use codex_app_server_protocol::ItemStartedNotification;
use codex_app_server_protocol::McpToolCallResult;
use codex_app_server_protocol::McpToolCallStatus;
use codex_app_server_protocol::RawResponseItemCompletedNotification;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::Turn;
use codex_app_server_protocol::TurnCompletedNotification;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStartedNotification;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::models::ContentItem;
use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ReasoningItemContent;
use codex_protocol::models::ReasoningItemReasoningSummary;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use serde::Serialize;
use serde_json::Value;

use crate::codex::RuntimeDispatch;
use crate::codex::UiEvent;
use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::SessionSnapshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserRuntimeDispatch<T> {
    value: T,
    events: Vec<ServerNotification>,
}

impl<T> BrowserRuntimeDispatch<T> {
    pub(crate) fn new(value: T, events: Vec<ServerNotification>) -> Self {
        Self { value, events }
    }
}

#[derive(Debug)]
pub(crate) struct TurnNotificationEmitter {
    thread_id: String,
    turn_id: String,
    assistant_item_started: bool,
    pending_tool_calls: HashMap<String, PendingToolCall>,
    turn_error: Option<TurnError>,
}

impl TurnNotificationEmitter {
    pub(crate) fn new(thread_id: String, turn_id: String) -> Self {
        Self {
            thread_id,
            turn_id,
            assistant_item_started: false,
            pending_tool_calls: HashMap::new(),
            turn_error: None,
        }
    }

    pub(crate) fn push_ui_event(&mut self, event: &UiEvent) -> Vec<ServerNotification> {
        match event {
            UiEvent::TurnStarted(_) => {
                vec![ServerNotification::TurnStarted(TurnStartedNotification {
                    thread_id: self.thread_id.clone(),
                    turn: Turn {
                        id: self.turn_id.clone(),
                        items: Vec::new(),
                        status: TurnStatus::InProgress,
                        error: None,
                    },
                })]
            }
            UiEvent::ModelDelta(event) => {
                let Some(payload) = event.payload.as_object() else {
                    return Vec::new();
                };
                let Some(delta) = payload.get("outputTextDelta").and_then(Value::as_str) else {
                    return Vec::new();
                };
                let mut notifications = Vec::new();
                if !self.assistant_item_started {
                    notifications.push(ServerNotification::ItemStarted(ItemStartedNotification {
                        thread_id: self.thread_id.clone(),
                        turn_id: self.turn_id.clone(),
                        item: ThreadItem::AgentMessage {
                            id: assistant_item_id(&self.turn_id),
                            text: String::new(),
                            phase: None,
                        },
                    }));
                    self.assistant_item_started = true;
                }
                notifications.push(ServerNotification::AgentMessageDelta(
                    AgentMessageDeltaNotification {
                        thread_id: self.thread_id.clone(),
                        turn_id: self.turn_id.clone(),
                        item_id: assistant_item_id(&self.turn_id),
                        delta: delta.to_string(),
                    },
                ));
                notifications
            }
            UiEvent::ModelOutputItem(event) => {
                let mut notifications = vec![ServerNotification::RawResponseItemCompleted(
                    RawResponseItemCompletedNotification {
                        thread_id: self.thread_id.clone(),
                        turn_id: self.turn_id.clone(),
                        item: event.item.clone(),
                    },
                )];
                match response_item_to_started_thread_item(&self.turn_id, &event.item) {
                    Some((thread_item, Some(pending_tool_call))) => {
                        let item_id = thread_item.id().to_string();
                        notifications.push(ServerNotification::ItemStarted(
                            ItemStartedNotification {
                                thread_id: self.thread_id.clone(),
                                turn_id: self.turn_id.clone(),
                                item: thread_item,
                            },
                        ));
                        self.pending_tool_calls.insert(item_id, pending_tool_call);
                    }
                    Some((thread_item, None)) => {
                        notifications.push(ServerNotification::ItemCompleted(
                            ItemCompletedNotification {
                                thread_id: self.thread_id.clone(),
                                turn_id: self.turn_id.clone(),
                                item: thread_item,
                            },
                        ));
                    }
                    None => {}
                }
                notifications
            }
            UiEvent::TurnFailed(event) => {
                let turn_error = host_error_to_turn_error(event.error.clone());
                self.turn_error = Some(turn_error.clone());
                vec![ServerNotification::Error(ErrorNotification {
                    error: turn_error,
                    will_retry: false,
                    thread_id: self.thread_id.clone(),
                    turn_id: self.turn_id.clone(),
                })]
            }
            UiEvent::TurnCompleted(_) => vec![ServerNotification::TurnCompleted(
                TurnCompletedNotification {
                    thread_id: self.thread_id.clone(),
                    turn: Turn {
                        id: self.turn_id.clone(),
                        items: Vec::new(),
                        status: if self.turn_error.is_some() {
                            TurnStatus::Failed
                        } else {
                            TurnStatus::Completed
                        },
                        error: self.turn_error.clone(),
                    },
                },
            )],
            _ => Vec::new(),
        }
    }

    pub(crate) fn push_tool_output_item(
        &mut self,
        response_item: &ResponseInputItem,
    ) -> Vec<ServerNotification> {
        let mut notifications = Vec::new();
        if let Some(thread_item) =
            tool_output_to_thread_item(response_item, &mut self.pending_tool_calls)
        {
            notifications.push(ServerNotification::ItemCompleted(
                ItemCompletedNotification {
                    thread_id: self.thread_id.clone(),
                    turn_id: self.turn_id.clone(),
                    item: thread_item,
                },
            ));
        }
        notifications
    }
}

#[derive(Debug, Clone)]
enum PendingToolCall {
    Dynamic {
        tool: String,
        arguments: Value,
    },
    Mcp {
        server: String,
        tool: String,
        arguments: Value,
    },
}

pub(crate) fn browser_dispatch_from_turn(
    dispatch: RuntimeDispatch<SessionSnapshot>,
    turn_id: &str,
) -> BrowserRuntimeDispatch<SessionSnapshot> {
    let mut emitter =
        TurnNotificationEmitter::new(dispatch.value.thread_id.clone(), turn_id.to_string());
    let mut notifications = Vec::new();
    for event in &dispatch.events {
        notifications.extend(emitter.push_ui_event(event));
    }
    BrowserRuntimeDispatch::new(dispatch.value, notifications)
}

pub(crate) fn browser_dispatch_without_events(
    dispatch: RuntimeDispatch<SessionSnapshot>,
) -> BrowserRuntimeDispatch<SessionSnapshot> {
    BrowserRuntimeDispatch::new(dispatch.value, Vec::new())
}

fn host_error_to_turn_error(error: HostError) -> TurnError {
    TurnError {
        message: error.message,
        codex_error_info: Some(match error.code {
            HostErrorCode::PermissionDenied => CodexErrorInfo::Unauthorized,
            HostErrorCode::InvalidInput => CodexErrorInfo::BadRequest,
            HostErrorCode::RateLimited => CodexErrorInfo::UsageLimitExceeded,
            HostErrorCode::Timeout | HostErrorCode::Unavailable => {
                CodexErrorInfo::ResponseStreamDisconnected {
                    http_status_code: None,
                }
            }
            HostErrorCode::Internal => CodexErrorInfo::InternalServerError,
            HostErrorCode::NotFound | HostErrorCode::Conflict => CodexErrorInfo::Other,
        }),
        additional_details: error.data.map(|data| data.to_string()),
    }
}

fn response_item_to_started_thread_item(
    turn_id: &str,
    item: &ResponseItem,
) -> Option<(ThreadItem, Option<PendingToolCall>)> {
    match item {
        ResponseItem::Message {
            id,
            role,
            content,
            phase,
            ..
        } if role == "assistant" => Some((
            ThreadItem::AgentMessage {
                id: id.clone().unwrap_or_else(|| assistant_item_id(turn_id)),
                text: assistant_text(content),
                phase: phase.clone(),
            },
            None,
        )),
        ResponseItem::Reasoning {
            id,
            summary,
            content,
            ..
        } => Some((
            ThreadItem::Reasoning {
                id: id.clone(),
                summary: summary.iter().map(reasoning_summary_text).collect(),
                content: content
                    .as_ref()
                    .map(|entries| entries.iter().map(reasoning_content_text).collect())
                    .unwrap_or_default(),
            },
            None,
        )),
        ResponseItem::FunctionCall {
            name,
            namespace,
            arguments,
            call_id,
            ..
        } => {
            let parsed_arguments = parse_arguments(arguments);
            if let Some(server) = namespace
                .as_ref()
                .filter(|server| server.as_str() != "browser")
            {
                Some((
                    ThreadItem::McpToolCall {
                        id: call_id.clone(),
                        server: server.clone(),
                        tool: name.clone(),
                        status: McpToolCallStatus::InProgress,
                        arguments: parsed_arguments.clone(),
                        result: None,
                        error: None,
                        duration_ms: None,
                    },
                    Some(PendingToolCall::Mcp {
                        server: server.clone(),
                        tool: name.clone(),
                        arguments: parsed_arguments,
                    }),
                ))
            } else {
                let tool = qualify_tool_name(name, namespace.as_deref());
                Some((
                    ThreadItem::DynamicToolCall {
                        id: call_id.clone(),
                        tool: tool.clone(),
                        arguments: parsed_arguments.clone(),
                        status: DynamicToolCallStatus::InProgress,
                        content_items: None,
                        success: None,
                        duration_ms: None,
                    },
                    Some(PendingToolCall::Dynamic {
                        tool,
                        arguments: parsed_arguments,
                    }),
                ))
            }
        }
        ResponseItem::CustomToolCall {
            call_id,
            name,
            input,
            ..
        } => {
            let arguments = parse_arguments(input);
            Some((
                ThreadItem::DynamicToolCall {
                    id: call_id.clone(),
                    tool: name.clone(),
                    arguments: arguments.clone(),
                    status: DynamicToolCallStatus::InProgress,
                    content_items: None,
                    success: None,
                    duration_ms: None,
                },
                Some(PendingToolCall::Dynamic {
                    tool: name.clone(),
                    arguments,
                }),
            ))
        }
        _ => None,
    }
}

fn tool_output_to_thread_item(
    item: &ResponseInputItem,
    pending_tool_calls: &mut HashMap<String, PendingToolCall>,
) -> Option<ThreadItem> {
    match item {
        ResponseInputItem::FunctionCallOutput { call_id, output }
        | ResponseInputItem::CustomToolCallOutput { call_id, output } => {
            let pending_tool_call = pending_tool_calls.remove(call_id)?;
            Some(match pending_tool_call {
                PendingToolCall::Dynamic { tool, arguments } => ThreadItem::DynamicToolCall {
                    id: call_id.clone(),
                    tool,
                    arguments,
                    status: DynamicToolCallStatus::Completed,
                    content_items: output_to_dynamic_content_items(output),
                    success: output.success,
                    duration_ms: None,
                },
                PendingToolCall::Mcp {
                    server,
                    tool,
                    arguments,
                } => ThreadItem::McpToolCall {
                    id: call_id.clone(),
                    server,
                    tool,
                    status: McpToolCallStatus::Completed,
                    arguments,
                    result: Some(McpToolCallResult {
                        content: output_to_mcp_content(output),
                        structured_content: None,
                    }),
                    error: None,
                    duration_ms: None,
                },
            })
        }
        _ => None,
    }
}

fn output_to_dynamic_content_items(
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

fn output_to_mcp_content(output: &FunctionCallOutputPayload) -> Vec<Value> {
    match &output.body {
        FunctionCallOutputBody::Text(text) => vec![serde_json::json!({
            "type": "text",
            "text": text,
        })],
        FunctionCallOutputBody::ContentItems(items) => items
            .iter()
            .map(|item| match item {
                codex_protocol::models::FunctionCallOutputContentItem::InputText { text } => {
                    serde_json::json!({
                        "type": "text",
                        "text": text,
                    })
                }
                codex_protocol::models::FunctionCallOutputContentItem::InputImage {
                    image_url,
                    ..
                } => {
                    serde_json::json!({
                        "type": "image",
                        "imageUrl": image_url,
                    })
                }
            })
            .collect(),
    }
}

fn assistant_item_id(turn_id: &str) -> String {
    format!("{turn_id}:assistant")
}

fn assistant_text(content: &[ContentItem]) -> String {
    content
        .iter()
        .filter_map(|item| match item {
            ContentItem::OutputText { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn reasoning_summary_text(summary: &ReasoningItemReasoningSummary) -> String {
    match summary {
        ReasoningItemReasoningSummary::SummaryText { text } => text.clone(),
    }
}

fn reasoning_content_text(content: &ReasoningItemContent) -> String {
    match content {
        ReasoningItemContent::ReasoningText { text } | ReasoningItemContent::Text { text } => {
            text.clone()
        }
    }
}

fn parse_arguments(arguments: &str) -> Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| Value::String(arguments.to_string()))
}

fn qualify_tool_name(name: &str, namespace: Option<&str>) -> String {
    match namespace {
        Some(namespace) if !namespace.is_empty() => format!("{namespace}__{name}"),
        _ => name.to_string(),
    }
}
