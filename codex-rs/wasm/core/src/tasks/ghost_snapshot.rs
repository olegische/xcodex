use std::sync::Arc;

use async_trait::async_trait;
use codex_protocol::user_input::UserInput;
use codex_utils_readiness::Readiness;
use codex_utils_readiness::Token;
use tokio_util::sync::CancellationToken;
use tracing::info;
use tracing::warn;

use super::SessionTask;
use super::SessionTaskContext;
use crate::codex::TurnContext;
use crate::state::TaskKind;

#[derive(Debug)]
pub(crate) struct GhostSnapshotTask {
    token: Token,
}

impl GhostSnapshotTask {
    pub(crate) fn new(token: Token) -> Self {
        Self { token }
    }
}

#[async_trait]
impl SessionTask for GhostSnapshotTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }

    fn span_name(&self) -> &'static str {
        "session_task.ghost_snapshot"
    }

    async fn run(
        self: Arc<Self>,
        _session: Arc<SessionTaskContext>,
        ctx: Arc<TurnContext>,
        _input: Vec<UserInput>,
        _cancellation_token: CancellationToken,
    ) -> Option<String> {
        match ctx.tool_call_gate.mark_ready(self.token).await {
            Ok(true) => info!("browser ghost snapshot task marked tool gate ready"),
            Ok(false) => warn!("browser ghost snapshot task found tool gate already ready"),
            Err(err) => warn!("browser ghost snapshot task failed to mark tool gate ready: {err}"),
        }
        None
    }
}
