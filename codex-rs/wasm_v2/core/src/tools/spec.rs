use codex_protocol::openai_models::ModelInfo;
use codex_protocol::protocol::SessionSource;
use serde_json::Value;
use serde_json::json;

pub type JsonSchema = Value;

#[derive(Debug, Clone, PartialEq)]
pub struct ToolSpec {
    pub tool_name: String,
    pub tool_namespace: Option<String>,
    pub description: String,
    pub input_schema: Value,
}

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

    pub fn spec(self) -> ToolSpec {
        match self {
            Self::ReadFile => ToolSpec {
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
            Self::ListDir => ToolSpec {
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
            Self::GrepFiles => ToolSpec {
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
            Self::ApplyPatch => ToolSpec {
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
            Self::UpdatePlan => ToolSpec {
                tool_name: self.name().to_string(),
                tool_namespace: None,
                description: "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.\n".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "explanation": {
                            "type": "string"
                        },
                        "plan": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "step": {
                                        "type": "string"
                                    },
                                    "status": {
                                        "type": "string"
                                    },
                                },
                                "required": ["step", "status"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["plan"],
                    "additionalProperties": false,
                }),
            },
            Self::RequestUserInput => ToolSpec {
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
                                                }
                                            },
                                            "required": ["label", "description"],
                                            "additionalProperties": false
                                        }
                                    }
                                },
                                "required": ["header", "id", "question", "options"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["questions"],
                    "additionalProperties": false,
                }),
            },
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ToolsConfig {
    pub js_repl_tools_only: bool,
    pub web_search_mode: Option<codex_protocol::config_types::WebSearchMode>,
    pub web_search_config: Option<serde_json::Value>,
    pub allow_login_shell: bool,
    pub search_tool: bool,
    pub tool_suggest: bool,
    pub request_user_input: bool,
    pub default_mode_request_user_input: bool,
}

#[derive(Clone, Debug)]
pub struct ToolsConfigParams<'a> {
    pub model_info: &'a ModelInfo,
    pub available_models: &'a [ModelInfo],
    pub features: &'a crate::features::ManagedFeatures,
    pub web_search_mode: Option<codex_protocol::config_types::WebSearchMode>,
    pub session_source: codex_protocol::protocol::SessionSource,
}

impl ToolsConfig {
    pub fn new(params: &ToolsConfigParams<'_>) -> Self {
        let request_user_input = !matches!(params.session_source, SessionSource::SubAgent(_));
        Self {
            web_search_mode: params.web_search_mode,
            search_tool: params.features.enabled(crate::features::Feature::Apps),
            tool_suggest: params.features.enabled(crate::features::Feature::Apps)
                && params
                    .features
                    .enabled(crate::features::Feature::ToolSuggest),
            request_user_input,
            default_mode_request_user_input: request_user_input
                && params
                    .features
                    .enabled(crate::features::Feature::DefaultModeRequestUserInput),
            ..Self::default()
        }
    }

    pub fn with_web_search_config(mut self, config: Option<serde_json::Value>) -> Self {
        self.web_search_config = config;
        self
    }

    pub fn with_allow_login_shell(mut self, allow: bool) -> Self {
        self.allow_login_shell = allow;
        self
    }

    pub fn with_agent_roles<T>(self, _agent_roles: T) -> Self {
        self
    }
}

