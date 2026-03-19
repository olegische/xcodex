use std::collections::HashMap;

use codex_app_server_protocol::AgentMessageDeltaNotification;
use codex_app_server_protocol::DynamicToolCallOutputContentItem;
use codex_app_server_protocol::DynamicToolCallStatus;
use codex_app_server_protocol::ItemCompletedNotification;
use codex_app_server_protocol::ItemStartedNotification;
use codex_app_server_protocol::McpToolCallError;
use codex_app_server_protocol::McpToolCallResult;
use codex_app_server_protocol::McpToolCallStatus;
use codex_app_server_protocol::PatchApplyStatus;
use codex_app_server_protocol::PlanDeltaNotification;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::TurnCompletedNotification;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStartedNotification;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::TurnAbortReason;

use crate::MessageProcessor;
use crate::ThreadRecord;
use crate::ThreadState;
use crate::thread_history::canonical_browser_tool_name;

#[derive(Debug, Clone)]
enum PendingToolCall {
    Dynamic {
        tool: String,
        arguments: serde_json::Value,
    },
}

pub fn apply_bespoke_event_handling(
    thread_id: &str,
    thread_state: &mut ThreadState,
    event: &Event,
) -> Vec<ServerNotification> {
    match &event.msg {
        EventMsg::TurnStarted(payload) => {
            thread_state.start_turn(payload.turn_id.clone());
            vec![ServerNotification::TurnStarted(TurnStartedNotification {
                thread_id: thread_id.to_string(),
                turn: thread_state
                    .active_turn_snapshot(TurnStatus::InProgress)
                    .unwrap_or_else(|| panic!("turn snapshot missing after start_turn")),
            })]
        }
        EventMsg::TurnComplete(_) => {
            let Some(turn) = thread_state.active_turn_snapshot(TurnStatus::Completed) else {
                return Vec::new();
            };
            thread_state.active_turn_id = None;
            vec![ServerNotification::TurnCompleted(
                TurnCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn,
                },
            )]
        }
        EventMsg::TurnAborted(payload) => {
            let Some(turn) =
                thread_state.active_turn_snapshot(abort_reason_to_turn_status(&payload.reason))
            else {
                return Vec::new();
            };
            thread_state.active_turn_id = None;
            vec![ServerNotification::TurnCompleted(
                TurnCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn,
                },
            )]
        }
        EventMsg::Error(error) => {
            thread_state.turn_summary.last_error = Some(TurnError {
                message: error.message.clone(),
                codex_error_info: None,
                additional_details: None,
            });
            let Some(turn) = thread_state.active_turn_snapshot(TurnStatus::Failed) else {
                return Vec::new();
            };
            thread_state.active_turn_id = None;
            vec![ServerNotification::TurnCompleted(
                TurnCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn,
                },
            )]
        }
        EventMsg::ItemStarted(item) => {
            let turn_id = item.turn_id.clone();
            let item = ThreadItem::from(item.item.clone());
            apply_item_started(thread_state, item.clone());
            vec![ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: thread_id.to_string(),
                turn_id,
                item,
            })]
        }
        EventMsg::ItemCompleted(item) => {
            let turn_id = item.turn_id.clone();
            let item = ThreadItem::from(item.item.clone());
            apply_item_completed(thread_state, item.clone());
            vec![ServerNotification::ItemCompleted(
                ItemCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn_id,
                    item,
                },
            )]
        }
        EventMsg::RawResponseItem(raw_item) => {
            let Some(turn_id) = thread_state.active_turn_id.clone() else {
                return Vec::new();
            };
            apply_raw_response_item(thread_id, &turn_id, thread_state, &raw_item.item)
        }
        EventMsg::DynamicToolCallRequest(event) => {
            if canonical_browser_tool_name(&event.tool, None).is_some() {
                return Vec::new();
            }
            let item = dynamic_tool_call_started_item(event);
            apply_item_started(thread_state, item.clone());
            vec![ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: thread_id.to_string(),
                turn_id: event.turn_id.clone(),
                item,
            })]
        }
        EventMsg::DynamicToolCallResponse(event) => {
            if canonical_browser_tool_name(&event.tool, None).is_some() {
                return Vec::new();
            }
            let item = dynamic_tool_call_completed_item(event);
            apply_item_completed(thread_state, item.clone());
            vec![ServerNotification::ItemCompleted(
                ItemCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    item,
                },
            )]
        }
        EventMsg::McpToolCallBegin(event) => {
            let Some(turn_id) = thread_state.active_turn_id.clone() else {
                return Vec::new();
            };
            let item = mcp_tool_call_started_item(event);
            apply_item_started(thread_state, item.clone());
            vec![ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: thread_id.to_string(),
                turn_id,
                item,
            })]
        }
        EventMsg::McpToolCallEnd(event) => {
            let Some(turn_id) = thread_state.active_turn_id.clone() else {
                return Vec::new();
            };
            let item = mcp_tool_call_completed_item(event);
            apply_item_completed(thread_state, item.clone());
            vec![ServerNotification::ItemCompleted(
                ItemCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn_id,
                    item,
                },
            )]
        }
        EventMsg::ExecCommandBegin(event) => {
            let item = exec_command_started_item(event);
            apply_item_started(thread_state, item.clone());
            vec![ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: thread_id.to_string(),
                turn_id: event.turn_id.clone(),
                item,
            })]
        }
        EventMsg::ExecCommandEnd(event) => {
            let item = exec_command_completed_item(event);
            apply_item_completed(thread_state, item.clone());
            vec![ServerNotification::ItemCompleted(
                ItemCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    item,
                },
            )]
        }
        EventMsg::PatchApplyBegin(event) => {
            let item = patch_apply_started_item(event);
            apply_item_started(thread_state, item.clone());
            vec![ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: thread_id.to_string(),
                turn_id: event.turn_id.clone(),
                item,
            })]
        }
        EventMsg::PatchApplyEnd(event) => {
            let item = patch_apply_completed_item(event);
            apply_item_completed(thread_state, item.clone());
            vec![ServerNotification::ItemCompleted(
                ItemCompletedNotification {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    item,
                },
            )]
        }
        _ => Vec::new(),
    }
}

