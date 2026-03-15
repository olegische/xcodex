use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::plan_tool::StepStatus;
use codex_protocol::plan_tool::UpdatePlanArgs;
use codex_protocol::request_user_input::RequestUserInputArgs;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::collections::VecDeque;

use crate::function_tool::FunctionCallError;
use crate::host::ApplyPatchRequest;
use crate::host::HostCollaboration;
use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::HostFs;
use crate::host::HostToolExecutor;
use crate::host::ListDirRequest;
use crate::host::PlanStep;
use crate::host::ReadFileRequest;
use crate::host::RequestUserInputAnswer;
use crate::host::RequestUserInputOption;
use crate::host::RequestUserInputQuestion;
use crate::host::RequestUserInputRequest;
use crate::host::RequestUserInputResponse;
use crate::host::ToolInvokeRequest;
use crate::host::UpdatePlanRequest;
use crate::tool_search::DEFAULT_LIMIT as TOOL_SEARCH_DEFAULT_LIMIT;
use crate::tool_search::ToolSearchArgs;
use crate::tool_search::search_tools;
use crate::tools::router::ToolCall;
use crate::tools::router::ToolCallSource;
use crate::tools::router::ToolOutput;
use crate::tools::router::ToolPayload;
use crate::tools::router::build_tool_call;
use crate::tools::router::last_assistant_message_from_item;
use crate::tools::router::response_input_to_response_item;
use codex_utils_string::take_bytes_at_char_boundary;

const DEFAULT_GREP_LIMIT: usize = 100;
const MAX_GREP_LIMIT: usize = 2000;
const MAX_LINE_LENGTH: usize = 500;
const TAB_WIDTH: usize = 4;
const COMMENT_PREFIXES: &[&str] = &["#", "//", "--"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollaborationMode {
    Default,
    Plan,
}

impl CollaborationMode {
    fn allows_request_user_input(self) -> bool {
        matches!(self, Self::Plan)
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::Plan => "Plan",
        }
    }
}

#[derive(Clone, Copy)]
pub struct WasmToolRuntime<'a> {
    fs: &'a dyn HostFs,
    collaboration: &'a dyn HostCollaboration,
    tool_executor: &'a dyn HostToolExecutor,
    collaboration_mode: CollaborationMode,
    default_mode_request_user_input: bool,
}

#[derive(Default)]
pub struct OutputItemResult {
    pub last_agent_message: Option<String>,
    pub needs_follow_up: bool,
    pub tool_output: Option<ResponseInputItem>,
    pub recorded_response_item: Option<ResponseItem>,
}

impl<'a> WasmToolRuntime<'a> {
    pub fn new(
        fs: &'a dyn HostFs,
        collaboration: &'a dyn HostCollaboration,
        tool_executor: &'a dyn HostToolExecutor,
        collaboration_mode: CollaborationMode,
        default_mode_request_user_input: bool,
    ) -> Self {
        Self {
            fs,
            collaboration,
            tool_executor,
            collaboration_mode,
            default_mode_request_user_input,
        }
    }

    pub async fn handle_output_item_done(
        &self,
        item: ResponseItem,
    ) -> Result<OutputItemResult, FunctionCallError> {
        let mut output = OutputItemResult::default();

        match build_tool_call(item.clone()) {
            Ok(Some(call)) => {
                let response = self
                    .dispatch_tool_call(call, ToolCallSource::Direct)
                    .await?;
                output.needs_follow_up = true;
                output.recorded_response_item = response_input_to_response_item(&response);
                output.tool_output = Some(response);
            }
            Ok(None) => {
                output.last_agent_message = last_assistant_message_from_item(&item);
            }
            Err(message) if message == "LocalShellCall without call_id or id" => {
                let response = ResponseInputItem::FunctionCallOutput {
                    call_id: String::new(),
                    output: FunctionCallOutputPayload {
                        body: FunctionCallOutputBody::Text(message),
                        ..Default::default()
                    },
                };
                output.needs_follow_up = true;
                output.recorded_response_item = response_input_to_response_item(&response);
                output.tool_output = Some(response);
            }
            Err(message) => return Err(FunctionCallError::Fatal(message)),
        }

        Ok(output)
    }

