pub(crate) mod browser_builtin;
pub(crate) mod browser_host;
pub mod code_mode;
pub mod context;
pub mod discoverable;
mod dynamic_handler;
pub mod handlers;
pub mod js_repl;
mod mcp_handler;
pub mod network_approval;
pub mod parallel;
pub mod registry;
pub mod router;
pub mod runtimes;
pub mod sandboxing;
pub mod spec;
mod tool_search_handler;
mod tool_suggest_handler;

use crate::exec::ExecToolCallOutput;
use crate::truncate::TruncationPolicy;
use crate::truncate::formatted_truncate_text;
pub use router::ToolRouter;

pub fn format_exec_output_str(
    exec_output: &ExecToolCallOutput,
    truncation_policy: TruncationPolicy,
) -> String {
    let content = if exec_output.timed_out {
        format!(
            "command timed out after {} milliseconds\n{}",
            exec_output.duration.as_millis(),
            exec_output.aggregated_output.text
        )
    } else {
        exec_output.aggregated_output.text.clone()
    };
    formatted_truncate_text(&content, truncation_policy)
}
