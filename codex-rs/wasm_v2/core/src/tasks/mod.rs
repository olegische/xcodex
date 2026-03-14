mod regular;

use crate::codex::Session;
use crate::codex::TurnContext;
use crate::state::ActiveTurn;
use crate::state::TaskKind;
use codex_protocol::models::ResponseInputItem;

pub use regular::RegularTask;

#[derive(Clone)]
pub struct SessionTaskContext {
    session: std::sync::Arc<std::sync::Mutex<Session>>,
}

impl SessionTaskContext {
    pub fn new(session: std::sync::Arc<std::sync::Mutex<Session>>) -> Self {
        Self { session }
    }

    pub fn clone_session(&self) -> std::sync::Arc<std::sync::Mutex<Session>> {
        std::sync::Arc::clone(&self.session)
    }
}

pub trait SessionTask {
    fn kind(&self) -> TaskKind;

    fn run(
        &self,
        session: &mut Session,
        ctx: &TurnContext,
        input: Vec<ResponseInputItem>,
        turn: &mut ActiveTurn,
    ) -> Result<Option<String>, String>;
}