    pub async fn dispatch_tool_call(
        &self,
        call: ToolCall,
        source: ToolCallSource,
    ) -> Result<ResponseInputItem, FunctionCallError> {
        let ToolCall {
            tool_name,
            tool_namespace,
            call_id,
            payload,
        } = call;
        let payload_outputs_custom = matches!(payload, ToolPayload::Custom { .. });
        let failure_call_id = call_id.clone();

        if source == ToolCallSource::JsRepl {
            return Ok(self.failure_response(
                failure_call_id,
                payload_outputs_custom,
                FunctionCallError::RespondToModel(
                    "js_repl tool call source is not implemented in codex-wasm-core".to_string(),
                ),
            ));
        }

        let output = match tool_name.as_str() {
            "read_file" => self.handle_read_file(payload.clone()).await,
            "list_dir" => self.handle_list_dir(payload.clone()).await,
            "grep_files" => self.handle_grep_files(payload.clone()).await,
            "apply_patch" => self.handle_apply_patch(payload.clone()).await,
            "tool_search" => self.handle_tool_search(payload.clone()).await,
            "update_plan" => self.handle_update_plan(payload.clone()).await,
            "request_user_input" => self.handle_request_user_input(payload.clone()).await,
            _ => {
                self.handle_host_tool_call(
                    payload.clone(),
                    &call_id,
                    &tool_name,
                    tool_namespace.as_deref(),
                )
                .await
            }
        };

        match output {
            Ok(output) => Ok(output.into_response(&call_id, &payload)),
            Err(FunctionCallError::Fatal(message)) => Err(FunctionCallError::Fatal(message)),
            Err(err) => Ok(self.failure_response(failure_call_id, payload_outputs_custom, err)),
        }
    }

    fn failure_response(
        &self,
        call_id: String,
        payload_outputs_custom: bool,
        err: FunctionCallError,
    ) -> ResponseInputItem {
        let message = err.to_string();
        if payload_outputs_custom {
            ResponseInputItem::CustomToolCallOutput {
                call_id,
                output: FunctionCallOutputPayload {
                    body: FunctionCallOutputBody::Text(message),
                    success: Some(false),
                },
            }
        } else {
            ResponseInputItem::FunctionCallOutput {
                call_id,
                output: FunctionCallOutputPayload {
                    body: FunctionCallOutputBody::Text(message),
                    success: Some(false),
                },
            }
        }
    }

