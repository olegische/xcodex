use std::path::PathBuf;
use std::sync::Arc;

use codex_app_server_protocol::Config;
use codex_app_server_protocol::ConfigBatchWriteParams;
use codex_app_server_protocol::ConfigEdit;
use codex_app_server_protocol::ConfigLayer;
use codex_app_server_protocol::ConfigLayerMetadata;
use codex_app_server_protocol::ConfigLayerSource;
use codex_app_server_protocol::ConfigReadParams;
use codex_app_server_protocol::ConfigReadResponse;
use codex_app_server_protocol::ConfigRequirementsReadResponse;
use codex_app_server_protocol::ConfigValueWriteParams;
use codex_app_server_protocol::ConfigWriteErrorCode;
use codex_app_server_protocol::ConfigWriteResponse;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::MergeStrategy;
use codex_app_server_protocol::SandboxMode;
use codex_app_server_protocol::SandboxWorkspaceWrite;
use codex_app_server_protocol::WriteStatus;
use codex_protocol::openai_models::ReasoningEffort;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::SandboxPolicy;
use codex_utils_absolute_path::AbsolutePathBuf;
use serde_json::json;

use crate::RuntimeBootstrap;

pub struct ConfigApi<'a> {
    runtime_bootstrap: &'a mut RuntimeBootstrap,
    loaded_threads: Vec<Arc<codex_wasm_v2_core::codex::Codex>>,
}

impl<'a> ConfigApi<'a> {
    pub fn new(
        runtime_bootstrap: &'a mut RuntimeBootstrap,
        loaded_threads: Vec<Arc<codex_wasm_v2_core::codex::Codex>>,
    ) -> Self {
        Self {
            runtime_bootstrap,
            loaded_threads,
        }
    }

    pub fn read(&self, params: ConfigReadParams) -> Result<ConfigReadResponse, JSONRPCErrorError> {
        let config = protocol_config(&self.runtime_bootstrap.config);
        let origins = config_origins(&config);
        let layers = params
            .include_layers
            .then(|| vec![config_layer(&config)])
            .map(Some)
            .unwrap_or(None);

        Ok(ConfigReadResponse {
            config,
            origins,
            layers,
        })
    }

    pub fn config_requirements_read(
        &self,
    ) -> Result<ConfigRequirementsReadResponse, JSONRPCErrorError> {
        Ok(ConfigRequirementsReadResponse { requirements: None })
    }

    pub async fn write_value(
        &mut self,
        params: ConfigValueWriteParams,
    ) -> Result<ConfigWriteResponse, JSONRPCErrorError> {
        self.batch_write(ConfigBatchWriteParams {
            edits: vec![ConfigEdit {
                key_path: params.key_path,
                value: params.value,
                merge_strategy: params.merge_strategy,
            }],
            file_path: params.file_path,
            expected_version: params.expected_version,
            reload_user_config: false,
        })
        .await
    }

    pub async fn batch_write(
        &mut self,
        params: ConfigBatchWriteParams,
    ) -> Result<ConfigWriteResponse, JSONRPCErrorError> {
        let current = load_current_user_config(self.runtime_bootstrap).await?;
        let mut user_config = current.config;
        for edit in &params.edits {
            let segments = parse_key_path(&edit.key_path).map_err(config_validation_error)?;
            let parsed_value = parse_value(edit.value.clone()).map_err(config_validation_error)?;
            apply_merge(
                &mut user_config,
                &segments,
                parsed_value.as_ref(),
                edit.merge_strategy.clone(),
            )
            .map_err(map_merge_error)?;
        }

        let content = toml::to_string(&user_config).map_err(internal_error)?;
        let saved = self
            .runtime_bootstrap
            .config_storage_host
            .save_user_config(codex_wasm_v2_core::SaveUserConfigRequest {
                file_path: Some(current.file_path.clone()),
                expected_version: params.expected_version.or(current.version.clone()),
                content,
            })
            .await
            .map_err(map_host_write_error)?;

        self.runtime_bootstrap.config.config_layer_stack = self
            .runtime_bootstrap
            .config
            .config_layer_stack
            .clone()
            .with_user_config(&current.file_path, user_config.clone());
        apply_effective_user_config(&mut self.runtime_bootstrap.config, &user_config);

        if params.reload_user_config {
            for thread in &self.loaded_threads {
                let _ = thread.submit(Op::ReloadUserConfig).await;
            }
        }

        Ok(ConfigWriteResponse {
            status: WriteStatus::Ok,
            version: saved.version,
            file_path: absolute_file_path(&current.file_path)?,
            overridden_metadata: None,
        })
    }
}

