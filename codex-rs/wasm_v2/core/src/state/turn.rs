use codex_protocol::models::ResponseInputItem;

/// Turn-scoped state for the mirrored WASM runtime.
#[derive(Default)]
pub struct ActiveTurn {
    pending_input: Vec<ResponseInputItem>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskKind {
    Regular,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunningTask {
    pub sub_id: String,
    pub kind: TaskKind,
}

impl ActiveTurn {
    pub fn push_pending_input(&mut self, input: ResponseInputItem) {
        self.pending_input.push(input);
    }

    pub fn take_pending_input(&mut self) -> Vec<ResponseInputItem> {
        std::mem::take(&mut self.pending_input)
    }

    pub fn has_pending_input(&self) -> bool {
        !self.pending_input.is_empty()
    }
}
