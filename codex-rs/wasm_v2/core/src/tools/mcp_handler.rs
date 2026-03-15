use crate::client_common::tools::ResponsesApiTool;
use crate::client_common::tools::ToolSpec as ClientToolSpec;
use crate::compat::rmcp::Tool;
use crate::function_tool::FunctionCallError;
use crate::tools::context::ToolPayload;
use codex_protocol::mcp::CallToolResult;
use serde_json::Value;
use std::collections::HashMap;

pub(crate) fn mcp_tool_specs(mcp_tools: &HashMap<String, Tool>) -> Vec<ClientToolSpec> {
    let mut entries = mcp_tools.iter().collect::<Vec<_>>();
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    entries
        .into_iter()
        .map(|(name, tool)| {
            ClientToolSpec::Function(ResponsesApiTool {
                name: name.clone(),
                description: tool.description.clone().unwrap_or_default().to_string(),
                strict: false,
                defer_loading: None,
                parameters: Value::Object((*tool.input_schema).clone()),
                output_schema: tool
                    .output_schema
                    .as_ref()
                    .map(|schema| Value::Object((**schema).clone())),
            })
        })
        .collect()
}

pub(crate) async fn handle_mcp_tool_call(
    session: &crate::codex::Session,
    payload: ToolPayload,
) -> Result<CallToolResult, FunctionCallError> {
    let (server, tool, raw_arguments) = match payload {
        ToolPayload::Mcp {
            server,
            tool,
            raw_arguments,
        } => (server, tool, raw_arguments),
        _ => {
            return Err(FunctionCallError::RespondToModel(
                "mcp handler received unsupported payload".to_string(),
            ));
        }
    };

    let arguments = if raw_arguments.trim().is_empty() {
        None
    } else {
        Some(
            serde_json::from_str::<Value>(&raw_arguments).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse tool call arguments: {err}"
                ))
            })?,
        )
    };

    Ok(session
        .call_tool(&server, &tool, arguments)
        .await
        .unwrap_or_else(|err| CallToolResult::from_error_text(format!("tool call error: {err:#}"))))
}
