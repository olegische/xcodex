use std::collections::HashMap;
use std::path::PathBuf;

use crate::config::Config;
use crate::config::types::McpServerConfig;
use codex_protocol::models::ResponseItem;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PluginCapabilitySummary {
    pub config_name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub has_skills: bool,
    pub app_connector_ids: Vec<AppConnectorId>,
    pub mcp_server_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AppConnectorId(pub String);

#[derive(Debug, Clone, Default)]
pub struct LoadedPlugins {
    capability_summaries: Vec<PluginCapabilitySummary>,
    effective_mcp_servers: HashMap<String, McpServerConfig>,
}

impl LoadedPlugins {
    pub fn capability_summaries(&self) -> &[PluginCapabilitySummary] {
        &self.capability_summaries
    }

    pub fn effective_skill_roots(&self) -> Vec<PathBuf> {
        Vec::new()
    }

    pub fn effective_mcp_servers(&self) -> HashMap<String, McpServerConfig> {
        self.effective_mcp_servers.clone()
    }

    pub fn effective_apps(&self) -> Vec<AppConnectorId> {
        Vec::new()
    }
}

#[derive(Debug, Clone)]
pub struct PluginsManager {
    _codex_home: PathBuf,
}

impl PluginsManager {
    pub fn new(codex_home: PathBuf) -> Self {
        Self {
            _codex_home: codex_home,
        }
    }

    pub fn plugins_for_config(&self, _config: &Config) -> LoadedPlugins {
        LoadedPlugins::default()
    }

    pub fn clear_cache(&self) {}
}

pub fn build_plugin_injections(
    _mentioned_plugins: &[PluginCapabilitySummary],
    _mcp_tools: &HashMap<String, crate::mcp_connection_manager::ToolInfo>,
    _available_connectors: &[crate::connectors::AppInfo],
) -> Vec<ResponseItem> {
    Vec::new()
}