pub fn browser_builtin_tool_specs(config: &ToolsConfig) -> Vec<ToolSpec> {
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
        .map(|tool| match tool {
            BrowserBuiltinTool::RequestUserInput => ToolSpec {
                description: crate::tools::browser_builtin::request_user_input_tool_description(
                    config.default_mode_request_user_input,
                ),
                ..tool.spec()
            },
            _ => tool.spec(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn browser_builtin_specs_expose_expected_tools() {
        let tool_names = browser_builtin_tool_specs(&ToolsConfig {
            request_user_input: true,
            ..ToolsConfig::default()
        })
        .into_iter()
        .map(|spec| spec.tool_name)
        .collect::<Vec<_>>();

        assert_eq!(
            tool_names,
            vec![
                "read_file".to_string(),
                "list_dir".to_string(),
                "grep_files".to_string(),
                "apply_patch".to_string(),
                "update_plan".to_string(),
                "request_user_input".to_string(),
            ]
        );
    }

    #[test]
    fn browser_builtin_specs_omit_request_user_input_for_subagents() {
        let tool_names = browser_builtin_tool_specs(&ToolsConfig {
            request_user_input: false,
            ..ToolsConfig::default()
        })
        .into_iter()
        .map(|spec| spec.tool_name)
        .collect::<Vec<_>>();

        assert_eq!(
            tool_names,
            vec![
                "read_file".to_string(),
                "list_dir".to_string(),
                "grep_files".to_string(),
                "apply_patch".to_string(),
                "update_plan".to_string(),
            ]
        );
    }

    #[test]
    fn request_user_input_description_reflects_default_mode_flag() {
        let default_description = browser_builtin_tool_specs(&ToolsConfig {
            request_user_input: true,
            default_mode_request_user_input: false,
            ..ToolsConfig::default()
        })
        .into_iter()
        .find(|spec| spec.tool_name == "request_user_input")
        .map(|spec| spec.description)
        .unwrap_or_else(|| unreachable!("request_user_input should be present"));

        let enabled_description = browser_builtin_tool_specs(&ToolsConfig {
            request_user_input: true,
            default_mode_request_user_input: true,
            ..ToolsConfig::default()
        })
        .into_iter()
        .find(|spec| spec.tool_name == "request_user_input")
        .map(|spec| spec.description)
        .unwrap_or_else(|| unreachable!("request_user_input should be present"));

        assert_eq!(
            default_description,
            crate::tools::browser_builtin::request_user_input_tool_description(false)
        );
        assert_eq!(
            enabled_description,
            crate::tools::browser_builtin::request_user_input_tool_description(true)
        );
    }

    #[test]
    fn tools_config_enables_default_mode_request_user_input_from_feature_flag() {
        let model_info =
            crate::models_manager::manager::ModelsManager::construct_model_info_offline_for_tests(
                "gpt-5-codex",
                &crate::config::Config::default(),
            );
        let available_models = Vec::new();
        let mut features = crate::features::ManagedFeatures::default();
        let _ = features.enable(crate::features::Feature::DefaultModeRequestUserInput);
        let config = ToolsConfig::new(&ToolsConfigParams {
            model_info: &model_info,
            available_models: &available_models,
            features: &features,
            web_search_mode: None,
            session_source: SessionSource::Cli,
        });

        assert_eq!(config.request_user_input, true);
        assert_eq!(config.default_mode_request_user_input, true);
    }

    #[test]
    fn tools_config_enables_search_tool_from_apps_feature_flag() {
        let model_info =
            crate::models_manager::manager::ModelsManager::construct_model_info_offline_for_tests(
                "gpt-5-codex",
                &crate::config::Config::default(),
            );
        let available_models = Vec::new();
        let mut features = crate::features::ManagedFeatures::default();
        let _ = features.enable(crate::features::Feature::Apps);
        let config = ToolsConfig::new(&ToolsConfigParams {
            model_info: &model_info,
            available_models: &available_models,
            features: &features,
            web_search_mode: None,
            session_source: SessionSource::Cli,
        });

        assert_eq!(config.search_tool, true);
    }

    #[test]
    fn tools_config_enables_tool_suggest_only_with_apps_and_tool_suggest_flags() {
        let model_info =
            crate::models_manager::manager::ModelsManager::construct_model_info_offline_for_tests(
                "gpt-5-codex",
                &crate::config::Config::default(),
            );
        let available_models = Vec::new();
        let mut features = crate::features::ManagedFeatures::default();
        let _ = features.enable(crate::features::Feature::ToolSuggest);
        let without_apps = ToolsConfig::new(&ToolsConfigParams {
            model_info: &model_info,
            available_models: &available_models,
            features: &features,
            web_search_mode: None,
            session_source: SessionSource::Cli,
        });
        assert!(!without_apps.tool_suggest);

        let _ = features.enable(crate::features::Feature::Apps);
        let with_apps = ToolsConfig::new(&ToolsConfigParams {
            model_info: &model_info,
            available_models: &available_models,
            features: &features,
            web_search_mode: None,
            session_source: SessionSource::Cli,
        });
        assert!(with_apps.tool_suggest);
    }
}
