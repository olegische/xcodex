use crate::codex::Session;
use crate::codex::TurnContext;
use crate::codex::run_turn;
use crate::state::ActiveTurn;
use crate::state::TaskKind;
use crate::tasks::SessionTask;
use codex_protocol::models::ResponseInputItem;

#[derive(Clone, Copy, Default)]
pub struct RegularTask;

impl SessionTask for RegularTask {
    fn kind(&self) -> TaskKind {
        TaskKind::Regular
    }

    fn run(
        &self,
        session: &mut Session,
        ctx: &TurnContext,
        input: Vec<ResponseInputItem>,
        turn: &mut ActiveTurn,
    ) -> Result<Option<String>, String> {
        run_turn(session, ctx, input, turn)
    }
}
