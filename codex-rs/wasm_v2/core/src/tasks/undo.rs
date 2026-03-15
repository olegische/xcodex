use std::sync::Arc;

use async_trait::async_trait;
use codex_protocol::user_input::UserInput;
use tokio_util::sync::CancellationToken;

use super::SessionTask;
use super::SessionTaskContext;
use crate::codex::TurnContext;
use crate::protocol::EventMsg;
use crate::protocol::UndoCompletedEvent;
use crate::protocol::UndoStartedEvent;
use crate::state::TaskKind;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct UndoTask;

impl UndoTask {
    pub(crate) fn new() -> Self {
        Self
    }
}

#[async_trait]
impl SessionTask for UndoTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }

    fn span_name(&self) -> &'static str {
        "session_task.undo"
    }

    async fn run(
        self: Arc<Self>,
        session: Arc<SessionTaskContext>,
        ctx: Arc<TurnContext>,
        _input: Vec<UserInput>,
        cancellation_token: CancellationToken,
    ) -> Option<String> {
        let sess = session.clone_session();
        sess.send_event(
            ctx.as_ref(),
            EventMsg::UndoStarted(UndoStartedEvent {
                message: Some("Undo in progress...".to_string()),
            }),
        )
        .await;

        let completed = if cancellation_token.is_cancelled() {
            UndoCompletedEvent {
                success: false,
                message: Some("Undo cancelled.".to_string()),
            }
        } else {
            UndoCompletedEvent {
                success: false,
                message: Some(
                    "Undo is not available in the browser runtime because wasm_v2 does not manage native ghost snapshots."
                        .to_string(),
                ),
            }
        };

        sess.send_event(ctx.as_ref(), EventMsg::UndoCompleted(completed))
            .await;
        None
    }
}