fn protocol_config(config: &codex_wasm_v2_core::config::Config) -> Config {
    Config {
        model: config.model.clone(),
        review_model: config.review_model.clone(),
        model_context_window: config.model_context_window,
        model_auto_compact_token_limit: config.model_auto_compact_token_limit,
        model_provider: Some(config.model_provider_id.clone()),
        approval_policy: Some(config.permissions.approval_policy.value().into()),
        sandbox_mode: sandbox_mode(config.permissions.sandbox_policy.get()),
        sandbox_workspace_write: sandbox_workspace_write(config.permissions.sandbox_policy.get()),
        forced_chatgpt_workspace_id: None,
        forced_login_method: None,
        web_search: Some(config.web_search_mode.value()),
        tools: None,
        profile: config.active_profile.clone(),
        profiles: Default::default(),
        instructions: config.base_instructions.clone(),
        developer_instructions: config.developer_instructions.clone(),
        compact_prompt: config.compact_prompt.clone(),
        model_reasoning_effort: config.model_reasoning_effort,
        model_reasoning_summary: config.model_reasoning_summary,
        model_verbosity: config.model_verbosity,
        service_tier: config.service_tier,
        analytics: None,
        apps: None,
        additional: Default::default(),
    }
}

fn config_origins(config: &Config) -> std::collections::HashMap<String, ConfigLayerMetadata> {
    let origin = ConfigLayerMetadata {
        name: ConfigLayerSource::SessionFlags,
        version: config_layer_version(),
    };
    let mut origins = std::collections::HashMap::new();

    insert_origin(&mut origins, "model", config.model.as_ref(), &origin);
    insert_origin(
        &mut origins,
        "review_model",
        config.review_model.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "model_context_window",
        config.model_context_window.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "model_auto_compact_token_limit",
        config.model_auto_compact_token_limit.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "model_provider",
        config.model_provider.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "approval_policy",
        config.approval_policy.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "sandbox_mode",
        config.sandbox_mode.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "sandbox_workspace_write",
        config.sandbox_workspace_write.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "web_search",
        config.web_search.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "instructions",
        config.instructions.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "developer_instructions",
        config.developer_instructions.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "compact_prompt",
        config.compact_prompt.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "model_reasoning_effort",
        config.model_reasoning_effort.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "model_reasoning_summary",
        config.model_reasoning_summary.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "model_verbosity",
        config.model_verbosity.as_ref(),
        &origin,
    );
    insert_origin(
        &mut origins,
        "service_tier",
        config.service_tier.as_ref(),
        &origin,
    );
    insert_origin(&mut origins, "profile", config.profile.as_ref(), &origin);

    origins
}

fn insert_origin<T>(
    origins: &mut std::collections::HashMap<String, ConfigLayerMetadata>,
    key: &str,
    value: Option<&T>,
    origin: &ConfigLayerMetadata,
) {
    if value.is_some() {
        origins.insert(key.to_string(), origin.clone());
    }
}

fn config_layer(config: &Config) -> ConfigLayer {
    ConfigLayer {
        name: ConfigLayerSource::SessionFlags,
        version: config_layer_version(),
        config: serde_json::to_value(config).unwrap_or_else(|error| {
            unreachable!("config/read config layer should serialize: {error}")
        }),
        disabled_reason: None,
    }
}

fn config_layer_version() -> String {
    "wasm-browser-bootstrap-v1".to_string()
}

struct LoadedUserConfig {
    file_path: String,
    version: Option<String>,
    config: toml::Value,
}

async fn load_current_user_config(
    runtime_bootstrap: &RuntimeBootstrap,
) -> Result<LoadedUserConfig, JSONRPCErrorError> {
    match runtime_bootstrap
        .config_storage_host
        .load_user_config(codex_wasm_v2_core::LoadUserConfigRequest {})
        .await
    {
        Ok(response) => Ok(LoadedUserConfig {
            file_path: response.file_path,
            version: Some(response.version),
            config: toml::from_str(&response.content).map_err(|error| {
                config_validation_error(format!("invalid user config: {error}"))
            })?,
        }),
        Err(error) if error.code == codex_wasm_v2_core::HostErrorCode::NotFound => {
            let file_path = runtime_bootstrap
                .config
                .codex_home
                .join("config.toml")
                .display()
                .to_string();
            Ok(LoadedUserConfig {
                file_path,
                version: None,
                config: toml::Value::Table(Default::default()),
            })
        }
        Err(error) => Err(internal_error(error.message)),
    }
}

