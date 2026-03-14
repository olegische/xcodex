use codex_protocol::models::ResponseItem;

/// Transcript/history manager for the mirror-track runtime.
#[derive(Clone, Default)]
pub struct ContextManager {
    items: Vec<ResponseItem>,
}

impl ContextManager {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    pub fn record_items<I>(&mut self, items: I)
    where
        I: IntoIterator<Item = ResponseItem>,
    {
        self.items.extend(items);
    }

    pub fn raw_items(&self) -> &[ResponseItem] {
        &self.items
    }

    pub fn replace(&mut self, items: Vec<ResponseItem>) {
        self.items = items;
    }
}
