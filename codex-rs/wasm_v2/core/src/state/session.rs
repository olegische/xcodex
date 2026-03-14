use crate::context_manager::ContextManager;
use codex_protocol::models::ResponseItem;

/// Session-wide mutable state for the mirrored WASM runtime.
#[derive(Default)]
pub struct SessionState {
    pub history: ContextManager,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            history: ContextManager::new(),
        }
    }

    pub fn record_items<I>(&mut self, items: I)
    where
        I: IntoIterator<Item = ResponseItem>,
    {
        self.history.record_items(items);
    }

    pub fn raw_items(&self) -> &[ResponseItem] {
        self.history.raw_items()
    }
}