fn apply_effective_user_config(
    config: &mut codex_wasm_v2_core::config::Config,
    user_config: &toml::Value,
) {
    let Some(table) = user_config.as_table() else {
        return;
    };

    config.model = string_value(table.get("model"));
    config.review_model = string_value(table.get("review_model"));
    if let Some(model_provider) = string_value(table.get("model_provider")) {
        config.model_provider_id = model_provider;
    }
    config.base_instructions = string_value(table.get("base_instructions"));
    config.developer_instructions = string_value(table.get("developer_instructions"));
    config.compact_prompt = string_value(table.get("compact_prompt"));
    config.model_reasoning_effort = table
        .get("model_reasoning_effort")
        .and_then(toml::Value::as_str)
        .and_then(reasoning_effort);
    if let Some(approval_policy) = table
        .get("approval_policy")
        .and_then(toml::Value::as_str)
        .and_then(approval_policy)
    {
        let _ = config.permissions.approval_policy.set(approval_policy);
    }
    if let Some(sandbox_mode) = table
        .get("sandbox_mode")
        .and_then(toml::Value::as_str)
        .and_then(sandbox_policy)
    {
        let _ = config.permissions.sandbox_policy.set(sandbox_mode);
    }
}

fn string_value(value: Option<&toml::Value>) -> Option<String> {
    value.and_then(toml::Value::as_str).map(str::to_string)
}

fn reasoning_effort(value: &str) -> Option<ReasoningEffort> {
    match value {
        "minimal" => Some(ReasoningEffort::Minimal),
        "low" => Some(ReasoningEffort::Low),
        "medium" => Some(ReasoningEffort::Medium),
        "high" => Some(ReasoningEffort::High),
        _ => None,
    }
}

fn approval_policy(value: &str) -> Option<AskForApproval> {
    match value {
        "unless_trusted" => Some(AskForApproval::UnlessTrusted),
        "on_failure" => Some(AskForApproval::OnFailure),
        "on_request" => Some(AskForApproval::OnRequest),
        "never" => Some(AskForApproval::Never),
        _ => None,
    }
}

fn sandbox_mode(policy: &codex_protocol::protocol::SandboxPolicy) -> Option<SandboxMode> {
    match policy {
        codex_protocol::protocol::SandboxPolicy::ReadOnly { .. } => Some(SandboxMode::ReadOnly),
        codex_protocol::protocol::SandboxPolicy::WorkspaceWrite { .. } => {
            Some(SandboxMode::WorkspaceWrite)
        }
        codex_protocol::protocol::SandboxPolicy::DangerFullAccess => {
            Some(SandboxMode::DangerFullAccess)
        }
        codex_protocol::protocol::SandboxPolicy::ExternalSandbox { .. } => None,
    }
}

fn sandbox_workspace_write(
    policy: &codex_protocol::protocol::SandboxPolicy,
) -> Option<SandboxWorkspaceWrite> {
    match policy {
        codex_protocol::protocol::SandboxPolicy::WorkspaceWrite {
            writable_roots,
            network_access,
            exclude_tmpdir_env_var,
            exclude_slash_tmp,
            ..
        } => Some(SandboxWorkspaceWrite {
            writable_roots: writable_roots
                .iter()
                .map(|path| path.as_ref().to_path_buf())
                .collect(),
            network_access: *network_access,
            exclude_tmpdir_env_var: *exclude_tmpdir_env_var,
            exclude_slash_tmp: *exclude_slash_tmp,
        }),
        codex_protocol::protocol::SandboxPolicy::ReadOnly { .. }
        | codex_protocol::protocol::SandboxPolicy::DangerFullAccess
        | codex_protocol::protocol::SandboxPolicy::ExternalSandbox { .. } => None,
    }
}

fn sandbox_policy(value: &str) -> Option<SandboxPolicy> {
    match value {
        "read_only" => Some(SandboxPolicy::new_read_only_policy()),
        "workspace_write" => Some(SandboxPolicy::new_workspace_write_policy()),
        "danger_full_access" => Some(SandboxPolicy::DangerFullAccess),
        _ => None,
    }
}

fn parse_key_path(path: &str) -> Result<Vec<String>, String> {
    if path.trim().is_empty() {
        return Err("keyPath must not be empty".to_string());
    }
    Ok(path.split('.').map(str::to_string).collect())
}

