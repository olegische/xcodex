use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::SkillDependencies;
use codex_app_server_protocol::SkillErrorInfo;
use codex_app_server_protocol::SkillInterface;
use codex_app_server_protocol::SkillMetadata;
use codex_app_server_protocol::SkillToolDependency;
use codex_app_server_protocol::SkillsConfigWriteParams;
use codex_app_server_protocol::SkillsConfigWriteResponse;
use codex_app_server_protocol::SkillsListParams;
use codex_app_server_protocol::SkillsListResponse;
use codex_wasm_core::HostErrorCode;
use codex_wasm_core::LoadUserConfigRequest;
use codex_wasm_core::SaveUserConfigRequest;
use codex_wasm_core::plugins::PluginsManager;
use codex_wasm_core::skills::SkillError;
use codex_wasm_core::skills::SkillsManager;

use crate::RuntimeBootstrap;

pub async fn skills_list_response(
    runtime_bootstrap: &RuntimeBootstrap,
    params: SkillsListParams,
) -> Result<SkillsListResponse, JSONRPCErrorError> {
    let SkillsListParams {
        cwds,
        force_reload,
        per_cwd_extra_user_roots,
    } = params;
    let cwds = if cwds.is_empty() {
        vec![runtime_bootstrap.config.cwd.clone()]
    } else {
        cwds
    };
    let cwd_set = cwds.iter().cloned().collect::<HashSet<_>>();
    let mut extra_roots_by_cwd: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();

    for entry in per_cwd_extra_user_roots.unwrap_or_default() {
        if !cwd_set.contains(&entry.cwd) {
            continue;
        }

        let mut valid_extra_roots = Vec::new();
        for root in entry.extra_user_roots {
            if !root.is_absolute() {
                return Err(invalid_request_error(format!(
                    "skills/list perCwdExtraUserRoots extraUserRoots paths must be absolute: {}",
                    root.display()
                )));
            }
            valid_extra_roots.push(root);
        }
        extra_roots_by_cwd
            .entry(entry.cwd)
            .or_default()
            .extend(valid_extra_roots);
    }

    let skills_manager = SkillsManager::new(
        runtime_bootstrap.config.codex_home.clone(),
        Arc::new(PluginsManager::new(
            runtime_bootstrap.config.codex_home.clone(),
        )),
        bundled_skills_enabled(&runtime_bootstrap.config),
    );
    let mut data = Vec::new();

    for cwd in cwds {
        let extra_roots = extra_roots_by_cwd
            .get(&cwd)
            .map_or(&[][..], std::vec::Vec::as_slice);
        let outcome = skills_manager
            .skills_for_cwd_with_extra_user_roots(&cwd, force_reload, extra_roots)
            .await;
        data.push(codex_app_server_protocol::SkillsListEntry {
            cwd,
            skills: skills_to_info(&outcome.skills, &outcome.disabled_paths),
            errors: errors_to_info(&outcome.errors),
        });
    }

    Ok(SkillsListResponse { data })
}

pub async fn skills_config_write(
    runtime_bootstrap: &mut RuntimeBootstrap,
    params: SkillsConfigWriteParams,
) -> Result<SkillsConfigWriteResponse, JSONRPCErrorError> {
    let SkillsConfigWriteParams { path, enabled } = params;
    let current = match runtime_bootstrap
        .config_storage_host
        .load_user_config(LoadUserConfigRequest {})
        .await
    {
        Ok(response) => Some(response),
        Err(error) if error.code == HostErrorCode::NotFound => None,
        Err(error) => return Err(internal_error(error.message)),
    };
    let file_path = current
        .as_ref()
        .map(|response| response.file_path.clone())
        .unwrap_or_else(|| {
            runtime_bootstrap
                .config
                .codex_home
                .join("config.toml")
                .display()
                .to_string()
        });
    let expected_version = current.as_ref().map(|response| response.version.clone());
    let mut user_config = current
        .as_ref()
        .map(|response| response.content.parse::<toml::Table>())
        .transpose()
        .map_err(|error| invalid_request_error(format!("invalid user config: {error}")))?
        .unwrap_or_default();
    write_skill_config_entry(&mut user_config, &path.display().to_string(), enabled);
    let config_value = toml::Value::Table(user_config);
    let content = toml::to_string(&config_value).map_err(internal_error)?;
    let saved = runtime_bootstrap
        .config_storage_host
        .save_user_config(SaveUserConfigRequest {
            file_path: Some(file_path.clone()),
            expected_version,
            content,
        })
        .await
        .map_err(|error| internal_error(error.message))?;
    runtime_bootstrap.config.config_layer_stack = runtime_bootstrap
        .config
        .config_layer_stack
        .clone()
        .with_user_config(file_path, config_value);
    let _ = saved;
    Ok(SkillsConfigWriteResponse {
        effective_enabled: enabled,
    })
}

