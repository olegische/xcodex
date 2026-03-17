use std::sync::Arc;

use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::ServerRequest;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use tokio::sync::Mutex;
use wasm_bindgen::JsValue;

#[cfg(test)]
use codex_app_server_protocol::ThreadItem;

use crate::jsonrpc_bridge::server_notification_to_jsonrpc;
use crate::jsonrpc_bridge::server_request_to_jsonrpc;
use crate::state::RuntimeState;

enum NotificationEnqueueSource {
    Core,
    HostLive,
}

pub(crate) async fn process_core_event(
    state: &Arc<Mutex<RuntimeState>>,
    thread_id: &str,
    event: Event,
) -> Result<(), JsValue> {
    browser_log(&format!(
        "[wasm/browser] process_core_event type={}",
        event_name(&event.msg)
    ));
    let mut outgoing_notifications = Vec::new();
    let mut outgoing_requests = Vec::new();
    let (app_server, root_app_server, next_request_id, thread_record) = {
        let mut state = state.lock().await;
        let next_request_id = if matches!(
            &event.msg,
            EventMsg::ExecApprovalRequest(_)
                | EventMsg::ApplyPatchApprovalRequest(_)
                | EventMsg::RequestPermissions(_)
                | EventMsg::RequestUserInput(_)
                | EventMsg::ElicitationRequest(_)
                | EventMsg::DynamicToolCallRequest(_)
        ) {
            Some(state.next_request_id())
        } else {
            None
        };
        let loaded = match state.threads.get(thread_id) {
            Some(loaded) => loaded,
            None => return Ok(()),
        };
        (
            Arc::clone(&loaded.app_server),
            Arc::clone(&state.app_server),
            next_request_id,
            loaded.record.clone(),
        )
    };
    let effect = {
        let mut app_server = app_server.lock().await;
        codex_wasm_app_server::process_loaded_thread_event(
            &mut app_server,
            thread_id,
            &thread_record,
            next_request_id,
            &event,
        )
    };
    let updated_record = {
        let mut state = state.lock().await;
        let updated_record = {
            let loaded = match state.threads.get_mut(thread_id) {
                Some(loaded) => loaded,
                None => return Ok(()),
            };
            loaded.record = effect.updated_record.clone();
            loaded.record.clone()
        };
        outgoing_notifications.extend(effect.notifications);
        for request in effect.server_requests {
            state
                .pending_server_request_threads
                .insert(request.id().clone(), thread_id.to_string());
            outgoing_requests.push(request);
        }
        updated_record
    };
    {
        let mut app_server = app_server.lock().await;
        app_server.register_thread(updated_record.clone());
    }
    {
        let mut app_server = root_app_server.lock().await;
        app_server.register_thread(updated_record);
    }

    for notification in outgoing_notifications {
        enqueue_server_notification(state, notification).await;
    }
    for request in outgoing_requests {
        enqueue_server_request(state, request).await;
    }
    Ok(())
}

pub(crate) async fn enqueue_server_notification(
    state: &Arc<Mutex<RuntimeState>>,
    notification: codex_app_server_protocol::ServerNotification,
) {
    enqueue_server_notification_with_source(state, notification, NotificationEnqueueSource::Core)
        .await;
}

pub(crate) async fn enqueue_host_server_notification(
    state: &Arc<Mutex<RuntimeState>>,
    notification: codex_app_server_protocol::ServerNotification,
) {
    enqueue_server_notification_with_source(
        state,
        notification,
        NotificationEnqueueSource::HostLive,
    )
    .await;
}

async fn enqueue_server_notification_with_source(
    state: &Arc<Mutex<RuntimeState>>,
    notification: codex_app_server_protocol::ServerNotification,
    source: NotificationEnqueueSource,
) {
    let tx = {
        let mut state = state.lock().await;
        if matches!(source, NotificationEnqueueSource::HostLive) {
            state.record_live_notification(&notification);
        }
        match source {
            NotificationEnqueueSource::Core => {
                if !state.should_enqueue_core_notification(&notification) {
                    browser_log(&format!(
                        "[wasm/browser] suppressed duplicate server notification method={}",
                        notification_method(&notification)
                    ));
                    return;
                }
            }
            NotificationEnqueueSource::HostLive => {}
        }
        state.outgoing_tx.clone()
    };
    browser_log(&format!(
        "[wasm/browser] enqueue_server_notification method={}",
        notification_method(&notification)
    ));
    let message = JSONRPCMessage::Notification(server_notification_to_jsonrpc(notification));
    let _ = tx.send(message).await;
}

pub(crate) async fn enqueue_server_request(
    state: &Arc<Mutex<RuntimeState>>,
    request: ServerRequest,
) {
    let jsonrpc = server_request_to_jsonrpc(request);
    let tx = {
        let state = state.lock().await;
        state.outgoing_tx.clone()
    };
    let _ = tx.send(JSONRPCMessage::Request(jsonrpc)).await;
}

