use std::sync::Arc;

use async_trait::async_trait;
use codex_protocol::user_input::UserInput;
use tokio_util::sync::CancellationToken;

use crate::codex::Session;
use crate::codex::TurnContext;
use crate::state::TaskKind;

use super::SessionTask;
use super::SessionTaskContext;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Default)]
pub(crate) enum UserShellCommandMode {
    #[default]
    StandaloneTurn,
    ActiveTurnAuxiliary,
}

#[derive(Clone, Debug)]
pub(crate) struct UserShellCommandTask {
    command: String,
}

impl UserShellCommandTask {
    pub(crate) fn new(command: String) -> Self {
        Self { command }
    }

    pub(crate) fn command(&self) -> &str {
        &self.command
    }
}

pub(crate) async fn execute_user_shell_command(
    _session: Arc<Session>,
    _turn_context: Arc<TurnContext>,
    _command: String,
    _cancellation_token: CancellationToken,
    _mode: UserShellCommandMode,
) {
}

#[async_trait]
impl SessionTask for UserShellCommandTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }

    fn span_name(&self) -> &'static str {
        "session_task.user_shell"
    }

    async fn run(
        self: Arc<Self>,
        session: Arc<SessionTaskContext>,
        turn_context: Arc<TurnContext>,
        _input: Vec<UserInput>,
        cancellation_token: CancellationToken,
    ) -> Option<String> {
        execute_user_shell_command(
            session.clone_session(),
            turn_context,
            self.command.clone(),
            cancellation_token,
            UserShellCommandMode::StandaloneTurn,
        )
        .await;
        None
    }
}
