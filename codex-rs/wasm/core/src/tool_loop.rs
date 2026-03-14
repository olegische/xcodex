use crate::host::HostToolSpec;
use serde_json::json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserBuiltinTool {
    ReadFile,
    ListDir,
    GrepFiles,
    ApplyPatch,
    UpdatePlan,
    RequestUserInput,
}

impl BrowserBuiltinTool {
    pub const fn name(self) -> &'static str {
        match self {
            Self::ReadFile => "read_file",
            Self::ListDir => "list_dir",
            Self::GrepFiles => "grep_files",
            Self::ApplyPatch => "apply_patch",
            Self::UpdatePlan => "update_plan",
            Self::RequestUserInput => "request_user_input",
        }
    }

    pub fn spec(self) -> HostToolSpec {
        match self {
            Self::ReadFile => HostToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Reads a local file with 1-indexed line numbers, supporting slice and indentation-aware block modes.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Absolute path to the file"
                        },
                        "offset": {
                            "type": "number",
                            "description": "The line number to start reading from. Must be 1 or greater."
                        },
                        "limit": {
                            "type": "number",
                            "description": "The maximum number of lines to return."
                        },
                        "mode": {
                            "type": "string",
                            "description": "Optional mode selector: \"slice\" for simple ranges (default) or \"indentation\" to expand around an anchor line."
                        },
                        "indentation": {
                            "type": "object",
                            "properties": {
                                "anchor_line": {
                                    "type": "number",
                                    "description": "Anchor line to center the indentation lookup on (defaults to offset)."
                                },
                                "max_levels": {
                                    "type": "number",
                                    "description": "How many parent indentation levels (smaller indents) to include."
                                },
                                "include_siblings": {
                                    "type": "boolean",
                                    "description": "When true, include additional blocks that share the anchor indentation."
                                },
                                "include_header": {
                                    "type": "boolean",
                                    "description": "Include doc comments or attributes directly above the selected block."
                                },
                                "max_lines": {
                                    "type": "number",
                                    "description": "Hard cap on the number of lines returned when using indentation mode."
                                }
                            },
                            "additionalProperties": false
                        },
                    },
                    "required": ["file_path"],
                    "additionalProperties": false,
                }),
            },
            Self::ListDir => HostToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Lists entries in a local directory with 1-indexed entry numbers and simple type labels.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "dir_path": {
                            "type": "string",
                            "description": "Absolute path to the directory to list."
                        },
                        "offset": {
                            "type": "number",
                            "description": "The entry number to start listing from. Must be 1 or greater."
                        },
                        "limit": {
                            "type": "number",
                            "description": "The maximum number of entries to return."
                        },
                        "depth": {
                            "type": "number",
                            "description": "The maximum directory depth to traverse. Must be 1 or greater."
                        },
                    },
                    "required": ["dir_path"],
                    "additionalProperties": false,
                }),
            },
            Self::GrepFiles => HostToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Finds files whose contents match the pattern and lists them by modification time.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Regular expression pattern to search for."
                        },
                        "include": {
                            "type": "string",
                            "description": "Optional glob that limits which files are searched (e.g. \"*.rs\" or \"*.{ts,tsx}\")."
                        },
                        "path": {
                            "type": "string",
                            "description": "Directory or file path to search. Defaults to the session's working directory."
                        },
                        "limit": {
                            "type": "number",
                            "description": "Maximum number of file paths to return (defaults to 100)."
                        },
                    },
                    "required": ["pattern"],
                    "additionalProperties": false,
                }),
            },
            Self::ApplyPatch => HostToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "input": {
                            "type": "string",
                            "description": "The entire contents of the apply_patch command"
                        },
                    },
                    "required": ["input"],
                    "additionalProperties": false,
                }),
            },
            Self::UpdatePlan => HostToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.\n".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "explanation": {
                            "type": "string",
                        },
                        "plan": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "step": {
                                        "type": "string",
                                    },
                                    "status": {
                                        "type": "string",
                                    },
                                },
                                "required": ["step", "status"],
                                "additionalProperties": false,
                            },
                        },
                    },
                    "required": ["plan"],
                    "additionalProperties": false,
                }),
            },
            Self::RequestUserInput => HostToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Request user input for one to three short questions and wait for the response. This tool is only available in Plan mode.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "description": "Questions to show the user. Prefer 1 and do not exceed 3",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "header": {
                                        "type": "string",
                                        "description": "Short header label shown in the UI (12 or fewer chars)."
                                    },
                                    "id": {
                                        "type": "string",
                                        "description": "Stable identifier for mapping answers (snake_case)."
                                    },
                                    "question": {
                                        "type": "string",
                                        "description": "Single-sentence prompt shown to the user."
                                    },
                                    "options": {
                                        "type": "array",
                                        "description": "Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with \"(Recommended)\". Do not include an \"Other\" option in this list; the client will add a free-form \"Other\" option automatically.",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "label": {
                                                    "type": "string",
                                                    "description": "User-facing label (1-5 words)."
                                                },
                                                "description": {
                                                    "type": "string",
                                                    "description": "One short sentence explaining impact/tradeoff if selected."
                                                },
                                            },
                                            "required": ["label", "description"],
                                            "additionalProperties": false,
                                        },
                                    },
                                },
                                "required": ["header", "id", "question", "options"],
                                "additionalProperties": false,
                            },
                        },
                    },
                    "required": ["questions"],
                    "additionalProperties": false,
                }),
            },
        }
    }
}

pub fn browser_builtin_tool_specs() -> Vec<HostToolSpec> {
    [
        BrowserBuiltinTool::ReadFile,
        BrowserBuiltinTool::ListDir,
        BrowserBuiltinTool::GrepFiles,
        BrowserBuiltinTool::ApplyPatch,
        BrowserBuiltinTool::UpdatePlan,
        BrowserBuiltinTool::RequestUserInput,
    ]
    .into_iter()
    .map(BrowserBuiltinTool::spec)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn builtin_tool_specs_match_fixed_browser_safe_tool_set() {
        let names = browser_builtin_tool_specs()
            .into_iter()
            .map(|spec| spec.tool_name)
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "read_file",
                "list_dir",
                "grep_files",
                "apply_patch",
                "update_plan",
                "request_user_input",
            ]
        );
    }
}
