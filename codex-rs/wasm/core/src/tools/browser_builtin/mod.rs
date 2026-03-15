mod apply_patch;
mod collaboration;
mod grep_files;
mod list_dir;
mod read_file;

use crate::client_common::tools::FreeformTool;
use crate::client_common::tools::FreeformToolFormat;
use crate::client_common::tools::ResponsesApiTool;
use crate::client_common::tools::ToolSpec as ClientToolSpec;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::tools::browser_host::HostError;
use crate::tools::browser_host::HostErrorCode;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolCall;
use crate::tools::spec::BrowserBuiltinTool;
use crate::tools::spec::ToolsConfig;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;

pub(crate) async fn dispatch_builtin_tool_call(
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    call: ToolCall,
) -> Result<Option<FunctionToolOutput>, FunctionCallError> {
    let output = match call.tool_name.as_str() {
        "read_file" => Some(read_file::handle(session, turn, call.payload).await?),
        "list_dir" => Some(list_dir::handle(session, turn, call.payload).await?),
        "grep_files" => Some(grep_files::handle(session, turn, call.payload).await?),
        "apply_patch" => Some(apply_patch::handle(session, turn, call.payload).await?),
        "update_plan" => {
            Some(collaboration::handle_update_plan(session, turn, call.payload).await?)
        }
        "request_user_input" => Some(
            collaboration::handle_request_user_input(session, turn, call.call_id, call.payload)
                .await?,
        ),
        _ => None,
    };
    Ok(output)
}

pub(crate) fn builtin_tool_specs(config: &ToolsConfig) -> Vec<ClientToolSpec> {
    let mut tools = vec![
        BrowserBuiltinTool::ReadFile,
        BrowserBuiltinTool::ListDir,
        BrowserBuiltinTool::GrepFiles,
        BrowserBuiltinTool::ApplyPatch,
        BrowserBuiltinTool::UpdatePlan,
    ];
    if config.request_user_input {
        tools.push(BrowserBuiltinTool::RequestUserInput);
    }
    tools
        .into_iter()
        .map(|tool| client_tool_spec(tool, config))
        .collect()
}

pub(crate) fn parse_arguments<T>(arguments: &str) -> Result<T, FunctionCallError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_str(arguments).map_err(|err| {
        FunctionCallError::RespondToModel(format!("failed to parse function arguments: {err}"))
    })
}

pub(crate) fn host_error_to_function_call_error(error: HostError) -> FunctionCallError {
    match error.code {
        HostErrorCode::Internal => FunctionCallError::Fatal(error.message),
        HostErrorCode::NotFound
        | HostErrorCode::PermissionDenied
        | HostErrorCode::InvalidInput
        | HostErrorCode::Conflict
        | HostErrorCode::RateLimited
        | HostErrorCode::Timeout
        | HostErrorCode::Unavailable => FunctionCallError::RespondToModel(error.message),
    }
}

pub(crate) fn collect_apply_patch_paths(patch: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    for line in patch.lines() {
        let candidate = line
            .strip_prefix("*** Update File: ")
            .or_else(|| line.strip_prefix("*** Add File: "))
            .or_else(|| line.strip_prefix("*** Delete File: "))
            .map(str::trim)
            .map(str::to_string)
            .or_else(|| {
                line.strip_prefix("+++ ")
                    .map(str::trim)
                    .filter(|path| *path != "/dev/null")
                    .map(|path| {
                        path.strip_prefix("b/")
                            .or_else(|| path.strip_prefix("a/"))
                            .unwrap_or(path)
                            .to_string()
                    })
            });

        if let Some(path) = candidate
            && seen.insert(path.clone())
        {
            paths.push(path);
        }
    }

    paths
}

pub(crate) use collaboration::request_user_input_tool_description;

fn client_tool_spec(tool: BrowserBuiltinTool, config: &ToolsConfig) -> ClientToolSpec {
    let spec = tool.spec();
    match tool {
        BrowserBuiltinTool::ApplyPatch => ClientToolSpec::Freeform(FreeformTool {
            name: spec.tool_name,
            description: spec.description,
            format: FreeformToolFormat {
                r#type: "grammar".to_string(),
                syntax: "lark".to_string(),
                definition:
                    "start: begin_patch hunk+ end_patch\nbegin_patch: \"*** Begin Patch\" LF\nend_patch: \"*** End Patch\" LF?\n\nhunk: add_hunk | delete_hunk | update_hunk\nadd_hunk: \"*** Add File: \" filename LF add_line+\ndelete_hunk: \"*** Delete File: \" filename LF\nupdate_hunk: \"*** Update File: \" filename LF change_move? change?\n\nfilename: /(.+)/\nadd_line: \"+\" /(.*)/ LF -> line\n\nchange_move: \"*** Move to: \" filename LF\nchange: (change_context | change_line)+ eof_line?\nchange_context: (\"@@\" | \"@@ \" /(.+)/) LF\nchange_line: (\"+\" | \"-\" | \" \") /(.*)/ LF\neof_line: \"*** End of File\" LF\n\n%import common.LF\n".to_string(),
            },
        }),
        _ => ClientToolSpec::Function(ResponsesApiTool {
            name: spec.tool_name,
            description: match tool {
                BrowserBuiltinTool::RequestUserInput => {
                    request_user_input_tool_description(config.default_mode_request_user_input)
                }
                _ => spec.description,
            },
            strict: false,
            defer_loading: None,
            parameters: spec.input_schema,
            output_schema: None,
        }),
    }
}