    async fn handle_read_file(
        &self,
        payload: ToolPayload,
    ) -> Result<ToolOutput, FunctionCallError> {
        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "read_file handler received unsupported payload".to_string(),
                ));
            }
        };
        let args: ReadFileArgs = parse_arguments(&arguments)?;
        if args.offset == 0 {
            return Err(FunctionCallError::RespondToModel(
                "offset must be a 1-indexed line number".to_string(),
            ));
        }
        if args.limit == 0 {
            return Err(FunctionCallError::RespondToModel(
                "limit must be greater than zero".to_string(),
            ));
        }

        let response = self
            .fs
            .read_file(ReadFileRequest {
                path: args.file_path.clone(),
            })
            .await
            .map_err(host_error_to_function_call_error)?;
        let records = collect_file_lines(&response.content);
        let body = match args.mode {
            ReadMode::Slice => {
                let lines = read_slice(&records, args.offset, args.limit)?;
                FunctionCallOutputBody::Text(lines.join("\n"))
            }
            ReadMode::Indentation => {
                let lines = read_indentation_block(
                    &records,
                    args.offset,
                    args.limit,
                    args.indentation.unwrap_or_default(),
                )?;
                FunctionCallOutputBody::Text(lines.join("\n"))
            }
        };

        Ok(ToolOutput::Function {
            body,
            success: Some(true),
        })
    }

    async fn handle_list_dir(&self, payload: ToolPayload) -> Result<ToolOutput, FunctionCallError> {
        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "list_dir handler received unsupported payload".to_string(),
                ));
            }
        };
        let args: ListDirArgs = parse_arguments(&arguments)?;
        if args.offset == 0 {
            return Err(FunctionCallError::RespondToModel(
                "offset must be a 1-indexed entry number".to_string(),
            ));
        }
        if args.limit == 0 {
            return Err(FunctionCallError::RespondToModel(
                "limit must be greater than zero".to_string(),
            ));
        }
        if args.depth == 0 {
            return Err(FunctionCallError::RespondToModel(
                "depth must be greater than zero".to_string(),
            ));
        }

        let response = self
            .fs
            .list_dir(ListDirRequest {
                path: args.dir_path.clone(),
                recursive: args.depth > 1,
            })
            .await
            .map_err(host_error_to_function_call_error)?;
        let mut entries = response
            .entries
            .into_iter()
            .filter_map(|entry| format_list_dir_entry(&args.dir_path, args.depth, entry))
            .collect::<Vec<_>>();
        entries.sort_unstable();

        let start_index = args.offset - 1;
        if start_index >= entries.len() && !entries.is_empty() {
            return Err(FunctionCallError::RespondToModel(
                "offset exceeds directory entry count".to_string(),
            ));
        }

        let mut output = Vec::new();
        output.push(format!("Absolute path: {}", args.dir_path));
        if entries.is_empty() {
            output.extend(Vec::<String>::new());
        } else {
            let remaining_entries = entries.len() - start_index;
            let capped_limit = args.limit.min(remaining_entries);
            let end_index = start_index + capped_limit;
            output.extend(entries[start_index..end_index].iter().cloned());
            if end_index < entries.len() {
                output.push(format!("More than {capped_limit} entries found"));
            }
        }

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text(output.join("\n")),
            success: Some(true),
        })
    }

    async fn handle_grep_files(
        &self,
        payload: ToolPayload,
    ) -> Result<ToolOutput, FunctionCallError> {
        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "grep_files handler received unsupported payload".to_string(),
                ));
            }
        };
        let args: GrepFilesArgs = parse_arguments(&arguments)?;
        let pattern = args.pattern.trim();
        if pattern.is_empty() {
            return Err(FunctionCallError::RespondToModel(
                "pattern must not be empty".to_string(),
            ));
        }
        if args.limit == 0 {
            return Err(FunctionCallError::RespondToModel(
                "limit must be greater than zero".to_string(),
            ));
        }

        let limit = args.limit.min(MAX_GREP_LIMIT);
        let path = args.path.unwrap_or_else(|| "/workspace".to_string());
        let response = self
            .fs
            .list_dir(ListDirRequest {
                path: path.clone(),
                recursive: true,
            })
            .await
            .map_err(host_error_to_function_call_error)?;
        let regex = regex_lite::Regex::new(pattern).map_err(|err| {
            FunctionCallError::RespondToModel(format!("invalid regex pattern: {err}"))
        })?;
        let include = args
            .include
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        let mut matched_paths = Vec::new();
        for entry in response.entries.into_iter().filter(|entry| !entry.is_dir) {
            if !glob_matches(include, &entry.path) {
                continue;
            }
            let file = self
                .fs
                .read_file(ReadFileRequest {
                    path: entry.path.clone(),
                })
                .await
                .map_err(host_error_to_function_call_error)?;
            if regex.is_match(&file.content) {
                matched_paths.push(entry.path);
                if matched_paths.len() == limit {
                    break;
                }
            }
        }

        let success = !matched_paths.is_empty();
        let body = if success {
            matched_paths.join("\n")
        } else {
            "No matches found.".to_string()
        };

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text(body),
            success: Some(success),
        })
    }

    async fn handle_apply_patch(
        &self,
        payload: ToolPayload,
    ) -> Result<ToolOutput, FunctionCallError> {
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
        request_apply_patch_approval(self, &patch).await?;

        let response = self
            .fs
            .apply_patch(ApplyPatchRequest { patch })
            .await
            .map_err(host_error_to_function_call_error)?;

        let body = if response.files_changed.is_empty() {
            "Patch applied".to_string()
        } else {
            let mut lines = vec!["Patch applied to:".to_string()];
            lines.extend(response.files_changed);
            lines.join("\n")
        };

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text(body),
            success: Some(true),
        })
    }

    async fn handle_host_tool_call(
        &self,
        payload: ToolPayload,
        call_id: &str,
        tool_name: &str,
        tool_namespace: Option<&str>,
    ) -> Result<ToolOutput, FunctionCallError> {
        let input = match payload {
            ToolPayload::Function { arguments } => {
                serde_json::from_str(&arguments).map_err(|err| {
                    FunctionCallError::RespondToModel(format!(
                        "failed to parse function arguments: {err}"
                    ))
                })?
            }
            ToolPayload::Custom { input } => Value::String(input),
            ToolPayload::ToolSearch { .. } => {
                return Err(FunctionCallError::RespondToModel(format!(
                    "{tool_name} handler received unsupported payload"
                )));
            }
            ToolPayload::LocalShell { .. } => {
                return Err(FunctionCallError::RespondToModel(
                    "local_shell is not implemented in codex-wasm-core".to_string(),
                ));
            }
        };
        let response = self
            .tool_executor
            .invoke(ToolInvokeRequest {
                call_id: call_id.to_string(),
                tool_name: tool_name.to_string(),
                tool_namespace: tool_namespace.map(ToOwned::to_owned),
                input,
            })
            .await
            .map_err(host_error_to_function_call_error)?;
        let success = !matches!(
            response.output,
            Value::Object(ref output)
                if output.get("isError").and_then(Value::as_bool) == Some(true)
        );

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text(stringify_tool_output(response.output)),
            success: Some(success),
        })
    }

    async fn handle_tool_search(
        &self,
        payload: ToolPayload,
    ) -> Result<ToolOutput, FunctionCallError> {
        let (arguments, execution) = match payload {
            ToolPayload::ToolSearch {
                arguments,
                execution,
            } => (arguments, execution),
            ToolPayload::Function { arguments } => (
                serde_json::from_str::<Value>(&arguments).map_err(|err| {
                    FunctionCallError::RespondToModel(format!(
                        "failed to parse tool_search function arguments: {err}"
                    ))
                })?,
                "client".to_string(),
            ),
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "tool_search handler received unsupported payload".to_string(),
                ));
            }
        };
        let args: ToolSearchArgs = serde_json::from_value(arguments).map_err(|err| {
            FunctionCallError::RespondToModel(format!(
                "failed to parse tool_search arguments: {err}"
            ))
        })?;
        let query = args.query.trim();
        if query.is_empty() {
            return Err(FunctionCallError::RespondToModel(
                "query must not be empty".to_string(),
            ));
        }
        let limit = args.limit.unwrap_or(TOOL_SEARCH_DEFAULT_LIMIT);
        if limit == 0 {
            return Err(FunctionCallError::RespondToModel(
                "limit must be greater than zero".to_string(),
            ));
        }
        let host_tools = self
            .tool_executor
            .list_tools()
            .await
            .map_err(host_error_to_function_call_error)?;
        let tools = search_tools(&host_tools, query, limit).map_err(|err| {
            FunctionCallError::Fatal(format!("failed to encode tool_search output: {err}"))
        })?;

        Ok(ToolOutput::ToolSearch { tools, execution })
    }

    async fn handle_update_plan(
        &self,
        payload: ToolPayload,
    ) -> Result<ToolOutput, FunctionCallError> {
        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "update_plan handler received unsupported payload".to_string(),
                ));
            }
        };
        if self.collaboration_mode == CollaborationMode::Plan {
            return Err(FunctionCallError::RespondToModel(
                "update_plan is a TODO/checklist tool and is not allowed in Plan mode".to_string(),
            ));
        }

        let args = serde_json::from_str::<UpdatePlanArgs>(&arguments).map_err(|err| {
            FunctionCallError::RespondToModel(format!("failed to parse function arguments: {err}"))
        })?;
        let plan = args
            .plan
            .into_iter()
            .map(|item| PlanStep {
                step: item.step,
                status: plan_step_status_to_wire(item.status),
            })
            .collect();
        self.collaboration
            .update_plan(UpdatePlanRequest {
                explanation: args.explanation,
                plan,
            })
            .await
            .map_err(host_error_to_function_call_error)?;

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text("Plan updated".to_string()),
            success: Some(true),
        })
    }

    async fn handle_request_user_input(
        &self,
        payload: ToolPayload,
    ) -> Result<ToolOutput, FunctionCallError> {
        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "request_user_input handler received unsupported payload".to_string(),
                ));
            }
        };

        if let Some(message) = request_user_input_unavailable_message(
            self.collaboration_mode,
            self.default_mode_request_user_input,
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

        let response = self
            .collaboration
            .request_user_input(RequestUserInputRequest {
                questions: args
                    .questions
                    .into_iter()
                    .map(|question| RequestUserInputQuestion {
                        header: question.header,
                        id: question.id,
                        question: question.question,
                        options: question
                            .options
                            .unwrap_or_default()
                            .into_iter()
                            .map(|option| RequestUserInputOption {
                                label: option.label,
                                description: option.description,
                            })
                            .collect(),
                    })
                    .collect(),
            })
            .await
            .map_err(host_error_to_function_call_error)?;

        let content = serde_json::to_string(&request_user_input_response_to_protocol(response))
            .map_err(|err| {
                FunctionCallError::Fatal(format!(
                    "failed to serialize request_user_input response: {err}"
                ))
            })?;

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text(content),
            success: Some(true),
        })
    }
}

