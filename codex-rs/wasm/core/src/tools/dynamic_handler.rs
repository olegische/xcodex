use crate::client_common::tools::ResponsesApiTool;
use crate::client_common::tools::ToolSpec as ClientToolSpec;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolPayload;
use codex_protocol::dynamic_tools::DynamicToolCallRequest;
use codex_protocol::dynamic_tools::DynamicToolResponse;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use codex_protocol::models::FunctionCallOutputContentItem;
use codex_protocol::protocol::DynamicToolCallResponseEvent;
use codex_protocol::protocol::EventMsg;
use serde_json::Value;
use tokio::sync::oneshot;
use tracing::warn;

use crate::time::Instant;

pub(crate) fn dynamic_tool_specs(dynamic_tools: &[DynamicToolSpec]) -> Vec<ClientToolSpec> {
    dynamic_tools
        .iter()
        .map(|tool| {
            ClientToolSpec::Function(ResponsesApiTool {
                name: tool.name.clone(),
                description: tool.description.clone(),
                strict: false,
                defer_loading: None,
                parameters: tool.input_schema.clone(),
                output_schema: None,
            })
        })
        .collect()
}

pub(crate) async fn handle_dynamic_tool_call(
    session: &Session,
    turn_context: &TurnContext,
    call_id: String,
    tool_name: String,
    payload: ToolPayload,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let arguments = match payload {
        ToolPayload::Function { arguments } => arguments,
        _ => {
            return Err(FunctionCallError::RespondToModel(
                "dynamic tool handler received unsupported payload".to_string(),
            ));
        }
    };

    let args: Value = serde_json::from_str(&arguments).map_err(|err| {
        FunctionCallError::RespondToModel(format!("failed to parse function arguments: {err}"))
    })?;
    let response = request_dynamic_tool(session, turn_context, call_id, tool_name, args)
        .await
        .ok_or_else(|| {
            FunctionCallError::RespondToModel(
                "dynamic tool call was cancelled before receiving a response".to_string(),
            )
        })?;

    let DynamicToolResponse {
        content_items,
        success,
    } = response;
    let body = content_items
        .into_iter()
        .map(FunctionCallOutputContentItem::from)
        .collect::<Vec<_>>();
    Ok(FunctionToolOutput {
        body,
        success: Some(success),
    })
}

async fn request_dynamic_tool(
    session: &Session,
    turn_context: &TurnContext,
    call_id: String,
    tool: String,
    arguments: Value,
) -> Option<DynamicToolResponse> {
    let turn_id = turn_context.sub_id.clone();
    let (tx_response, rx_response) = oneshot::channel();
    let event_id = call_id.clone();
    let prev_entry = {
        let mut active = session.active_turn.lock().await;
        match active.as_mut() {
            Some(at) => {
                let mut ts = at.turn_state.lock().await;
                ts.insert_pending_dynamic_tool(call_id.clone(), tx_response)
            }
            None => None,
        }
    };
    if prev_entry.is_some() {
        warn!("Overwriting existing pending dynamic tool call for call_id: {event_id}");
    }

    let started_at = Instant::now();
    session
        .send_event(
            turn_context,
            EventMsg::DynamicToolCallRequest(DynamicToolCallRequest {
                call_id: call_id.clone(),
                turn_id: turn_id.clone(),
                tool: tool.clone(),
                arguments: arguments.clone(),
            }),
        )
        .await;
    let response = rx_response.await.ok();

    let response_event = match &response {
        Some(response) => EventMsg::DynamicToolCallResponse(DynamicToolCallResponseEvent {
            call_id,
            turn_id,
            tool,
            arguments,
            content_items: response.content_items.clone(),
            success: response.success,
            error: None,
            duration: started_at.elapsed(),
        }),
        None => EventMsg::DynamicToolCallResponse(DynamicToolCallResponseEvent {
            call_id,
            turn_id,
            tool,
            arguments,
            content_items: Vec::new(),
            success: false,
            error: Some("dynamic tool call was cancelled before receiving a response".to_string()),
            duration: started_at.elapsed(),
        }),
    };
    session.send_event(turn_context, response_event).await;

    response
}
