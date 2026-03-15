use super::host_error_to_function_call_error;
use super::parse_arguments;
use crate::codex::Session;
use crate::codex::TurnContext;
use crate::function_tool::FunctionCallError;
use crate::tools::browser_host::SearchRequest;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolPayload;
use regex_lite::Regex;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Arc;

const DEFAULT_GREP_LIMIT: usize = 100;
const MAX_GREP_LIMIT: usize = 2000;

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

pub(super) async fn handle(
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    payload: ToolPayload,
) -> Result<FunctionToolOutput, FunctionCallError> {
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
    let path = args.path.unwrap_or_else(|| turn.cwd.display().to_string());
    let regex = Regex::new(pattern).map_err(|err| {
        FunctionCallError::RespondToModel(format!("invalid regex pattern: {err}"))
    })?;
    let case_sensitive = pattern.chars().any(char::is_uppercase);
    let response = session
        .services
        .browser_fs
        .search(SearchRequest {
            path,
            query: pattern.to_string(),
            case_sensitive,
        })
        .await
        .map_err(host_error_to_function_call_error)?;
    let include = args
        .include
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut matched_paths = Vec::new();
    let mut seen = HashSet::new();
    for candidate in response.matches {
        if !glob_matches(include, &candidate.path) {
            continue;
        }
        if !regex.is_match(&candidate.line) {
            continue;
        }
        if seen.insert(candidate.path.clone()) {
            matched_paths.push(candidate.path);
        }
        if matched_paths.len() == limit {
            break;
        }
    }

    let success = !matched_paths.is_empty();
    let body = if success {
        matched_paths.join("\n")
    } else {
        "No matches found.".to_string()
    };

    Ok(FunctionToolOutput::from_text(body, Some(success)))
}

fn default_grep_limit() -> usize {
    DEFAULT_GREP_LIMIT
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
