use super::host_error_to_function_call_error;
use super::parse_arguments;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::tools::browser_host::HostFileEntry;
use crate::tools::browser_host::ListDirRequest;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolPayload;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
struct ListDirArgs {
    dir_path: String,
    #[serde(default = "defaults::offset")]
    offset: usize,
    #[serde(default = "defaults::limit")]
    limit: usize,
    #[serde(default = "defaults::depth")]
    depth: usize,
}

pub(super) async fn handle(
    session: Arc<Session>,
    _turn: Arc<TurnContext>,
    payload: ToolPayload,
) -> Result<FunctionToolOutput, FunctionCallError> {
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

    let response = session
        .services
        .browser_fs
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

    let mut output = vec![format!("Absolute path: {}", args.dir_path)];
    if !entries.is_empty() {
        let remaining_entries = entries.len() - start_index;
        let capped_limit = args.limit.min(remaining_entries);
        let end_index = start_index + capped_limit;
        output.extend(entries[start_index..end_index].iter().cloned());
        if end_index < entries.len() {
            output.push(format!("More than {capped_limit} entries found"));
        }
    }

    Ok(FunctionToolOutput::from_text(output.join("\n"), Some(true)))
}

fn format_list_dir_entry(root: &str, depth: usize, entry: HostFileEntry) -> Option<String> {
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

mod defaults {
    pub fn offset() -> usize {
        1
    }

    pub fn limit() -> usize {
        25
    }

    pub fn depth() -> usize {
        2
    }
}