fn event_name(event: &EventMsg) -> &'static str {
    match event {
        EventMsg::TurnStarted(_) => "TurnStarted",
        EventMsg::TurnComplete(_) => "TurnComplete",
        EventMsg::TurnAborted(_) => "TurnAborted",
        EventMsg::Error(_) => "Error",
        EventMsg::RawResponseItem(_) => "RawResponseItem",
        EventMsg::ItemStarted(_) => "ItemStarted",
        EventMsg::ItemCompleted(_) => "ItemCompleted",
        EventMsg::AgentMessageContentDelta(_) => "AgentMessageContentDelta",
        EventMsg::PlanDelta(_) => "PlanDelta",
        EventMsg::ExecApprovalRequest(_) => "ExecApprovalRequest",
        EventMsg::ApplyPatchApprovalRequest(_) => "ApplyPatchApprovalRequest",
        EventMsg::RequestPermissions(_) => "RequestPermissions",
        EventMsg::RequestUserInput(_) => "RequestUserInput",
        EventMsg::ElicitationRequest(_) => "ElicitationRequest",
        EventMsg::DynamicToolCallRequest(_) => "DynamicToolCallRequest",
        EventMsg::TokenCount(_) => "TokenCount",
        EventMsg::BackgroundEvent(_) => "BackgroundEvent",
        EventMsg::ExecCommandBegin(_) => "ExecCommandBegin",
        EventMsg::ExecCommandEnd(_) => "ExecCommandEnd",
        EventMsg::PatchApplyBegin(_) => "PatchApplyBegin",
        EventMsg::PatchApplyEnd(_) => "PatchApplyEnd",
        EventMsg::McpToolCallBegin(_) => "McpToolCallBegin",
        EventMsg::McpToolCallEnd(_) => "McpToolCallEnd",
        EventMsg::WebSearchBegin(_) => "WebSearchBegin",
        EventMsg::WebSearchEnd(_) => "WebSearchEnd",
        EventMsg::ImageGenerationBegin(_) => "ImageGenerationBegin",
        EventMsg::ImageGenerationEnd(_) => "ImageGenerationEnd",
        EventMsg::AgentReasoningDelta(_) => "AgentReasoningDelta",
        EventMsg::AgentReasoningRawContentDelta(_) => "AgentReasoningRawContentDelta",
        EventMsg::AgentMessageDelta(_) => "AgentMessageDelta",
        EventMsg::DynamicToolCallResponse(_) => "DynamicToolCallResponse",
        EventMsg::TurnDiff(_) => "TurnDiff",
        _ => "Other",
    }
}

