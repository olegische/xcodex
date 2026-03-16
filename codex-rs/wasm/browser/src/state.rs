use std::collections::HashMap;
use std::collections::HashSet;
use std::collections::VecDeque;
use std::sync::Arc;

use async_channel::Receiver;
use async_channel::Sender;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_wasm_v2_app_server::ApiVersion;
use codex_wasm_v2_app_server::MessageProcessor;
use codex_wasm_v2_app_server::MessageProcessorArgs;
use codex_wasm_v2_core::codex::Codex;
use tokio::sync::Mutex;

const RECENT_NOTIFICATION_KEY_LIMIT: usize = 512;

pub struct RuntimeState {
    pub initialized: bool,
    pub bootstrap: Option<RuntimeBootstrap>,
    pub threads: HashMap<String, LoadedThread>,
    pub app_server: Arc<Mutex<MessageProcessor>>,
    pub next_server_request_id: i64,
    pub outgoing_tx: Sender<codex_app_server_protocol::JSONRPCMessage>,
    pub outgoing_rx: Receiver<codex_app_server_protocol::JSONRPCMessage>,
    pub pending_server_request_threads: HashMap<RequestId, String>,
    pub recent_notification_keys: HashSet<String>,
    pub recent_notification_order: VecDeque<String>,
}

impl RuntimeState {
    pub fn new(
        outgoing_tx: Sender<codex_app_server_protocol::JSONRPCMessage>,
        outgoing_rx: Receiver<codex_app_server_protocol::JSONRPCMessage>,
    ) -> Self {
        Self {
            initialized: false,
            bootstrap: None,
            threads: HashMap::new(),
            app_server: Arc::new(Mutex::new(MessageProcessor::new(MessageProcessorArgs {
                api_version: ApiVersion::V2,
                config_warnings: Vec::new(),
            }))),
            next_server_request_id: 1,
            outgoing_tx,
            outgoing_rx,
            pending_server_request_threads: HashMap::new(),
            recent_notification_keys: HashSet::new(),
            recent_notification_order: VecDeque::new(),
        }
    }

    pub fn next_request_id(&mut self) -> RequestId {
        let id = self.next_server_request_id;
        self.next_server_request_id += 1;
        RequestId::Integer(id)
    }

    pub fn should_enqueue_notification(&mut self, notification: &ServerNotification) -> bool {
        let Some(key) = notification_dedupe_key(notification) else {
            return true;
        };
        if self.recent_notification_keys.contains(&key) {
            return false;
        }
        self.recent_notification_keys.insert(key.clone());
        self.recent_notification_order.push_back(key);
        if self.recent_notification_order.len() > RECENT_NOTIFICATION_KEY_LIMIT
            && let Some(oldest_key) = self.recent_notification_order.pop_front()
        {
            self.recent_notification_keys.remove(&oldest_key);
        }
        true
    }
}

pub struct LoadedThread {
    pub app_server: Arc<Mutex<MessageProcessor>>,
    pub codex: Arc<Codex>,
    pub record: ThreadRecord,
}

pub type RuntimeBootstrap = codex_wasm_v2_app_server::RuntimeBootstrap;
pub type ThreadRecord = codex_wasm_v2_app_server::ThreadRecord;

fn notification_dedupe_key(notification: &ServerNotification) -> Option<String> {
    match notification {
        ServerNotification::ItemStarted(_) | ServerNotification::ItemCompleted(_) => {
            Some(serde_json::to_string(notification).unwrap_or_else(|error| {
                unreachable!("server notification should serialize for dedupe: {error}")
            }))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use async_channel::unbounded;
    use codex_app_server_protocol::DynamicToolCallStatus;
    use codex_app_server_protocol::ItemCompletedNotification;
    use codex_app_server_protocol::ItemStartedNotification;
    use codex_app_server_protocol::ServerNotification;
    use codex_app_server_protocol::ThreadItem;
    use pretty_assertions::assert_eq;

    use super::RuntimeState;

    fn tool_item(call_id: &str) -> ThreadItem {
        ThreadItem::DynamicToolCall {
            id: call_id.to_string(),
            tool: "browser__inspect_storage".to_string(),
            arguments: serde_json::json!({"scope":"page"}),
            status: DynamicToolCallStatus::InProgress,
            content_items: None,
            success: None,
            duration_ms: None,
        }
    }

    #[test]
    fn suppresses_exact_duplicate_item_started_notification() {
        let (tx, rx) = unbounded();
        let mut state = RuntimeState::new(tx, rx);
        let notification = ServerNotification::ItemStarted(ItemStartedNotification {
            item: tool_item("call_123"),
            thread_id: "thread_1".to_string(),
            turn_id: "turn_1".to_string(),
        });

        assert!(state.should_enqueue_notification(&notification));
        assert!(!state.should_enqueue_notification(&notification));
    }

    #[test]
    fn suppresses_exact_duplicate_item_completed_notification() {
        let (tx, rx) = unbounded();
        let mut state = RuntimeState::new(tx, rx);
        let notification = ServerNotification::ItemCompleted(ItemCompletedNotification {
            item: ThreadItem::DynamicToolCall {
                id: "call_123".to_string(),
                tool: "browser__inspect_storage".to_string(),
                arguments: serde_json::json!({"scope":"page"}),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![]),
                success: Some(true),
                duration_ms: Some(42),
            },
            thread_id: "thread_1".to_string(),
            turn_id: "turn_1".to_string(),
        });

        assert!(state.should_enqueue_notification(&notification));
        assert!(!state.should_enqueue_notification(&notification));
    }

    #[test]
    fn keeps_distinct_tool_notifications() {
        let (tx, rx) = unbounded();
        let mut state = RuntimeState::new(tx, rx);
        let first = ServerNotification::ItemStarted(ItemStartedNotification {
            item: tool_item("call_123"),
            thread_id: "thread_1".to_string(),
            turn_id: "turn_1".to_string(),
        });
        let second = ServerNotification::ItemStarted(ItemStartedNotification {
            item: tool_item("call_456"),
            thread_id: "thread_1".to_string(),
            turn_id: "turn_1".to_string(),
        });

        assert_eq!(
            vec![
                state.should_enqueue_notification(&first),
                state.should_enqueue_notification(&second),
            ],
            vec![true, true]
        );
    }
}
