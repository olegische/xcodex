use std::sync::Mutex;

use crate::client::ModelClient;
use crate::client::ModelClientSession;
use crate::client_common::Prompt;
use crate::state::TaskKind;
use crate::tasks::SessionTask;
use async_trait::async_trait;
use codex_protocol::user_input::UserInput;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub struct RegularTask {
    prewarmed_session: Mutex<Option<ModelClientSession>>,
}

impl Default for RegularTask {
    fn default() -> Self {
        Self {
            prewarmed_session: Mutex::new(None),
        }
    }
}

impl RegularTask {
    pub(crate) async fn with_startup_prewarm(
        _model_client: ModelClient,
        _prompt: Prompt,
        _turn_context: Arc<crate::codex::TurnContext>,
        _turn_metadata_header: Option<String>,
    ) -> crate::error::Result<Self> {
        Ok(Self::default())
    }
}

#[async_trait]
impl SessionTask for RegularTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }

    fn span_name(&self) -> &'static str {
        "session_task.regular"
    }

    async fn run(
        self: Arc<Self>,
        _session: Arc<crate::tasks::SessionTaskContext>,
        _ctx: Arc<crate::codex::TurnContext>,
        _input: Vec<UserInput>,
        _cancellation_token: CancellationToken,
    ) -> Option<String> {
        let _ = self;
        None
    }
}
