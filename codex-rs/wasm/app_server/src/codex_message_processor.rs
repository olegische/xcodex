use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::ServerNotification;
use codex_protocol::protocol::Event;
use std::sync::Arc;

use crate::ThreadState;
use crate::apply_bespoke_event_handling;
use crate::outgoing_message::OutgoingMessageSender;
use crate::outgoing_message::ThreadScopedOutgoingMessageSender;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ApiVersion {
    #[allow(dead_code)]
    V1,
    #[default]
    V2,
}

pub struct CodexMessageProcessorArgs {
    pub api_version: ApiVersion,
    pub outgoing: Arc<std::sync::Mutex<OutgoingMessageSender>>,
}

/// Mirror-track subset of upstream `app-server::CodexMessageProcessor`.
///
/// The browser variant only keeps the protocol-shaping responsibilities that
/// are transport-independent and wasm-safe.
pub struct CodexMessageProcessor {
    api_version: ApiVersion,
    thread_state: ThreadState,
    outgoing: ThreadScopedOutgoingMessageSender,
}

impl CodexMessageProcessor {
    pub fn new(args: CodexMessageProcessorArgs) -> Self {
        Self {
            api_version: args.api_version,
            thread_state: ThreadState::default(),
            outgoing: ThreadScopedOutgoingMessageSender::new(args.outgoing),
        }
    }

    pub fn process_request(&mut self, _request: ClientRequest) {
        // The request routing surface will be filled in incrementally as the
        // browser app-server mirror grows toward the upstream processor.
    }

    pub fn apply_bespoke_event_handling(
        &mut self,
        thread_id: &str,
        event: &Event,
    ) -> Vec<ServerNotification> {
        let notifications = match self.api_version {
            ApiVersion::V1 => Vec::new(),
            ApiVersion::V2 => {
                apply_bespoke_event_handling(thread_id, &mut self.thread_state, event)
            }
        };
        for notification in notifications.iter().cloned() {
            self.outgoing.send_server_notification(notification);
        }
        notifications
    }

    pub fn thread_state(&self) -> &ThreadState {
        &self.thread_state
    }

    pub fn reset_current_turn(&mut self) {
        self.thread_state.reset_current_turn();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use codex_app_server_protocol::ServerNotification;
    use codex_protocol::config_types::ModeKind;
    use codex_protocol::models::ResponseItem;
    use codex_protocol::protocol::Event;
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::protocol::RawResponseItemEvent;
    use codex_protocol::protocol::TurnStartedEvent;

    use super::ApiVersion;
    use super::CodexMessageProcessor;
    use super::CodexMessageProcessorArgs;
    use crate::OutgoingMessageSender;

    #[test]
    fn v2_processor_emits_notifications_for_builtin_tool_items() {
        let mut processor = CodexMessageProcessor::new(CodexMessageProcessorArgs {
            api_version: ApiVersion::V2,
            outgoing: Arc::new(std::sync::Mutex::new(OutgoingMessageSender::new())),
        });

        let notifications = processor.apply_bespoke_event_handling(
            "thread-1",
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::TurnStarted(TurnStartedEvent {
                    turn_id: "turn-1".to_string(),
                    model_context_window: None,
                    collaboration_mode_kind: ModeKind::default(),
                }),
            },
        );

        processor.apply_bespoke_event_handling(
            "thread-1",
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::RawResponseItem(RawResponseItemEvent {
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
        assert!(matches!(
            &notifications[0],
            ServerNotification::TurnStarted(_)
        ));
    }
}
