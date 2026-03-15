use std::sync::Arc;

use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;

/// Mirror-track subset of upstream `app-server::outgoing_message::ConnectionId`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ConnectionId(pub u64);

/// Mirror-track subset of upstream `app-server::outgoing_message::ConnectionRequestId`.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ConnectionRequestId {
    pub connection_id: ConnectionId,
    pub request_id: RequestId,
}

/// Browser-safe placeholder for upstream `OutgoingMessageSender`.
///
/// The native app-server routes messages across sockets/stdio/in-process
/// channels. The browser mirror only needs deterministic accumulation of
/// protocol notifications for now.
#[derive(Default)]
pub struct OutgoingMessageSender {
    notifications: Vec<ServerNotification>,
}

impl OutgoingMessageSender {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn send_server_notification(&mut self, notification: ServerNotification) {
        self.notifications.push(notification);
    }

    pub fn take_notifications(&mut self) -> Vec<ServerNotification> {
        std::mem::take(&mut self.notifications)
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
}
