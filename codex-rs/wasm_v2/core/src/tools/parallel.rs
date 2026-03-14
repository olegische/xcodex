use tokio_util::sync::CancellationToken;

use crate::tools::context::ToolOutput;

#[derive(Clone, Debug, Default)]
pub struct ToolCallRuntime;

impl ToolCallRuntime {
    pub fn new(
        _router: std::sync::Arc<crate::tools::router::ToolRouter>,
        _session: std::sync::Arc<crate::codex::Session>,
        _turn: std::sync::Arc<crate::codex::TurnContext>,
        _tracker: crate::tools::context::SharedTurnDiffTracker,
    ) -> Self {
        Self
    }

    pub async fn handle_tool_call(
        &self,
        call: crate::tools::context::ToolCall,
        _cancellation_token: CancellationToken,
    ) -> crate::error::Result<codex_protocol::models::ResponseInputItem> {
        let payload = call.payload.clone();
        Ok(crate::tools::context::FunctionToolOutput::from_text(
            format!("tool {} is not implemented in wasm_v2 yet", call.tool_name),
            Some(false),
        )
        .to_response_item(&call.call_id, &payload))
    }
}