#[derive(Deserialize)]
struct GrepFilesArgs {
    pattern: String,
    #[serde(default)]
    include: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default = "default_grep_limit")]
    limit: usize,
}

#[derive(Deserialize)]
struct ApplyPatchJsonArgs {
    input: String,
}

#[derive(Deserialize)]
struct ReadFileArgs {
    file_path: String,
    #[serde(default = "defaults::offset")]
    offset: usize,
    #[serde(default = "defaults::limit")]
    limit: usize,
    #[serde(default)]
    mode: ReadMode,
    #[serde(default)]
    indentation: Option<IndentationArgs>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "snake_case")]
enum ReadMode {
    #[default]
    Slice,
    Indentation,
}

#[derive(Deserialize, Clone)]
struct IndentationArgs {
    #[serde(default)]
    anchor_line: Option<usize>,
    #[serde(default = "defaults::max_levels")]
    max_levels: usize,
    #[serde(default = "defaults::include_siblings")]
    include_siblings: bool,
    #[serde(default = "defaults::include_header")]
    include_header: bool,
    #[serde(default)]
    max_lines: Option<usize>,
}

#[derive(Deserialize)]
struct ListDirArgs {
    dir_path: String,
    #[serde(default = "defaults::offset")]
    offset: usize,
    #[serde(default = "list_dir_defaults::limit")]
    limit: usize,
    #[serde(default = "list_dir_defaults::depth")]
    depth: usize,
}

#[derive(Clone, Debug)]
struct LineRecord {
    number: usize,
    raw: String,
    display: String,
    indent: usize,
}

impl LineRecord {
    fn trimmed(&self) -> &str {
        self.raw.trim_start()
    }

    fn is_blank(&self) -> bool {
        self.trimmed().is_empty()
    }

    fn is_comment(&self) -> bool {
        COMMENT_PREFIXES
            .iter()
            .any(|prefix| self.raw.trim().starts_with(prefix))
    }
}

fn default_grep_limit() -> usize {
    DEFAULT_GREP_LIMIT
}

fn parse_arguments<T>(arguments: &str) -> Result<T, FunctionCallError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_str::<T>(arguments).map_err(|err| {
        FunctionCallError::RespondToModel(format!("failed to parse function arguments: {err}"))
    })
}

fn plan_step_status_to_wire(status: StepStatus) -> String {
    match status {
        StepStatus::Pending => "pending",
        StepStatus::InProgress => "in_progress",
        StepStatus::Completed => "completed",
    }
    .to_string()
}

