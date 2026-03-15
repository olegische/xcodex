use codex_protocol::items::TurnItem;

use crate::codex::TurnContext;

#[derive(Debug, Default)]
pub struct TurnTimingState;

impl TurnTimingState {
    pub(crate) async fn mark_turn_started(&self, _started_at: crate::time::Instant) {}
}

pub async fn record_turn_ttfm_metric(_turn_context: &TurnContext, _item: &TurnItem) {}

pub async fn record_turn_ttft_metric<T>(_turn_context: &TurnContext, _event: &T) {}
