use super::collect_apply_patch_paths;
use super::host_error_to_function_call_error;
use super::parse_arguments;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::tools::browser_host::ApplyPatchRequest;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolPayload;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
struct ApplyPatchJsonArgs {
    input: String,
}

pub(super) async fn handle(
    session: Arc<Session>,
    _turn: Arc<TurnContext>,
    payload: ToolPayload,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let patch = match payload {
        ToolPayload::Function { arguments } => {
            let args: ApplyPatchJsonArgs = parse_arguments(&arguments)?;
            args.input
        }
        ToolPayload::Custom { input } => input,
        _ => {
            return Err(FunctionCallError::RespondToModel(
                "apply_patch handler received unsupported payload".to_string(),
            ));
        }
    };

    let response = session
        .services
        .browser_fs
        .apply_patch(ApplyPatchRequest {
            patch: patch.clone(),
        })
        .await
        .map_err(host_error_to_function_call_error)?;

    let body = if response.files_changed.is_empty() {
        let inferred_paths = collect_apply_patch_paths(&patch);
        if inferred_paths.is_empty() {
            "Patch applied".to_string()
        } else {
            let mut lines = vec!["Patch applied to:".to_string()];
            lines.extend(inferred_paths);
            lines.join("\n")
        }
    } else {
        let mut lines = vec!["Patch applied to:".to_string()];
        lines.extend(response.files_changed);
        lines.join("\n")
    };

    Ok(FunctionToolOutput::from_text(body, Some(true)))
}