fn apply_raw_response_item(
    thread_id: &str,
    turn_id: &str,
    thread_state: &mut ThreadState,
    item: &ResponseItem,
) -> Vec<ServerNotification> {
    let mut pending_tool_calls: HashMap<String, PendingToolCall> = thread_state
        .current_turn_items
        .iter()
        .filter_map(|item| match item {
            ThreadItem::DynamicToolCall {
                id,
                tool,
                arguments,
                status: DynamicToolCallStatus::InProgress,
                ..
            } => Some((
                id.clone(),
                PendingToolCall::Dynamic {
                    tool: tool.clone(),
                    arguments: arguments.clone(),
                },
            )),
            _ => None,
        })
        .collect();

    if let Some(started_item) = response_item_to_started_thread_item(item) {
        if thread_state
            .current_turn_items
            .iter()
            .all(|entry| entry.id() != started_item.id())
        {
            thread_state.current_turn_items.push(started_item.clone());
            return vec![ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
                item: started_item,
            })];
        }
        return Vec::new();
    }

    let Some(completed_item) = tool_output_to_thread_item(item, &mut pending_tool_calls) else {
        return Vec::new();
    };

    apply_item_completed(thread_state, completed_item.clone());
    vec![ServerNotification::ItemCompleted(
        ItemCompletedNotification {
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
            item: completed_item,
        },
    )]
}

fn apply_item_started(thread_state: &mut ThreadState, item: ThreadItem) {
    if thread_state
        .current_turn_items
        .iter()
        .all(|entry| entry.id() != item.id())
    {
        thread_state.current_turn_items.push(item);
    }
}

fn apply_item_completed(thread_state: &mut ThreadState, item: ThreadItem) {
    if let Some(existing) = thread_state
        .current_turn_items
        .iter_mut()
        .find(|entry| entry.id() == item.id())
    {
        *existing = item;
    } else {
        thread_state.current_turn_items.push(item);
    }
}

