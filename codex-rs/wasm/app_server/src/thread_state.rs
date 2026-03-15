use std::collections::HashSet;

use codex_app_server_protocol::ThreadItem;
use codex_app_server_protocol::Turn;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStatus;

#[derive(Default, Clone)]
pub struct TurnSummary {
    pub file_change_started: HashSet<String>,
    pub command_execution_started: HashSet<String>,
    pub last_error: Option<TurnError>,
}

#[derive(Default, Clone)]
pub struct ThreadState {
    pub active_turn_id: Option<String>,
    pub turn_summary: TurnSummary,
    pub current_turn_items: Vec<ThreadItem>,
}

impl ThreadState {
    pub fn reset_current_turn(&mut self) {
        self.active_turn_id = None;
        self.turn_summary = TurnSummary::default();
        self.current_turn_items.clear();
    }

    pub fn start_turn(&mut self, turn_id: String) {
        self.active_turn_id = Some(turn_id);
        self.turn_summary = TurnSummary::default();
        self.current_turn_items.clear();
    }

    pub fn active_turn_snapshot(&self, status: TurnStatus) -> Option<Turn> {
        self.active_turn_id.as_ref().map(|turn_id| Turn {
            id: turn_id.clone(),
            items: self.current_turn_items.clone(),
            error: self.turn_summary.last_error.clone(),
            status,
        })
    }
}