fn request_user_input_unavailable_message(
    mode: CollaborationMode,
    default_mode_request_user_input: bool,
) -> Option<String> {
    if mode.allows_request_user_input()
        || (default_mode_request_user_input && mode == CollaborationMode::Default)
    {
        None
    } else {
        Some(format!(
            "request_user_input is unavailable in {} mode",
            mode.display_name()
        ))
    }
}

async fn request_apply_patch_approval(
    runtime: &WasmToolRuntime<'_>,
    patch: &str,
) -> Result<(), FunctionCallError> {
    let response = runtime
        .collaboration
        .request_user_input(RequestUserInputRequest {
            questions: vec![RequestUserInputQuestion {
                header: "Apply patch".to_string(),
                id: "approval_decision".to_string(),
                question: build_apply_patch_approval_question(patch),
                options: vec![
                    RequestUserInputOption {
                        label: "Approve".to_string(),
                        description: "Apply this patch to the workspace.".to_string(),
                    },
                    RequestUserInputOption {
                        label: "Reject".to_string(),
                        description: "Block the patch and let Codex adjust the plan.".to_string(),
                    },
                ],
            }],
        })
        .await
        .map_err(host_error_to_function_call_error)?;

    if apply_patch_approval_was_granted(&response) {
        Ok(())
    } else {
        Err(FunctionCallError::RespondToModel(
            "Patch was rejected by the user.".to_string(),
        ))
    }
}

fn build_apply_patch_approval_question(patch: &str) -> String {
    let changed_paths = collect_apply_patch_paths(patch);
    let mut lines = vec!["Codex wants to apply a patch to the workspace.".to_string()];
    if changed_paths.is_empty() {
        lines.push("No file paths could be inferred from the patch text.".to_string());
    } else {
        lines.push("Files:".to_string());
        for path in changed_paths.iter().take(6) {
            lines.push(format!("- {path}"));
        }
        if changed_paths.len() > 6 {
            lines.push(format!("- and {} more", changed_paths.len() - 6));
        }
    }
    lines.push("Approve or reject this patch.".to_string());
    lines.join("\n")
}

