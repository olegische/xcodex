use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::sync::Arc;

use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;

use crate::in_process::PendingServerRequest;

/// Mirror-track subset of upstream `app-server::outgoing_message::ConnectionId`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ConnectionId(pub u64);

/// Mirror-track subset of upstream `app-server::outgoing_message::ConnectionRequestId`.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ConnectionRequestId {
    pub connection_id: ConnectionId,
    pub request_id: RequestId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PendingServerRequestRecord {
    pub pending: PendingServerRequest,
    pub request: ServerRequest,
}

/// Browser-safe outbound state for protocol notifications and server requests.
///
/// Unlike native app-server, this mirror does not route across sockets or stdio.
/// It instead keeps deterministic in-memory queues so the browser host can
/// drain notifications and server requests explicitly.
#[derive(Default)]
pub struct OutgoingMessageSender {
    notifications: VecDeque<ServerNotification>,
    server_requests: VecDeque<ServerRequest>,
    pending_server_requests: BTreeMap<RequestId, PendingServerRequestRecord>,
}

impl OutgoingMessageSender {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn send_server_notification(&mut self, notification: ServerNotification) {
        self.notifications.push_back(notification);
    }

    pub fn send_server_request(&mut self, pending: PendingServerRequest, request: ServerRequest) {
        self.pending_server_requests.insert(
            request.id().clone(),
            PendingServerRequestRecord {
                pending,
                request: request.clone(),
            },
        );
        self.server_requests.push_back(request);
    }

    pub fn take_notifications(&mut self) -> Vec<ServerNotification> {
        self.notifications.drain(..).collect()
    }

    pub fn take_server_requests(&mut self) -> Vec<ServerRequest> {
        self.server_requests.drain(..).collect()
    }

    pub fn pending_server_requests(&self) -> Vec<ServerRequest> {
        self.pending_server_requests
            .values()
            .map(|entry| entry.request.clone())
            .collect()
    }

    pub fn resolve_pending_server_request(
        &mut self,
        request_id: &RequestId,
    ) -> Option<PendingServerRequestRecord> {
        self.pending_server_requests.remove(request_id)
    }
}

/// Mirror-track subset of upstream `ThreadScopedOutgoingMessageSender`.
#[derive(Clone)]
pub struct ThreadScopedOutgoingMessageSender {
    outgoing: Arc<std::sync::Mutex<OutgoingMessageSender>>,
}

impl ThreadScopedOutgoingMessageSender {
    pub fn new(outgoing: Arc<std::sync::Mutex<OutgoingMessageSender>>) -> Self {
        Self { outgoing }
    }

    pub fn send_server_notification(&self, notification: ServerNotification) {
        if let Ok(mut outgoing) = self.outgoing.lock() {
            outgoing.send_server_notification(notification);
        }
    }

    pub fn send_server_request(&self, pending: PendingServerRequest, request: ServerRequest) {
        if let Ok(mut outgoing) = self.outgoing.lock() {
            outgoing.send_server_request(pending, request);
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::OutgoingMessageSender;
    use crate::PendingServerRequest;

    #[test]
    fn pending_server_requests_round_trip_in_request_id_order() {
        let mut outgoing = OutgoingMessageSender::new();
        let first = codex_app_server_protocol::ServerRequest::ToolRequestUserInput {
            request_id: codex_app_server_protocol::RequestId::Integer(2),
            params: codex_app_server_protocol::ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-1".to_string(),
                questions: Vec::new(),
            },
        };
        let second = codex_app_server_protocol::ServerRequest::ToolRequestUserInput {
            request_id: codex_app_server_protocol::RequestId::Integer(1),
            params: codex_app_server_protocol::ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-2".to_string(),
                questions: Vec::new(),
            },
        };

        outgoing.send_server_request(
            PendingServerRequest::UserInput {
                thread_id: "thread-1".to_string(),
                id: "item-1".to_string(),
            },
            first.clone(),
        );
        outgoing.send_server_request(
            PendingServerRequest::UserInput {
                thread_id: "thread-1".to_string(),
                id: "item-2".to_string(),
            },
            second.clone(),
        );

        assert_eq!(
            outgoing.take_server_requests(),
            vec![first.clone(), second.clone()]
        );
        assert_eq!(
            outgoing.pending_server_requests(),
            vec![second.clone(), first.clone()]
        );
        assert_eq!(
            outgoing
                .resolve_pending_server_request(&codex_app_server_protocol::RequestId::Integer(1))
                .map(|entry| entry.request),
            Some(second)
        );
        assert_eq!(outgoing.pending_server_requests(), vec![first]);
    }
}
