use std::sync::Arc;

use super::BrowserCodexSpawnArgs;
use super::Codex;
use super::CodexSpawnArgs;
use super::CodexSpawnOk;
use crate::AuthManager;
use crate::agent::AgentControl;
use crate::error::Result as CodexResult;
use crate::features::Feature;
use crate::file_watcher::FileWatcher;
use crate::mcp::McpManager;
use crate::models_manager::collaboration_mode_presets::CollaborationModesConfig;
use crate::models_manager::manager::ModelsManager;
use crate::plugins::PluginsManager;
use crate::skills::SkillsManager;

pub async fn spawn_browser_codex(args: BrowserCodexSpawnArgs) -> CodexResult<CodexSpawnOk> {
    let BrowserCodexSpawnArgs {
        config,
        auth,
        model_catalog,
        conversation_history,
        session_source,
        dynamic_tools,
        persist_extended_history,
        metrics_service_name,
        inherited_shell_snapshot,
        parent_trace,
        browser_fs,
        discoverable_apps_provider,
        model_transport_host,
    } = args;

    let auth_manager = AuthManager::from_auth(config.codex_home.clone(), auth);
    let models_manager = Arc::new(ModelsManager::new(
        config.codex_home.clone(),
        Arc::clone(&auth_manager),
        model_catalog,
        CollaborationModesConfig::from_features(&config.features),
    ));
    let plugins_manager = Arc::new(PluginsManager::new(config.codex_home.clone()));
    let skills_manager = Arc::new(SkillsManager::new(
        config.codex_home.clone(),
        Arc::clone(&plugins_manager),
        true,
    ));
    let mcp_manager = Arc::new(McpManager::new(Arc::clone(&plugins_manager)));
    let file_watcher = Arc::new(FileWatcher::noop());

    Codex::spawn(CodexSpawnArgs {
        config: normalize_browser_spawn_config(config),
        auth_manager,
        models_manager,
        skills_manager,
        plugins_manager,
        mcp_manager,
        file_watcher,
        conversation_history,
        session_source,
        agent_control: AgentControl,
        dynamic_tools,
        persist_extended_history,
        metrics_service_name,
        inherited_shell_snapshot,
        parent_trace,
        browser_fs,
        discoverable_apps_provider,
        model_transport_host,
    })
    .await
}

fn normalize_browser_spawn_config(mut config: crate::config::Config) -> crate::config::Config {
    let _ = config.features.disable(Feature::CodeMode);
    let _ = config.features.disable(Feature::JsRepl);
    let _ = config.features.disable(Feature::JsReplToolsOnly);
    let _ = config.features.disable(Feature::ShellZshFork);

    if config.cwd.as_os_str().is_empty() {
        config.cwd = config.codex_home.clone();
    }
    if config
        .base_instructions
        .as_ref()
        .is_some_and(|instructions| instructions.trim().is_empty())
    {
        config.base_instructions = None;
    }
    config
}
