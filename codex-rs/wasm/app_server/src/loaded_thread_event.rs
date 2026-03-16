use codex_app_server_protocol::AgentMessageDeltaNotification;
use codex_app_server_protocol::PlanDeltaNotification;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;

use crate::MessageProcessor;
use crate::ThreadRecord;

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
    let mut thread = thread_record.in_process_thread_handle();
    let effect = crate::process_core_event(
        message_processor,
        thread_id,
        &mut thread,
        next_request_id,
        event,
    );
    let mut updated_record = thread_record.clone();
    updated_record.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
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
                update_item_with_delta(turn, &delta.item_id, &delta.delta, false);
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
                update_item_with_delta(turn, &delta.item_id, &delta.delta, true);
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
            if let Some(notification) = delta_notification(&event.msg) {
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

fn delta_notification(event: &EventMsg) -> Option<ServerNotification> {
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

fn update_item_with_delta(turn: &mut crate::TurnRecord, item_id: &str, delta: &str, is_plan: bool) {
    if let Some(item) = turn.items.iter_mut().find(|item| item.id() == item_id) {
        match item {
            codex_app_server_protocol::ThreadItem::AgentMessage { text, .. } if !is_plan => {
                text.push_str(delta);
            }
            codex_app_server_protocol::ThreadItem::Plan { text, .. } if is_plan => {
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

    use codex_protocol::protocol::AgentMessageContentDeltaEvent;
    use codex_protocol::protocol::Event;
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::protocol::SessionSource;
    use pretty_assertions::assert_eq;

    use super::process_loaded_thread_event;
    use crate::ApiVersion;
    use crate::MessageProcessor;
    use crate::MessageProcessorArgs;
    use crate::ThreadRecord;
    use crate::TurnRecord;

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
                    items: vec![codex_app_server_protocol::ThreadItem::AgentMessage {
                        id: "item-1".to_string(),
                        text: "hel".to_string(),
                        phase: None,
                    }],
                    status: codex_app_server_protocol::TurnStatus::InProgress,
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
            Some(codex_app_server_protocol::ServerNotification::AgentMessageDelta(
                codex_app_server_protocol::AgentMessageDeltaNotification {
                    thread_id,
                    turn_id,
                    item_id,
                    delta,
                }
            )) if thread_id == "thread-1"
                && turn_id == "turn-1"
                && item_id == "item-1"
                && delta == "lo"
        ));
        assert_eq!(
            effect.updated_record.turns["turn-1"].items,
            vec![codex_app_server_protocol::ThreadItem::AgentMessage {
                id: "item-1".to_string(),
                text: "hello".to_string(),
                phase: None,
            }]
        );
    }
}
