use std::sync::Arc;

use codex_protocol::models::ResponseItem;

use crate::codex::Session;
use crate::codex::TurnContext;
use crate::compact::InitialContextInjection;
use crate::compact::insert_initial_context_before_last_real_user_or_summary;
use crate::error::Result as CodexResult;

pub(crate) async fn run_inline_remote_auto_compact_task(
    _sess: Arc<Session>,
    _turn_context: Arc<TurnContext>,
    _initial_context_injection: InitialContextInjection,
) -> CodexResult<()> {
    Ok(())
}

pub(crate) async fn process_compacted_history(
    sess: &Session,
    turn_context: &TurnContext,
    compacted_history: Vec<ResponseItem>,
    initial_context_injection: InitialContextInjection,
) -> Vec<ResponseItem> {
    let initial_context = if matches!(
        initial_context_injection,
        InitialContextInjection::BeforeLastUserMessage
    ) {
        sess.build_initial_context(turn_context).await
    } else {
        Vec::new()
    };
    insert_initial_context_before_last_real_user_or_summary(compacted_history, initial_context)
}