fn response_item_to_started_thread_item(item: &ResponseItem) -> Option<ThreadItem> {
    match item {
        ResponseItem::FunctionCall {
            name,
            namespace,
            arguments,
            call_id,
            ..
        } => canonical_browser_tool_name(name, namespace.as_deref()).map(|tool| {
            ThreadItem::DynamicToolCall {
                id: call_id.clone(),
                tool,
                arguments: parse_arguments(arguments),
                status: DynamicToolCallStatus::InProgress,
                content_items: None,
                success: None,
                duration_ms: None,
            }
        }),
        ResponseItem::CustomToolCall {
            call_id,
            name,
            input,
            ..
        } => canonical_browser_tool_name(name, None).map(|tool| ThreadItem::DynamicToolCall {
            id: call_id.clone(),
            tool,
            arguments: parse_arguments(input),
            status: DynamicToolCallStatus::InProgress,
            content_items: None,
            success: None,
            duration_ms: None,
        }),
        _ => None,
    }
}

fn tool_output_to_thread_item(
    item: &ResponseItem,
    pending_tool_calls: &mut HashMap<String, PendingToolCall>,
) -> Option<ThreadItem> {
    match item {
        ResponseItem::FunctionCallOutput { call_id, output }
        | ResponseItem::CustomToolCallOutput { call_id, output } => {
            let pending_tool_call = pending_tool_calls.remove(call_id)?;
            Some(match pending_tool_call {
                PendingToolCall::Dynamic { tool, arguments } => ThreadItem::DynamicToolCall {
                    id: call_id.clone(),
                    tool,
                    arguments,
                    status: dynamic_tool_call_status_from_output(output),
                    content_items: output_to_dynamic_content_items(output),
                    success: output.success,
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

fn dynamic_tool_call_status_from_output(
    output: &FunctionCallOutputPayload,
) -> DynamicToolCallStatus {
    match output.success {
        Some(false) => DynamicToolCallStatus::Failed,
        Some(true) | None => DynamicToolCallStatus::Completed,
    }
}

fn parse_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments)
        .unwrap_or_else(|_| serde_json::Value::String(arguments.to_string()))
}

fn abort_reason_to_turn_status(reason: &TurnAbortReason) -> TurnStatus {
    match reason {
        TurnAbortReason::Interrupted | TurnAbortReason::Replaced | TurnAbortReason::ReviewEnded => {
            TurnStatus::Interrupted
        }
    }
}

fn dynamic_tool_call_started_item(
    event: &codex_protocol::dynamic_tools::DynamicToolCallRequest,
) -> ThreadItem {
    ThreadItem::DynamicToolCall {
        id: event.call_id.clone(),
        tool: canonical_browser_tool_name(&event.tool, None).unwrap_or_else(|| event.tool.clone()),
        arguments: event.arguments.clone(),
        status: DynamicToolCallStatus::InProgress,
        content_items: None,
        success: None,
        duration_ms: None,
    }
}

fn dynamic_tool_call_completed_item(
    event: &codex_protocol::protocol::DynamicToolCallResponseEvent,
) -> ThreadItem {
    ThreadItem::DynamicToolCall {
        id: event.call_id.clone(),
        tool: canonical_browser_tool_name(&event.tool, None).unwrap_or_else(|| event.tool.clone()),
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
        duration_ms: duration_ms_i64(event.duration),
    }
}

fn mcp_tool_call_started_item(
    event: &codex_protocol::protocol::McpToolCallBeginEvent,
) -> ThreadItem {
    ThreadItem::McpToolCall {
        id: event.call_id.clone(),
        server: event.invocation.server.clone(),
        tool: event.invocation.tool.clone(),
        status: McpToolCallStatus::InProgress,
        arguments: event
            .invocation
            .arguments
            .clone()
            .unwrap_or(serde_json::Value::Null),
        result: None,
        error: None,
        duration_ms: None,
    }
}

fn mcp_tool_call_completed_item(
    event: &codex_protocol::protocol::McpToolCallEndEvent,
) -> ThreadItem {
    let (status, result, error) = match &event.result {
        Ok(result) if !result.is_error.unwrap_or(false) => (
            McpToolCallStatus::Completed,
            Some(McpToolCallResult {
                content: result.content.clone(),
                structured_content: result.structured_content.clone(),
            }),
            None,
        ),
        Ok(result) => (
            McpToolCallStatus::Failed,
            Some(McpToolCallResult {
                content: result.content.clone(),
                structured_content: result.structured_content.clone(),
            }),
            None,
        ),
        Err(message) => (
            McpToolCallStatus::Failed,
            None,
            Some(McpToolCallError {
                message: message.clone(),
            }),
        ),
    };

    ThreadItem::McpToolCall {
        id: event.call_id.clone(),
        server: event.invocation.server.clone(),
        tool: event.invocation.tool.clone(),
        status,
        arguments: event
            .invocation
            .arguments
            .clone()
            .unwrap_or(serde_json::Value::Null),
        result,
        error,
        duration_ms: duration_ms_i64(event.duration),
    }
}

fn exec_command_started_item(
    event: &codex_protocol::protocol::ExecCommandBeginEvent,
) -> ThreadItem {
    ThreadItem::CommandExecution {
        id: event.call_id.clone(),
        command: event.command.join(" "),
        cwd: event.cwd.clone(),
        process_id: event.process_id.clone(),
        status: codex_app_server_protocol::CommandExecutionStatus::InProgress,
        command_actions: event.parsed_cmd.iter().cloned().map(Into::into).collect(),
        aggregated_output: None,
        exit_code: None,
        duration_ms: None,
    }
}

fn exec_command_completed_item(
    event: &codex_protocol::protocol::ExecCommandEndEvent,
) -> ThreadItem {
    ThreadItem::CommandExecution {
        id: event.call_id.clone(),
        command: event.command.join(" "),
        cwd: event.cwd.clone(),
        process_id: event.process_id.clone(),
        status: codex_app_server_protocol::CommandExecutionStatus::from(event.status.clone()),
        command_actions: event.parsed_cmd.iter().cloned().map(Into::into).collect(),
        aggregated_output: Some(event.aggregated_output.clone()),
        exit_code: Some(event.exit_code),
        duration_ms: duration_ms_i64(event.duration),
    }
}

fn patch_apply_started_item(event: &codex_protocol::protocol::PatchApplyBeginEvent) -> ThreadItem {
    ThreadItem::FileChange {
        id: event.call_id.clone(),
        changes: map_patch_changes(&event.changes),
        status: PatchApplyStatus::InProgress,
    }
}

fn patch_apply_completed_item(event: &codex_protocol::protocol::PatchApplyEndEvent) -> ThreadItem {
    ThreadItem::FileChange {
        id: event.call_id.clone(),
        changes: map_patch_changes(&event.changes),
        status: PatchApplyStatus::from(event.status.clone()),
    }
}

fn map_patch_changes(
    changes: &HashMap<std::path::PathBuf, codex_protocol::protocol::FileChange>,
) -> Vec<codex_app_server_protocol::FileUpdateChange> {
    changes
        .iter()
        .map(|(path, change)| {
            let (kind, diff) = match change {
                codex_protocol::protocol::FileChange::Add { content } => (
                    codex_app_server_protocol::PatchChangeKind::Add,
                    content.clone(),
                ),
                codex_protocol::protocol::FileChange::Delete { content } => (
                    codex_app_server_protocol::PatchChangeKind::Delete,
                    content.clone(),
                ),
                codex_protocol::protocol::FileChange::Update {
                    unified_diff,
                    move_path,
                } => (
                    codex_app_server_protocol::PatchChangeKind::Update {
                        move_path: move_path.clone(),
                    },
                    unified_diff.clone(),
                ),
            };

            codex_app_server_protocol::FileUpdateChange {
                path: path.display().to_string(),
                kind,
                diff,
            }
        })
        .collect()
}

fn duration_ms_i64(duration: std::time::Duration) -> Option<i64> {
    i64::try_from(duration.as_millis()).ok()
}

pub struct LoadedThreadEventEffect {
    pub notifications: Vec<ServerNotification>,
    pub server_requests: Vec<ServerRequest>,
    pub updated_record: ThreadRecord,
}

pub fn process_loaded_thread_event(
    message_processor: &mut MessageProcessor,
    thread_id: &str,
    thread_record: &ThreadRecord,
    next_request_id: Option<RequestId>,
    event: &Event,
) -> LoadedThreadEventEffect {
    let mut notifications = Vec::new();
    let mut server_requests = Vec::new();
    message_processor.sync_thread_state_from_record(thread_record);
    let mut thread = thread_record.in_process_thread_handle();
    let effect = crate::process_core_event(
        message_processor,
        thread_id,
        &mut thread,
        next_request_id,
        event,
    );
    let mut updated_record = thread_record.clone();
    updated_record.updated_at = codex_wasm_core::time::now_unix_seconds();
    updated_record.apply_in_process_thread_handle(thread);
    notifications.extend(effect.notifications);

    match &event.msg {
        EventMsg::TurnStarted(_)
        | EventMsg::TurnComplete(_)
        | EventMsg::TurnAborted(_)
        | EventMsg::Error(_)
        | EventMsg::ItemStarted(_)
        | EventMsg::ItemCompleted(_)
        | EventMsg::RawResponseItem(_) => {}
        EventMsg::AgentMessageContentDelta(delta) => {
            if let Some(turn) = updated_record.turns.get_mut(&delta.turn_id) {
                update_loaded_thread_item_with_delta(turn, &delta.item_id, &delta.delta, false);
            }
            notifications.push(ServerNotification::AgentMessageDelta(
                AgentMessageDeltaNotification {
                    thread_id: delta.thread_id.clone(),
                    turn_id: delta.turn_id.clone(),
                    item_id: delta.item_id.clone(),
                    delta: delta.delta.clone(),
                },
            ));
        }
        EventMsg::PlanDelta(delta) => {
            if let Some(turn) = updated_record.turns.get_mut(&delta.turn_id) {
                update_loaded_thread_item_with_delta(turn, &delta.item_id, &delta.delta, true);
            }
            notifications.push(ServerNotification::PlanDelta(PlanDeltaNotification {
                thread_id: delta.thread_id.clone(),
                turn_id: delta.turn_id.clone(),
                item_id: delta.item_id.clone(),
                delta: delta.delta.clone(),
            }));
        }
        EventMsg::ExecApprovalRequest(_)
        | EventMsg::ApplyPatchApprovalRequest(_)
        | EventMsg::RequestPermissions(_)
        | EventMsg::RequestUserInput(_)
        | EventMsg::ElicitationRequest(_)
        | EventMsg::DynamicToolCallRequest(_) => {
            for (_request_id, _pending, request) in effect.server_requests {
                server_requests.push(request);
            }
        }
        EventMsg::DynamicToolCallResponse(_)
        | EventMsg::McpToolCallBegin(_)
        | EventMsg::McpToolCallEnd(_)
        | EventMsg::ExecCommandBegin(_)
        | EventMsg::ExecCommandEnd(_)
        | EventMsg::PatchApplyBegin(_)
        | EventMsg::PatchApplyEnd(_) => {}
        _ => {
            if let Some(notification) = loaded_thread_delta_notification(&event.msg) {
                notifications.push(notification);
            }
        }
    }

    LoadedThreadEventEffect {
        notifications,
        server_requests,
        updated_record,
    }
}

fn loaded_thread_delta_notification(event: &EventMsg) -> Option<ServerNotification> {
    match event {
        EventMsg::AgentMessageContentDelta(event) => Some(ServerNotification::AgentMessageDelta(
            AgentMessageDeltaNotification {
                thread_id: event.thread_id.clone(),
                turn_id: event.turn_id.clone(),
                item_id: event.item_id.clone(),
                delta: event.delta.clone(),
            },
        )),
        EventMsg::PlanDelta(event) => Some(ServerNotification::PlanDelta(PlanDeltaNotification {
            thread_id: event.thread_id.clone(),
            turn_id: event.turn_id.clone(),
            item_id: event.item_id.clone(),
            delta: event.delta.clone(),
        })),
        _ => None,
    }
}

fn update_loaded_thread_item_with_delta(
    turn: &mut crate::TurnRecord,
    item_id: &str,
    delta: &str,
    is_plan: bool,
) {
    if let Some(item) = turn.items.iter_mut().find(|item| item.id() == item_id) {
        match item {
            ThreadItem::AgentMessage { text, .. } if !is_plan => {
                text.push_str(delta);
            }
            ThreadItem::Plan { text, .. } if is_plan => {
                text.push_str(delta);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use codex_app_server_protocol::AgentMessageDeltaNotification;
    use codex_app_server_protocol::DynamicToolCallOutputContentItem;
    use codex_app_server_protocol::DynamicToolCallStatus;
    use codex_app_server_protocol::ItemCompletedNotification;
    use codex_app_server_protocol::ItemStartedNotification;
    use codex_app_server_protocol::ServerNotification;
    use codex_app_server_protocol::ThreadItem;
    use codex_app_server_protocol::TurnCompletedNotification;
    use codex_app_server_protocol::TurnStartedNotification;
    use codex_app_server_protocol::TurnStatus;
    use codex_protocol::config_types::ModeKind;
    use codex_protocol::models::FunctionCallOutputPayload;
    use codex_protocol::models::ResponseItem;
    use codex_protocol::protocol::AgentMessageContentDeltaEvent;
    use codex_protocol::protocol::Event;
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::protocol::SessionSource;
    use codex_protocol::protocol::TurnCompleteEvent;
    use codex_protocol::protocol::TurnStartedEvent;
    use pretty_assertions::assert_eq;

    use super::apply_bespoke_event_handling;
    use super::process_loaded_thread_event;
    use crate::ApiVersion;
    use crate::MessageProcessor;
    use crate::MessageProcessorArgs;
    use crate::ThreadRecord;
    use crate::ThreadState;
    use crate::TurnRecord;

    #[test]
    fn emits_turn_started_for_turn_started_event() {
        let mut thread_state = ThreadState::default();

        let notifications = apply_bespoke_event_handling(
            "thread-1",
            &mut thread_state,
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::TurnStarted(TurnStartedEvent {
                    turn_id: "turn-1".to_string(),
                    model_context_window: None,
                    collaboration_mode_kind: ModeKind::default(),
                }),
            },
        );

        match notifications.as_slice() {
            [ServerNotification::TurnStarted(TurnStartedNotification { thread_id, turn })] => {
                assert_eq!(thread_id, "thread-1");
                assert_eq!(turn.id, "turn-1");
                assert_eq!(turn.items, Vec::new());
                assert_eq!(turn.error, None);
                assert_eq!(turn.status, TurnStatus::InProgress);
            }
            other => panic!("unexpected notifications: {other:?}"),
        }
    }

    #[test]
    fn emits_item_started_for_builtin_function_call() {
        let mut thread_state = ThreadState::default();
        thread_state.start_turn("turn-1".to_string());

        let notifications = apply_bespoke_event_handling(
            "thread-1",
            &mut thread_state,
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::RawResponseItem(codex_protocol::protocol::RawResponseItemEvent {
                    item: ResponseItem::FunctionCall {
                        id: None,
                        name: "list_dir".to_string(),
                        namespace: None,
                        arguments: r#"{ "dir_path": "/workspace" }"#.to_string(),
                        call_id: "call-1".to_string(),
                    },
                }),
            },
        );

        assert_eq!(notifications.len(), 1);
        match &notifications[0] {
            ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id,
                turn_id,
                item,
            }) => {
                assert_eq!(thread_id, "thread-1");
                assert_eq!(turn_id, "turn-1");
                assert_eq!(
                    item,
                    &ThreadItem::DynamicToolCall {
                        id: "call-1".to_string(),
                        tool: "browser__list_dir".to_string(),
                        arguments: serde_json::json!({ "dir_path": "/workspace" }),
                        status: DynamicToolCallStatus::InProgress,
                        content_items: None,
                        success: None,
                        duration_ms: None,
                    }
                );
            }
            other => panic!("unexpected notification: {other:?}"),
        }
    }

    #[test]
    fn emits_item_completed_for_builtin_function_call_output() {
        let mut thread_state = ThreadState::default();
        thread_state.start_turn("turn-1".to_string());
        thread_state
            .current_turn_items
            .push(ThreadItem::DynamicToolCall {
                id: "call-1".to_string(),
                tool: "browser__list_dir".to_string(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::InProgress,
                content_items: None,
                success: None,
                duration_ms: None,
            });

        let notifications = apply_bespoke_event_handling(
            "thread-1",
            &mut thread_state,
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::RawResponseItem(codex_protocol::protocol::RawResponseItemEvent {
                    item: ResponseItem::FunctionCallOutput {
                        call_id: "call-1".to_string(),
                        output: FunctionCallOutputPayload::from_text(
                            "Absolute path: /workspace".to_string(),
                        ),
                    },
                }),
            },
        );

        assert_eq!(notifications.len(), 1);
        match &notifications[0] {
            ServerNotification::ItemCompleted(ItemCompletedNotification {
                thread_id,
                turn_id,
                item,
            }) => {
                assert_eq!(thread_id, "thread-1");
                assert_eq!(turn_id, "turn-1");
                assert_eq!(
                    item,
                    &ThreadItem::DynamicToolCall {
                        id: "call-1".to_string(),
                        tool: "browser__list_dir".to_string(),
                        arguments: serde_json::json!({ "dir_path": "/workspace" }),
                        status: DynamicToolCallStatus::Completed,
                        content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                            text: "Absolute path: /workspace".to_string(),
                        },]),
                        success: None,
                        duration_ms: None,
                    }
                );
            }
            other => panic!("unexpected notification: {other:?}"),
        }
    }

    #[test]
    fn emits_turn_completed_for_turn_complete_event() {
        let mut thread_state = ThreadState::default();
        thread_state.start_turn("turn-1".to_string());

        let notifications = apply_bespoke_event_handling(
            "thread-1",
            &mut thread_state,
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::TurnComplete(TurnCompleteEvent {
                    turn_id: "turn-1".to_string(),
                    last_agent_message: None,
                }),
            },
        );

        match notifications.as_slice() {
            [ServerNotification::TurnCompleted(TurnCompletedNotification { thread_id, turn })] => {
                assert_eq!(thread_id, "thread-1");
                assert_eq!(turn.id, "turn-1");
                assert_eq!(turn.items, Vec::new());
                assert_eq!(turn.error, None);
                assert_eq!(turn.status, TurnStatus::Completed);
            }
            other => panic!("unexpected notifications: {other:?}"),
        }
    }

    #[test]
    fn suppresses_duplicate_browser_dynamic_tool_request_notifications() {
        let mut thread_state = ThreadState::default();
        thread_state.start_turn("turn-1".to_string());

        let notifications = apply_bespoke_event_handling(
            "thread-1",
            &mut thread_state,
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::DynamicToolCallRequest(
                    codex_protocol::dynamic_tools::DynamicToolCallRequest {
                        call_id: "call-1".to_string(),
                        turn_id: "turn-1".to_string(),
                        tool: "browser__list_dir".to_string(),
                        arguments: serde_json::json!({ "dir_path": "/workspace" }),
                    },
                ),
            },
        );

        assert!(notifications.is_empty());
        assert_eq!(thread_state.current_turn_items, Vec::new());
    }

    #[test]
    fn suppresses_duplicate_browser_dynamic_tool_response_notifications() {
        let mut thread_state = ThreadState::default();
        thread_state.start_turn("turn-1".to_string());

        let notifications = apply_bespoke_event_handling(
            "thread-1",
            &mut thread_state,
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::DynamicToolCallResponse(
                    codex_protocol::protocol::DynamicToolCallResponseEvent {
                        call_id: "call-1".to_string(),
                        turn_id: "turn-1".to_string(),
                        tool: "browser__list_dir".to_string(),
                        arguments: serde_json::json!({ "dir_path": "/workspace" }),
                        content_items: Vec::new(),
                        success: true,
                        error: None,
                        duration: std::time::Duration::from_secs(1),
                    },
                ),
            },
        );

        assert!(notifications.is_empty());
        assert_eq!(thread_state.current_turn_items, Vec::new());
    }

    #[test]
    fn agent_message_delta_updates_thread_record_and_emits_notification() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let thread_record = ThreadRecord {
            id: "thread-1".to_string(),
            preview: String::new(),
            ephemeral: false,
            model_provider: "openai".to_string(),
            cwd: PathBuf::from("/workspace"),
            source: SessionSource::Unknown,
            name: None,
            created_at: 1,
            updated_at: 1,
            archived: false,
            turns: BTreeMap::from([(
                "turn-1".to_string(),
                TurnRecord {
                    id: "turn-1".to_string(),
                    items: vec![ThreadItem::AgentMessage {
                        id: "item-1".to_string(),
                        text: "hel".to_string(),
                        phase: None,
                    }],
                    status: TurnStatus::InProgress,
                    error: None,
                },
            )]),
            active_turn_id: Some("turn-1".to_string()),
            waiting_on_approval: false,
            waiting_on_user_input: false,
        };

        let effect = process_loaded_thread_event(
            &mut processor,
            "thread-1",
            &thread_record,
            None,
            &Event {
                id: "evt-1".to_string(),
                msg: EventMsg::AgentMessageContentDelta(AgentMessageContentDeltaEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    item_id: "item-1".to_string(),
                    delta: "lo".to_string(),
                }),
            },
        );

        assert_eq!(effect.server_requests, Vec::new());
        assert_eq!(effect.notifications.len(), 1);
        assert!(matches!(
            effect.notifications.first(),
            Some(ServerNotification::AgentMessageDelta(AgentMessageDeltaNotification {
                thread_id,
                turn_id,
                item_id,
                delta,
            })) if thread_id == "thread-1"
                && turn_id == "turn-1"
                && item_id == "item-1"
                && delta == "lo"
        ));
        assert_eq!(
            effect.updated_record.turns["turn-1"].items,
            vec![ThreadItem::AgentMessage {
                id: "item-1".to_string(),
                text: "hello".to_string(),
                phase: None,
            }]
        );
    }

    #[test]
    fn turn_complete_uses_loaded_thread_record_when_processor_state_is_stale() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let thread_record = ThreadRecord {
            id: "thread-1".to_string(),
            preview: String::new(),
            ephemeral: false,
            model_provider: "openai".to_string(),
            cwd: PathBuf::from("/workspace"),
            source: SessionSource::Unknown,
            name: None,
            created_at: 1,
            updated_at: 1,
            archived: false,
            turns: BTreeMap::from([(
                "turn-1".to_string(),
                TurnRecord {
                    id: "turn-1".to_string(),
                    items: vec![ThreadItem::AgentMessage {
                        id: "item-1".to_string(),
                        text: "ok".to_string(),
                        phase: None,
                    }],
                    status: TurnStatus::InProgress,
                    error: None,
                },
            )]),
            active_turn_id: Some("turn-1".to_string()),
            waiting_on_approval: false,
            waiting_on_user_input: false,
        };

        let effect = process_loaded_thread_event(
            &mut processor,
            "thread-1",
            &thread_record,
            None,
            &Event {
                id: "evt-1".to_string(),
                msg: EventMsg::TurnComplete(TurnCompleteEvent {
                    turn_id: "turn-1".to_string(),
                    last_agent_message: None,
                }),
            },
        );

        match effect.notifications.as_slice() {
            [ServerNotification::TurnCompleted(TurnCompletedNotification { thread_id, turn })] => {
                assert_eq!(thread_id, "thread-1");
                assert_eq!(turn.id, "turn-1");
                assert_eq!(
                    turn.items,
                    vec![ThreadItem::AgentMessage {
                        id: "item-1".to_string(),
                        text: "ok".to_string(),
                        phase: None,
                    }]
                );
                assert_eq!(turn.status, TurnStatus::Completed);
            }
            other => panic!("unexpected notifications: {other:?}"),
        }
    }
}