fn write_skill_config_entry(user_config: &mut toml::Table, path: &str, enabled: bool) {
    let skills_value = user_config
        .entry("skills".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    let Some(skills_table) = skills_value.as_table_mut() else {
        *skills_value = toml::Value::Table(toml::Table::new());
        return write_skill_config_entry(user_config, path, enabled);
    };
    let config_value = skills_table
        .entry("config".to_string())
        .or_insert_with(|| toml::Value::Array(Vec::new()));
    let Some(config_entries) = config_value.as_array_mut() else {
        *config_value = toml::Value::Array(Vec::new());
        return write_skill_config_entry(user_config, path, enabled);
    };
    config_entries.retain(|entry| {
        entry
            .get("path")
            .and_then(toml::Value::as_str)
            .is_none_or(|entry_path| entry_path != path)
    });
    if !enabled {
        let mut entry = toml::Table::new();
        entry.insert("path".to_string(), toml::Value::String(path.to_string()));
        entry.insert("enabled".to_string(), toml::Value::Boolean(false));
        config_entries.push(toml::Value::Table(entry));
    }
    if config_entries.is_empty() {
        skills_table.remove("config");
    }
    if skills_table.is_empty() {
        user_config.remove("skills");
    }
}

fn bundled_skills_enabled(config: &codex_wasm_core::config::Config) -> bool {
    config
        .config_layer_stack
        .effective_config()
        .as_table()
        .and_then(|table| table.get("skills"))
        .and_then(toml::Value::as_table)
        .and_then(|skills| skills.get("bundled"))
        .and_then(toml::Value::as_table)
        .and_then(|bundled| bundled.get("enabled"))
        .and_then(toml::Value::as_bool)
        .unwrap_or(true)
}

fn skills_to_info(
    skills: &[codex_wasm_core::skills::SkillMetadata],
    disabled_paths: &HashSet<PathBuf>,
) -> Vec<SkillMetadata> {
    skills
        .iter()
        .map(|skill| {
            let enabled = !disabled_paths.contains(&skill.path_to_skills_md);
            SkillMetadata {
                name: skill.name.clone(),
                description: skill.description.clone(),
                short_description: skill.short_description.clone(),
                interface: skill.interface.clone().map(|interface| SkillInterface {
                    display_name: interface.display_name,
                    short_description: interface.short_description,
                    icon_small: interface.icon_small,
                    icon_large: interface.icon_large,
                    brand_color: interface.brand_color,
                    default_prompt: interface.default_prompt,
                }),
                dependencies: skill
                    .dependencies
                    .clone()
                    .map(|dependencies| SkillDependencies {
                        tools: dependencies
                            .tools
                            .into_iter()
                            .map(|tool| SkillToolDependency {
                                r#type: tool.r#type,
                                value: tool.value,
                                description: tool.description,
                                transport: tool.transport,
                                command: tool.command,
                                url: tool.url,
                            })
                            .collect(),
                    }),
                path: skill.path_to_skills_md.clone(),
                scope: skill.scope.into(),
                enabled,
            }
        })
        .collect()
}

fn errors_to_info(errors: &[SkillError]) -> Vec<SkillErrorInfo> {
    errors
        .iter()
        .map(|error| SkillErrorInfo {
            path: error.path.clone(),
            message: error.message.clone(),
        })
        .collect()
}

fn invalid_request_error(message: String) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32600,
        data: None,
        message,
    }
}

fn internal_error(error: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use codex_app_server_protocol::SkillsListExtraRootsForCwd;
    use codex_app_server_protocol::SkillsListParams;
    use codex_wasm_core::UnavailableConfigStorageHost;
    use codex_wasm_core::UnavailableMcpOauthHost;
    use pretty_assertions::assert_eq;

    use super::bundled_skills_enabled;
    use super::skills_list_response;
    use crate::RuntimeBootstrap;

    #[tokio::test(flavor = "current_thread")]
    async fn skills_list_rejects_relative_extra_roots() {
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-skills-runtime-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let bootstrap = RuntimeBootstrap {
            config: codex_wasm_core::config::Config {
                codex_home: root.clone(),
                cwd: root.clone(),
                ..codex_wasm_core::config::Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(codex_wasm_core::UnavailableHostFs),
            discoverable_apps_provider: Arc::new(
                codex_wasm_core::UnavailableDiscoverableAppsProvider,
            ),
            model_transport_host: Arc::new(codex_wasm_core::UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(codex_wasm_core::UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        };

        let error = skills_list_response(
            &bootstrap,
            SkillsListParams {
                cwds: vec![root.clone()],
                force_reload: false,
                per_cwd_extra_user_roots: Some(vec![SkillsListExtraRootsForCwd {
                    cwd: root,
                    extra_user_roots: vec![PathBuf::from("relative")],
                }]),
            },
        )
        .await
        .expect_err("relative extra roots should fail");

        assert_eq!(
            error.message,
            "skills/list perCwdExtraUserRoots extraUserRoots paths must be absolute: relative"
        );
    }

    #[test]
    fn bundled_skills_enabled_defaults_to_true() {
        assert!(bundled_skills_enabled(
            &codex_wasm_core::config::Config::default()
        ));
    }
}
