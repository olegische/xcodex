use super::parse_arguments;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolPayload;
use codex_protocol::config_types::ModeKind;
use codex_protocol::config_types::TUI_VISIBLE_COLLABORATION_MODES;
use codex_protocol::plan_tool::UpdatePlanArgs;
use codex_protocol::protocol::EventMsg;
use codex_protocol::request_user_input::RequestUserInputArgs;
use std::sync::Arc;

pub(super) async fn handle_update_plan(
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    payload: ToolPayload,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let arguments = match payload {
        ToolPayload::Function { arguments } => arguments,
        _ => {
            return Err(FunctionCallError::RespondToModel(
                "update_plan handler received unsupported payload".to_string(),
            ));
        }
    };
    if turn.collaboration_mode.mode == ModeKind::Plan {
        return Err(FunctionCallError::RespondToModel(
            "update_plan is a TODO/checklist tool and is not allowed in Plan mode".to_string(),
        ));
    }

    let args: UpdatePlanArgs = parse_arguments(&arguments)?;
    session
        .send_event(turn.as_ref(), EventMsg::PlanUpdate(args))
        .await;
    Ok(FunctionToolOutput::from_text(
        "Plan updated".to_string(),
        Some(true),
    ))
}

pub(super) async fn handle_request_user_input(
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    call_id: String,
    payload: ToolPayload,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let arguments = match payload {
        ToolPayload::Function { arguments } => arguments,
        _ => {
            return Err(FunctionCallError::RespondToModel(
                "request_user_input handler received unsupported payload".to_string(),
            ));
        }
    };

    let mode = session.collaboration_mode().await.mode;
    if let Some(message) = request_user_input_unavailable_message(
        mode,
        turn.tools_config.default_mode_request_user_input,
    ) {
        return Err(FunctionCallError::RespondToModel(message));
    }

    let mut args: RequestUserInputArgs = parse_arguments(&arguments)?;
    let missing_options = args
        .questions
        .iter()
        .any(|question| question.options.as_ref().is_none_or(Vec::is_empty));
    if missing_options {
        return Err(FunctionCallError::RespondToModel(
            "request_user_input requires non-empty options for every question".to_string(),
        ));
    }
    for question in &mut args.questions {
        question.is_other = true;
    }

    let response = session
        .request_user_input(turn.as_ref(), call_id, args)
        .await
        .ok_or_else(|| {
            FunctionCallError::RespondToModel(
                "request_user_input was cancelled before receiving a response".to_string(),
            )
        })?;
    let content = serde_json::to_string(&response).map_err(|err| {
        FunctionCallError::Fatal(format!(
            "failed to serialize request_user_input response: {err}"
        ))
    })?;

    Ok(FunctionToolOutput::from_text(content, Some(true)))
}

fn request_user_input_is_available(mode: ModeKind, default_mode_request_user_input: bool) -> bool {
    mode.allows_request_user_input()
        || (default_mode_request_user_input && mode == ModeKind::Default)
}

fn format_allowed_modes(default_mode_request_user_input: bool) -> String {
    let mode_names: Vec<&str> = TUI_VISIBLE_COLLABORATION_MODES
        .into_iter()
        .filter(|mode| request_user_input_is_available(*mode, default_mode_request_user_input))
        .map(ModeKind::display_name)
        .collect();

    match mode_names.as_slice() {
        [] => "no modes".to_string(),
        [mode] => format!("{mode} mode"),
        [first, second] => format!("{first} or {second} mode"),
        [..] => format!("modes: {}", mode_names.join(",")),
    }
}

pub(crate) fn request_user_input_tool_description(default_mode_request_user_input: bool) -> String {
    let allowed_modes = format_allowed_modes(default_mode_request_user_input);
    format!(
        "Request user input for one to three short questions and wait for the response. This tool is only available in {allowed_modes}."
    )
}

fn request_user_input_unavailable_message(
    mode: ModeKind,
    default_mode_request_user_input: bool,
) -> Option<String> {
    if request_user_input_is_available(mode, default_mode_request_user_input) {
        None
    } else {
        let mode_name = mode.display_name();
        Some(format!(
            "request_user_input is unavailable in {mode_name} mode"
        ))
    }
}
