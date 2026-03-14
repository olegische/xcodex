use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::RolloutItem;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum EventPersistenceMode {
    #[default]
    Limited,
    Extended,
}

#[inline]
pub(crate) fn is_persisted_response_item(item: &RolloutItem, mode: EventPersistenceMode) -> bool {
    match item {
        RolloutItem::ResponseItem(item) => should_persist_response_item(item),
        RolloutItem::EventMsg(ev) => should_persist_event_msg(ev, mode),
        RolloutItem::Compacted(_) | RolloutItem::TurnContext(_) | RolloutItem::SessionMeta(_) => {
            true
        }
    }
}

#[inline]
pub(crate) fn should_persist_response_item(item: &ResponseItem) -> bool {
    match item {
        ResponseItem::Message { .. }
        | ResponseItem::Reasoning { .. }
        | ResponseItem::LocalShellCall { .. }
        | ResponseItem::FunctionCall { .. }
        | ResponseItem::ToolSearchCall { .. }
        | ResponseItem::FunctionCallOutput { .. }
        | ResponseItem::ToolSearchOutput { .. }
        | ResponseItem::CustomToolCall { .. }
        | ResponseItem::CustomToolCallOutput { .. }
        | ResponseItem::WebSearchCall { .. }
        | ResponseItem::ImageGenerationCall { .. }
        | ResponseItem::GhostSnapshot { .. }
        | ResponseItem::Compaction { .. } => true,
        ResponseItem::Other => false,
    }
}

#[inline]
pub(crate) fn should_persist_event_msg(ev: &EventMsg, mode: EventPersistenceMode) -> bool {
    match mode {
        EventPersistenceMode::Limited => should_persist_event_msg_limited(ev),
        EventPersistenceMode::Extended => {
            should_persist_event_msg_limited(ev) || should_persist_event_msg_extended(ev)
        }
    }
}

fn should_persist_event_msg_limited(ev: &EventMsg) -> bool {
    matches!(
        ev,
        EventMsg::UserMessage(_)
            | EventMsg::AgentMessage(_)
            | EventMsg::AgentReasoning(_)
            | EventMsg::AgentReasoningRawContent(_)
            | EventMsg::TokenCount(_)
            | EventMsg::ContextCompacted(_)
            | EventMsg::EnteredReviewMode(_)
            | EventMsg::ExitedReviewMode(_)
            | EventMsg::ThreadRolledBack(_)
            | EventMsg::UndoCompleted(_)
            | EventMsg::TurnAborted(_)
            | EventMsg::TurnStarted(_)
            | EventMsg::TurnComplete(_)
    )
}

fn should_persist_event_msg_extended(ev: &EventMsg) -> bool {
    matches!(
        ev,
        EventMsg::Error(_)
            | EventMsg::WebSearchEnd(_)
            | EventMsg::ExecCommandEnd(_)
            | EventMsg::PatchApplyEnd(_)
            | EventMsg::McpToolCallEnd(_)
            | EventMsg::ViewImageToolCall(_)
            | EventMsg::ImageGenerationEnd(_)
            | EventMsg::CollabAgentSpawnEnd(_)
            | EventMsg::CollabAgentInteractionEnd(_)
            | EventMsg::CollabWaitingEnd(_)
            | EventMsg::CollabCloseEnd(_)
            | EventMsg::CollabResumeEnd(_)
            | EventMsg::DynamicToolCallRequest(_)
            | EventMsg::DynamicToolCallResponse(_)
    )
}