fn notification_method(notification: &codex_app_server_protocol::ServerNotification) -> String {
    serde_json::to_value(notification)
        .ok()
        .and_then(|value| {
            value
                .as_object()
                .and_then(|object| object.get("method"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
fn apply_notification_to_loaded_record(
    record: &mut codex_wasm_app_server::ThreadRecord,
    notification: &codex_app_server_protocol::ServerNotification,
) {
    let mut thread = record.in_process_thread_handle();
    codex_wasm_app_server::apply_server_notification_to_thread(&mut thread, notification);
    record.apply_in_process_thread_handle(thread);
    match notification {
        codex_app_server_protocol::ServerNotification::AgentMessageDelta(payload) => {
            append_agent_message_delta(record, &payload.turn_id, &payload.item_id, &payload.delta);
        }
        codex_app_server_protocol::ServerNotification::ReasoningSummaryTextDelta(payload) => {
            append_reasoning_summary_delta(
                record,
                &payload.turn_id,
                &payload.item_id,
                payload.summary_index,
                &payload.delta,
            );
        }
        codex_app_server_protocol::ServerNotification::ReasoningSummaryPartAdded(payload) => {
            ensure_reasoning_summary_slot(
                record,
                &payload.turn_id,
                &payload.item_id,
                payload.summary_index,
            );
        }
        codex_app_server_protocol::ServerNotification::ReasoningTextDelta(payload) => {
            append_reasoning_content_delta(
                record,
                &payload.turn_id,
                &payload.item_id,
                payload.content_index,
                &payload.delta,
            );
        }
        _ => {}
    }
    record.updated_at = codex_wasm_core::time::now_unix_seconds();
}

#[cfg(test)]
fn append_agent_message_delta(
    record: &mut codex_wasm_app_server::ThreadRecord,
    turn_id: &str,
    item_id: &str,
    delta: &str,
) {
    let Some(turn) = record.turns.get_mut(turn_id) else {
        return;
    };
    let Some(ThreadItem::AgentMessage { text, .. }) =
        turn.items.iter_mut().find(|item| item.id() == item_id)
    else {
        return;
    };
    text.push_str(delta);
}

#[cfg(test)]
fn append_reasoning_summary_delta(
    record: &mut codex_wasm_app_server::ThreadRecord,
    turn_id: &str,
    item_id: &str,
    summary_index: i64,
    delta: &str,
) {
    let Some(ThreadItem::Reasoning { summary, .. }) =
        find_thread_item_mut(record, turn_id, item_id)
    else {
        return;
    };
    let Some(index) = usize::try_from(summary_index).ok() else {
        return;
    };
    while summary.len() <= index {
        summary.push(String::new());
    }
    summary[index].push_str(delta);
}

#[cfg(test)]
fn append_reasoning_content_delta(
    record: &mut codex_wasm_app_server::ThreadRecord,
    turn_id: &str,
    item_id: &str,
    content_index: i64,
    delta: &str,
) {
    let Some(ThreadItem::Reasoning { content, .. }) =
        find_thread_item_mut(record, turn_id, item_id)
    else {
        return;
    };
    let Some(index) = usize::try_from(content_index).ok() else {
        return;
    };
    while content.len() <= index {
        content.push(String::new());
    }
    content[index].push_str(delta);
}

#[cfg(test)]
fn ensure_reasoning_summary_slot(
    record: &mut codex_wasm_app_server::ThreadRecord,
    turn_id: &str,
    item_id: &str,
    summary_index: i64,
) {
    let Some(ThreadItem::Reasoning { summary, .. }) =
        find_thread_item_mut(record, turn_id, item_id)
    else {
        return;
    };
    let Some(index) = usize::try_from(summary_index).ok() else {
        return;
    };
    while summary.len() <= index {
        summary.push(String::new());
    }
}

#[cfg(test)]
fn find_thread_item_mut<'a>(
    record: &'a mut codex_wasm_app_server::ThreadRecord,
    turn_id: &str,
    item_id: &str,
) -> Option<&'a mut ThreadItem> {
    let turn = record.turns.get_mut(turn_id)?;
    turn.items.iter_mut().find(|item| item.id() == item_id)
}

#[cfg(target_arch = "wasm32")]
fn browser_log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}

#[cfg(not(target_arch = "wasm32"))]
fn browser_log(_message: &str) {}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use codex_app_server_protocol::AgentMessageDeltaNotification;
    use codex_app_server_protocol::ItemCompletedNotification;
    use codex_app_server_protocol::ItemStartedNotification;
    use codex_app_server_protocol::ReasoningSummaryPartAddedNotification;
    use codex_app_server_protocol::ReasoningSummaryTextDeltaNotification;
    use codex_app_server_protocol::ReasoningTextDeltaNotification;
    use codex_app_server_protocol::ServerNotification;
    use codex_app_server_protocol::ThreadItem;
    use codex_app_server_protocol::TurnStatus;
    use codex_protocol::protocol::SessionSource;
    use pretty_assertions::assert_eq;

    use super::apply_notification_to_loaded_record;

    fn thread_record_with_turn(items: Vec<ThreadItem>) -> codex_wasm_app_server::ThreadRecord {
        codex_wasm_app_server::ThreadRecord {
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
                codex_wasm_app_server::TurnRecord {
                    id: "turn-1".to_string(),
                    items,
                    status: TurnStatus::InProgress,
                    error: None,
                },
            )]),
            active_turn_id: Some("turn-1".to_string()),
            waiting_on_approval: false,
            waiting_on_user_input: false,
        }
    }

    #[test]
    fn host_sink_notifications_update_agent_message_record() {
        let mut record = thread_record_with_turn(Vec::new());

        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item: ThreadItem::AgentMessage {
                    id: "item-1".to_string(),
                    text: String::new(),
                    phase: None,
                },
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::AgentMessageDelta(AgentMessageDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-1".to_string(),
                delta: "hel".to_string(),
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::AgentMessageDelta(AgentMessageDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-1".to_string(),
                delta: "lo".to_string(),
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ItemCompleted(ItemCompletedNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item: ThreadItem::AgentMessage {
                    id: "item-1".to_string(),
                    text: "hello".to_string(),
                    phase: None,
                },
            }),
        );

        assert_eq!(
            record.turns["turn-1"].items,
            vec![ThreadItem::AgentMessage {
                id: "item-1".to_string(),
                text: "hello".to_string(),
                phase: None,
            }]
        );
    }

    #[test]
    fn host_sink_notifications_update_reasoning_record() {
        let mut record = thread_record_with_turn(Vec::new());

        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ItemStarted(ItemStartedNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item: ThreadItem::Reasoning {
                    id: "reasoning-1".to_string(),
                    summary: Vec::new(),
                    content: Vec::new(),
                },
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ReasoningSummaryPartAdded(ReasoningSummaryPartAddedNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "reasoning-1".to_string(),
                summary_index: 0,
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ReasoningSummaryTextDelta(ReasoningSummaryTextDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "reasoning-1".to_string(),
                summary_index: 0,
                delta: "step".to_string(),
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ReasoningTextDelta(ReasoningTextDeltaNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "reasoning-1".to_string(),
                content_index: 0,
                delta: "trace".to_string(),
            }),
        );
        apply_notification_to_loaded_record(
            &mut record,
            &ServerNotification::ItemCompleted(ItemCompletedNotification {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item: ThreadItem::Reasoning {
                    id: "reasoning-1".to_string(),
                    summary: vec!["step".to_string()],
                    content: vec!["trace".to_string()],
                },
            }),
        );

        assert_eq!(
            record.turns["turn-1"].items,
            vec![ThreadItem::Reasoning {
                id: "reasoning-1".to_string(),
                summary: vec!["step".to_string()],
                content: vec!["trace".to_string()],
            }]
        );
    }
}