fn parse_value(value: serde_json::Value) -> Result<Option<toml::Value>, String> {
    if value.is_null() {
        return Ok(None);
    }

    serde_json::from_value::<toml::Value>(value)
        .map(Some)
        .map_err(|error| format!("invalid value: {error}"))
}

#[derive(Debug)]
enum MergeError {
    PathNotFound,
    Validation(String),
}

fn apply_merge(
    root: &mut toml::Value,
    segments: &[String],
    value: Option<&toml::Value>,
    strategy: MergeStrategy,
) -> Result<(), MergeError> {
    let Some(value) = value else {
        clear_path(root, segments)?;
        return Ok(());
    };
    let Some((last, parents)) = segments.split_last() else {
        return Err(MergeError::Validation(
            "keyPath must not be empty".to_string(),
        ));
    };

    let mut current = root;
    for segment in parents {
        match current {
            toml::Value::Table(table) => {
                current = table
                    .entry(segment.clone())
                    .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
            }
            _ => {
                *current = toml::Value::Table(toml::map::Map::new());
                let toml::Value::Table(table) = current else {
                    unreachable!("table inserted above");
                };
                current = table
                    .entry(segment.clone())
                    .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
            }
        }
    }

    let table = current.as_table_mut().ok_or_else(|| {
        MergeError::Validation("cannot set value on non-table parent".to_string())
    })?;

    if matches!(strategy, MergeStrategy::Upsert)
        && let Some(existing) = table.get_mut(last)
        && matches!(existing, toml::Value::Table(_))
        && matches!(value, toml::Value::Table(_))
    {
        merge_toml_values(existing, value);
        return Ok(());
    }

    table.insert(last.clone(), value.clone());
    Ok(())
}

fn merge_toml_values(existing: &mut toml::Value, incoming: &toml::Value) {
    match (existing, incoming) {
        (toml::Value::Table(existing_table), toml::Value::Table(incoming_table)) => {
            for (key, incoming_value) in incoming_table {
                if let Some(existing_value) = existing_table.get_mut(key) {
                    merge_toml_values(existing_value, incoming_value);
                } else {
                    existing_table.insert(key.clone(), incoming_value.clone());
                }
            }
        }
        (existing_value, incoming_value) => *existing_value = incoming_value.clone(),
    }
}

fn clear_path(root: &mut toml::Value, segments: &[String]) -> Result<(), MergeError> {
    let Some((last, parents)) = segments.split_last() else {
        return Err(MergeError::Validation(
            "keyPath must not be empty".to_string(),
        ));
    };

    let mut current = root;
    for segment in parents {
        match current {
            toml::Value::Table(table) => {
                current = table.get_mut(segment).ok_or(MergeError::PathNotFound)?;
            }
            _ => return Err(MergeError::PathNotFound),
        }
    }

    let parent = current.as_table_mut().ok_or(MergeError::PathNotFound)?;
    parent.remove(last);
    Ok(())
}

fn map_merge_error(error: MergeError) -> JSONRPCErrorError {
    match error {
        MergeError::PathNotFound => {
            config_write_error(ConfigWriteErrorCode::ConfigPathNotFound, "Path not found")
        }
        MergeError::Validation(message) => config_validation_error(message),
    }
}

fn map_host_write_error(error: codex_wasm_v2_core::HostError) -> JSONRPCErrorError {
    match error.code {
        codex_wasm_v2_core::HostErrorCode::Conflict => {
            config_write_error(ConfigWriteErrorCode::ConfigVersionConflict, error.message)
        }
        codex_wasm_v2_core::HostErrorCode::PermissionDenied => {
            config_write_error(ConfigWriteErrorCode::ConfigLayerReadonly, error.message)
        }
        _ => internal_error(error.message),
    }
}

fn config_validation_error(message: impl Into<String>) -> JSONRPCErrorError {
    config_write_error(ConfigWriteErrorCode::ConfigValidationError, message)
}

fn config_write_error(code: ConfigWriteErrorCode, message: impl Into<String>) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32600,
        data: Some(json!({ "config_write_error_code": code })),
        message: message.into(),
    }
}

fn absolute_file_path(file_path: &str) -> Result<AbsolutePathBuf, JSONRPCErrorError> {
    let path = PathBuf::from(file_path);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().map_err(internal_error)?.join(path)
    };
    AbsolutePathBuf::from_absolute_path(absolute).map_err(internal_error)
}

fn internal_error(message: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: message.to_string(),
    }
}
