use crate::host::SessionSnapshot;
use serde_json::Value;

/// Session-scoped state for the WASM mirror runtime.
pub(crate) struct SessionState {
    snapshot: SessionSnapshot,
}

impl SessionState {
    pub(crate) fn new(snapshot: SessionSnapshot) -> Self {
        Self { snapshot }
    }

    pub(crate) fn snapshot(&self) -> &SessionSnapshot {
        &self.snapshot
    }

    pub(crate) fn thread_id(&self) -> &str {
        &self.snapshot.thread_id
    }

    pub(crate) fn item_count(&self) -> usize {
        self.snapshot.items.len()
    }

    pub(crate) fn into_snapshot(self) -> SessionSnapshot {
        self.snapshot
    }

    pub(crate) fn push_item(&mut self, item: Value) {
        self.snapshot.items.push(item);
    }
}