fn collect_apply_patch_paths(patch: &str) -> Vec<String> {
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

fn apply_patch_approval_was_granted(response: &RequestUserInputResponse) -> bool {
    response.answers.iter().any(|answer| {
        answer.id == "approval_decision"
            && request_user_input_answer_values(answer.value.clone())
                .iter()
                .any(|value| value.eq_ignore_ascii_case("approve"))
    })
}

fn request_user_input_response_to_protocol(
    response: RequestUserInputResponse,
) -> codex_protocol::request_user_input::RequestUserInputResponse {
    let answers = response
        .answers
        .into_iter()
        .map(|answer| {
            let RequestUserInputAnswer { id, value } = answer;
            let values = request_user_input_answer_values(value);
            (
                id,
                codex_protocol::request_user_input::RequestUserInputAnswer { answers: values },
            )
        })
        .collect();
    codex_protocol::request_user_input::RequestUserInputResponse { answers }
}

fn request_user_input_answer_values(value: Value) -> Vec<String> {
    match value {
        Value::String(value) => vec![value],
        Value::Array(values) => values
            .into_iter()
            .filter_map(|value| match value {
                Value::String(value) => Some(value),
                _ => None,
            })
            .collect(),
        other => vec![other.to_string()],
    }
}

fn host_error_to_function_call_error(error: HostError) -> FunctionCallError {
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

fn stringify_tool_output(output: Value) -> String {
    match output {
        Value::String(text) => text,
        other => serde_json::to_string_pretty(&other)
            .unwrap_or_else(|err| format!("failed to serialize host tool output: {err}")),
    }
}

fn collect_file_lines(content: &str) -> Vec<LineRecord> {
    content
        .split('\n')
        .enumerate()
        .map(|(index, line)| {
            let raw = line.strip_suffix('\r').unwrap_or(line).to_string();
            let indent = measure_indent(&raw);
            let display = format_line(&raw);
            LineRecord {
                number: index + 1,
                raw,
                display,
                indent,
            }
        })
        .collect()
}

fn read_slice(
    lines: &[LineRecord],
    offset: usize,
    limit: usize,
) -> Result<Vec<String>, FunctionCallError> {
    if lines.len() < offset {
        return Err(FunctionCallError::RespondToModel(
            "offset exceeds file length".to_string(),
        ));
    }
    Ok(lines
        .iter()
        .skip(offset - 1)
        .take(limit)
        .map(|record| format!("L{}: {}", record.number, record.display))
        .collect())
}

fn read_indentation_block(
    collected: &[LineRecord],
    offset: usize,
    limit: usize,
    options: IndentationArgs,
) -> Result<Vec<String>, FunctionCallError> {
    let anchor_line = options.anchor_line.unwrap_or(offset);
    if anchor_line == 0 {
        return Err(FunctionCallError::RespondToModel(
            "anchor_line must be a 1-indexed line number".to_string(),
        ));
    }
    let guard_limit = options.max_lines.unwrap_or(limit);
    if guard_limit == 0 {
        return Err(FunctionCallError::RespondToModel(
            "max_lines must be greater than zero".to_string(),
        ));
    }
    if collected.is_empty() || anchor_line > collected.len() {
        return Err(FunctionCallError::RespondToModel(
            "anchor_line exceeds file length".to_string(),
        ));
    }

    let anchor_index = anchor_line - 1;
    let effective_indents = compute_effective_indents(collected);
    let anchor_indent = effective_indents[anchor_index];
    let min_indent = if options.max_levels == 0 {
        0
    } else {
        anchor_indent.saturating_sub(options.max_levels * TAB_WIDTH)
    };
    let final_limit = limit.min(guard_limit).min(collected.len());
    if final_limit == 1 {
        return Ok(vec![format!(
            "L{}: {}",
            collected[anchor_index].number, collected[anchor_index].display
        )]);
    }

    let mut i: isize = anchor_index as isize - 1;
    let mut j = anchor_index + 1;
    let mut i_counter_min_indent = 0;
    let mut j_counter_min_indent = 0;
    let mut out = VecDeque::with_capacity(limit);
    out.push_back(&collected[anchor_index]);

    while out.len() < final_limit {
        let mut progressed = 0;
        if i >= 0 {
            let iu = i as usize;
            if effective_indents[iu] >= min_indent {
                out.push_front(&collected[iu]);
                progressed += 1;
                i -= 1;
                if effective_indents[iu] == min_indent && !options.include_siblings {
                    let allow_header_comment = options.include_header && collected[iu].is_comment();
                    let can_take_line = allow_header_comment || i_counter_min_indent == 0;
                    if can_take_line {
                        i_counter_min_indent += 1;
                    } else {
                        out.pop_front();
                        progressed -= 1;
                        i = -1;
                    }
                }
                if out.len() >= final_limit {
                    break;
                }
            } else {
                i = -1;
            }
        }

        if j < collected.len() {
            if effective_indents[j] >= min_indent {
                out.push_back(&collected[j]);
                progressed += 1;
                j += 1;
                if effective_indents[j - 1] == min_indent && !options.include_siblings {
                    if j_counter_min_indent > 0 {
                        out.pop_back();
                        progressed -= 1;
                        j = collected.len();
                    }
                    j_counter_min_indent += 1;
                }
            } else {
                j = collected.len();
            }
        }

        if progressed == 0 {
            break;
        }
    }

    trim_empty_lines(&mut out);
    Ok(out
        .into_iter()
        .map(|record| format!("L{}: {}", record.number, record.display))
        .collect())
}

fn compute_effective_indents(records: &[LineRecord]) -> Vec<usize> {
    let mut effective = Vec::with_capacity(records.len());
    let mut previous_indent = 0usize;
    for record in records {
        if record.is_blank() {
            effective.push(previous_indent);
        } else {
            previous_indent = record.indent;
            effective.push(previous_indent);
        }
    }
    effective
}

fn measure_indent(line: &str) -> usize {
    line.chars()
        .take_while(|c| matches!(c, ' ' | '\t'))
        .map(|c| if c == '\t' { TAB_WIDTH } else { 1 })
        .sum()
}

fn format_line(decoded: &str) -> String {
    if decoded.len() > MAX_LINE_LENGTH {
        take_bytes_at_char_boundary(decoded, MAX_LINE_LENGTH).to_string()
    } else {
        decoded.to_string()
    }
}

fn trim_empty_lines(out: &mut VecDeque<&LineRecord>) {
    while matches!(out.front(), Some(line) if line.raw.trim().is_empty()) {
        out.pop_front();
    }
    while matches!(out.back(), Some(line) if line.raw.trim().is_empty()) {
        out.pop_back();
    }
}

fn format_list_dir_entry(
    root: &str,
    depth: usize,
    entry: crate::host::HostFileEntry,
) -> Option<String> {
    let relative = entry.path.strip_prefix(root).unwrap_or(&entry.path);
    let trimmed = relative.trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let display_depth = trimmed.matches('/').count();
    if display_depth >= depth {
        return None;
    }
    let indentation = " ".repeat(display_depth * 2);
    let label = if entry.is_dir { "[dir]" } else { "[file]" };
    Some(format!("{indentation}{label} {trimmed}"))
}

fn glob_matches(include: Option<&str>, path: &str) -> bool {
    let Some(include) = include else {
        return true;
    };
    let include = include.trim();
    if include.is_empty() {
        return true;
    }
    if include.contains('{') && include.contains('}') {
        let Some((prefix, suffix)) = include.split_once('{') else {
            return path.ends_with(include);
        };
        let Some((choices, end)) = suffix.split_once('}') else {
            return path.ends_with(include);
        };
        return choices
            .split(',')
            .map(str::trim)
            .any(|choice| path.ends_with(&format!("{prefix}{choice}{end}")));
    }
    if let Some(suffix) = include.strip_prefix("*.") {
        return path.ends_with(&format!(".{suffix}"));
    }
    if let Some(suffix) = include.strip_prefix('*') {
        return path.ends_with(suffix);
    }
    path.ends_with(include)
}

mod defaults {
    use super::IndentationArgs;

    impl Default for IndentationArgs {
        fn default() -> Self {
            Self {
                anchor_line: None,
                max_levels: max_levels(),
                include_siblings: include_siblings(),
                include_header: include_header(),
                max_lines: None,
            }
        }
    }

    pub fn offset() -> usize {
        1
    }

    pub fn limit() -> usize {
        2000
    }

    pub fn max_levels() -> usize {
        0
    }

    pub fn include_siblings() -> bool {
        false
    }

    pub fn include_header() -> bool {
        true
    }
}

mod list_dir_defaults {
    pub fn limit() -> usize {
        25
    }

    pub fn depth() -> usize {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::HostResult;
    use crate::host::HostToolSpec;
    use crate::host::ListDirResponse;
    use crate::host::ReadFileResponse;
    use crate::host::SearchMatch;
    use crate::host::SearchRequest;
    use crate::host::SearchResponse;
    use pretty_assertions::assert_eq;

    struct MockFs {
        files: std::collections::HashMap<String, String>,
    }

    #[async_trait::async_trait(?Send)]
    impl HostFs for MockFs {
        async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse> {
            let content = self
                .files
                .get(&request.path)
                .cloned()
                .ok_or_else(|| HostError {
                    code: HostErrorCode::NotFound,
                    message: "missing file".to_string(),
                    retryable: false,
                    data: None,
                })?;
            Ok(ReadFileResponse {
                path: request.path,
                content,
            })
        }

        async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse> {
            let entries = self
                .files
                .keys()
                .filter(|path| path.starts_with(&request.path))
                .map(|path| crate::host::HostFileEntry {
                    path: path.clone(),
                    is_dir: false,
                    size_bytes: None,
                })
                .collect();
            Ok(ListDirResponse { entries })
        }

        async fn search(&self, _request: SearchRequest) -> HostResult<SearchResponse> {
            Ok(SearchResponse {
                matches: Vec::<SearchMatch>::new(),
            })
        }

        async fn write_file(
            &self,
            _request: crate::host::WriteFileRequest,
        ) -> HostResult<crate::host::WriteFileResponse> {
            unreachable!()
        }

        async fn apply_patch(
            &self,
            request: ApplyPatchRequest,
        ) -> HostResult<crate::host::ApplyPatchResponse> {
            Ok(crate::host::ApplyPatchResponse {
                files_changed: vec![request.patch],
            })
        }
    }

    struct MockCollaboration {
        approval_value: &'static str,
    }

    struct MockToolExecutor;

    #[async_trait::async_trait(?Send)]
    impl HostCollaboration for MockCollaboration {
        async fn update_plan(&self, _request: UpdatePlanRequest) -> HostResult<()> {
            Ok(())
        }

        async fn request_user_input(
            &self,
            _request: RequestUserInputRequest,
        ) -> HostResult<RequestUserInputResponse> {
            Ok(RequestUserInputResponse {
                answers: vec![RequestUserInputAnswer {
                    id: "approval_decision".to_string(),
                    value: Value::String(self.approval_value.to_string()),
                }],
            })
        }
    }

    #[async_trait::async_trait(?Send)]
    impl HostToolExecutor for MockToolExecutor {
        async fn list_tools(&self) -> HostResult<Vec<HostToolSpec>> {
            Ok(Vec::new())
        }

        async fn invoke(
            &self,
            _request: ToolInvokeRequest,
        ) -> HostResult<crate::host::ToolInvokeResponse> {
            unreachable!()
        }

        async fn cancel(&self, _call_id: String) -> HostResult<()> {
            Ok(())
        }
    }

    fn runtime() -> WasmToolRuntime<'static> {
        static COLLABORATION: MockCollaboration = MockCollaboration {
            approval_value: "Approve",
        };
        static TOOL_EXECUTOR: MockToolExecutor = MockToolExecutor;
        static FS: std::sync::LazyLock<MockFs> = std::sync::LazyLock::new(|| MockFs {
            files: std::collections::HashMap::from([
                (
                    "/workspace/src/lib.rs".to_string(),
                    "fn outer() {\n    if cond {\n        inner();\n    }\n}\n".to_string(),
                ),
                (
                    "/workspace/src/main.rs".to_string(),
                    "fn main() {}\n".to_string(),
                ),
            ]),
        });
        WasmToolRuntime::new(
            &*FS,
            &COLLABORATION,
            &TOOL_EXECUTOR,
            CollaborationMode::Default,
            false,
        )
    }

    fn rejected_runtime() -> WasmToolRuntime<'static> {
        static COLLABORATION: MockCollaboration = MockCollaboration {
            approval_value: "Reject",
        };
        static TOOL_EXECUTOR: MockToolExecutor = MockToolExecutor;
        static FS: std::sync::LazyLock<MockFs> = std::sync::LazyLock::new(|| MockFs {
            files: std::collections::HashMap::new(),
        });
        WasmToolRuntime::new(
            &*FS,
            &COLLABORATION,
            &TOOL_EXECUTOR,
            CollaborationMode::Default,
            false,
        )
    }

    #[tokio::test]
    async fn dispatches_read_file_tool_call() {
        let response = runtime()
            .dispatch_tool_call(
                ToolCall {
                    tool_name: "read_file".to_string(),
                    tool_namespace: None,
                    call_id: "call-1".to_string(),
                    payload: ToolPayload::Function {
                        arguments: serde_json::json!({
                            "file_path": "/workspace/src/lib.rs",
                            "offset": 2,
                            "limit": 2
                        })
                        .to_string(),
                    },
                },
                ToolCallSource::Direct,
            )
            .await
            .expect("dispatch succeeds");

        match response {
            ResponseInputItem::FunctionCallOutput { output, .. } => {
                assert_eq!(
                    output.body,
                    FunctionCallOutputBody::Text(
                        "L2:     if cond {\nL3:         inner();".to_string()
                    )
                );
            }
            other => panic!("expected function output, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn handle_output_item_done_runs_tool_calls() {
        let result = runtime()
            .handle_output_item_done(ResponseItem::FunctionCall {
                id: Some("fc-1".to_string()),
                name: "apply_patch".to_string(),
                namespace: None,
                arguments: "{\"input\":\"/workspace/src/lib.rs\"}".to_string(),
                call_id: "call-1".to_string(),
            })
            .await
            .expect("handle succeeds");

        assert!(result.needs_follow_up);
        assert!(result.tool_output.is_some());
        assert!(result.recorded_response_item.is_some());
    }

    #[tokio::test]
    async fn apply_patch_rejection_returns_model_error() {
        let response = rejected_runtime()
            .dispatch_tool_call(
                ToolCall {
                    tool_name: "apply_patch".to_string(),
                    tool_namespace: None,
                    call_id: "call-1".to_string(),
                    payload: ToolPayload::Function {
                        arguments: serde_json::json!({
                            "input": "*** Begin Patch\n*** Add File: /workspace/new.txt\n+hello\n*** End Patch\n"
                        })
                        .to_string(),
                    },
                },
                ToolCallSource::Direct,
            )
            .await
            .expect("dispatch succeeds");

        match response {
            ResponseInputItem::FunctionCallOutput { output, .. } => {
                assert_eq!(
                    output.body,
                    FunctionCallOutputBody::Text("Patch was rejected by the user.".to_string())
                );
                assert_eq!(output.success, Some(false));
            }
            other => panic!("expected function output, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn request_user_input_is_blocked_in_default_mode_without_flag() {
        let response = runtime()
            .dispatch_tool_call(
                ToolCall {
                    tool_name: "request_user_input".to_string(),
                    tool_namespace: None,
                    call_id: "call-1".to_string(),
                    payload: ToolPayload::Function {
                        arguments: serde_json::json!({
                            "questions": [{
                                "id": "choice",
                                "header": "Choice",
                                "question": "Pick one",
                                "options": [{
                                    "label": "Yes",
                                    "description": "Continue"
                                }]
                            }]
                        })
                        .to_string(),
                    },
                },
                ToolCallSource::Direct,
            )
            .await
            .expect("dispatch succeeds");

        match response {
            ResponseInputItem::FunctionCallOutput { output, .. } => {
                assert_eq!(
                    output.body,
                    FunctionCallOutputBody::Text(
                        "request_user_input is unavailable in Default mode".to_string()
                    )
                );
                assert_eq!(output.success, Some(false));
            }
            other => panic!("expected function output, got {other:?}"),
        }
    }

    #[test]
    fn indentation_mode_matches_core_shape() {
        let records =
            collect_file_lines("fn outer() {\n    if cond {\n        inner();\n    }\n}\n");
        let lines = read_indentation_block(
            &records,
            3,
            10,
            IndentationArgs {
                anchor_line: Some(3),
                include_siblings: false,
                max_levels: 1,
                ..Default::default()
            },
        )
        .expect("indentation read succeeds");

        assert_eq!(
            lines,
            vec![
                "L2:     if cond {".to_string(),
                "L3:         inner();".to_string(),
                "L4:     }".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn tool_search_returns_namespaced_deferred_host_tools() {
        let response = runtime()
            .dispatch_tool_call(
                ToolCall {
                    tool_name: "tool_search".to_string(),
                    tool_namespace: None,
                    call_id: "search-1".to_string(),
                    payload: ToolPayload::ToolSearch {
                        arguments: serde_json::json!({
                            "query": "notion"
                        }),
                        execution: "client".to_string(),
                    },
                },
                ToolCallSource::Direct,
            )
            .await
            .expect("dispatch succeeds");

        assert_eq!(
            response,
            ResponseInputItem::ToolSearchOutput {
                call_id: "search-1".to_string(),
                status: "completed".to_string(),
                execution: "client".to_string(),
                tools: Vec::new(),
            }
        );
    }
}
