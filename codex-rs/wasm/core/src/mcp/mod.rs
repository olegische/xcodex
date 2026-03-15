pub mod auth;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use codex_protocol::mcp::Resource;
use codex_protocol::mcp::ResourceTemplate;
use codex_protocol::mcp::Tool;
use codex_protocol::protocol::McpListToolsResponseEvent;

use crate::CodexAuth;
use crate::config::Config;
use crate::config::types::McpServerConfig;
use crate::config::types::McpServerTransportConfig;
use crate::features::Feature;
use crate::plugins::PluginCapabilitySummary;
use crate::plugins::PluginsManager;

const MCP_TOOL_NAME_PREFIX: &str = "mcp";
const MCP_TOOL_NAME_DELIMITER: &str = "__";
pub(crate) const CODEX_APPS_MCP_SERVER_NAME: &str = "codex_apps";
const OPENAI_CONNECTORS_MCP_BASE_URL: &str = "https://api.openai.com";
const OPENAI_CONNECTORS_MCP_PATH: &str = "/v1/connectors/gateways/flat/mcp";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolPluginProvenance {
    plugin_display_names_by_connector_id: HashMap<String, Vec<String>>,
    plugin_display_names_by_mcp_server_name: HashMap<String, Vec<String>>,
}

impl ToolPluginProvenance {
    pub fn plugin_display_names_for_connector_id(&self, connector_id: &str) -> &[String] {
        self.plugin_display_names_by_connector_id
            .get(connector_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub fn plugin_display_names_for_mcp_server_name(&self, server_name: &str) -> &[String] {
        self.plugin_display_names_by_mcp_server_name
            .get(server_name)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    fn from_capability_summaries(capability_summaries: &[PluginCapabilitySummary]) -> Self {
        let mut tool_plugin_provenance = Self::default();
        for plugin in capability_summaries {
            for connector_id in &plugin.app_connector_ids {
                tool_plugin_provenance
                    .plugin_display_names_by_connector_id
                    .entry(connector_id.0.clone())
                    .or_default()
                    .push(plugin.display_name.clone());
            }

            for server_name in &plugin.mcp_server_names {
                tool_plugin_provenance
                    .plugin_display_names_by_mcp_server_name
                    .entry(server_name.clone())
                    .or_default()
                    .push(plugin.display_name.clone());
            }
        }

        for plugin_names in tool_plugin_provenance
            .plugin_display_names_by_connector_id
            .values_mut()
            .chain(
                tool_plugin_provenance
                    .plugin_display_names_by_mcp_server_name
                    .values_mut(),
            )
        {
            plugin_names.sort_unstable();
            plugin_names.dedup();
        }

        tool_plugin_provenance
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexAppsMcpGateway {
    LegacyMCPGateway,
    MCPGateway,
}

fn selected_config_codex_apps_mcp_gateway(config: &Config) -> CodexAppsMcpGateway {
    if config.features.enabled(Feature::AppsMcpGateway) {
        CodexAppsMcpGateway::MCPGateway
    } else {
        CodexAppsMcpGateway::LegacyMCPGateway
    }
}

fn normalize_codex_apps_base_url(base_url: &str) -> String {
    let mut base_url = base_url.trim_end_matches('/').to_string();
    if (base_url.starts_with("https://chatgpt.com")
        || base_url.starts_with("https://chat.openai.com"))
        && !base_url.contains("/backend-api")
    {
        base_url = format!("{base_url}/backend-api");
    }
    base_url
}

fn codex_apps_mcp_url_for_gateway(base_url: &str, gateway: CodexAppsMcpGateway) -> String {
    if gateway == CodexAppsMcpGateway::MCPGateway {
        return format!("{OPENAI_CONNECTORS_MCP_BASE_URL}{OPENAI_CONNECTORS_MCP_PATH}");
    }

    let base_url = normalize_codex_apps_base_url(base_url);
    if base_url.contains("/backend-api") {
        format!("{base_url}/wham/apps")
    } else if base_url.contains("/api/codex") {
        format!("{base_url}/apps")
    } else {
        format!("{base_url}/api/codex/apps")
    }
}

pub(crate) fn codex_apps_mcp_url(config: &Config) -> String {
    codex_apps_mcp_url_for_gateway(
        &config.chatgpt_base_url,
        selected_config_codex_apps_mcp_gateway(config),
    )
}

fn codex_apps_mcp_bearer_token(auth: Option<&CodexAuth>) -> Option<String> {
    let token = auth.and_then(|auth| auth.get_token().ok())?;
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn codex_apps_mcp_http_headers(auth: Option<&CodexAuth>) -> Option<HashMap<String, String>> {
    let mut headers = HashMap::new();
    if let Some(token) = codex_apps_mcp_bearer_token(auth) {
        headers.insert("Authorization".to_string(), format!("Bearer {token}"));
    }
    if let Some(account_id) = auth.and_then(CodexAuth::get_account_id) {
        headers.insert("ChatGPT-Account-ID".to_string(), account_id);
    }
    if headers.is_empty() {
        None
    } else {
        Some(headers)
    }
}

fn codex_apps_mcp_server_config(config: &Config, auth: Option<&CodexAuth>) -> McpServerConfig {
    McpServerConfig {
        transport: McpServerTransportConfig::StreamableHttp {
            url: codex_apps_mcp_url(config),
            bearer_token_env_var: None,
            http_headers: codex_apps_mcp_http_headers(auth),
            env_http_headers: None,
        },
        enabled: true,
        required: false,
        disabled_reason: None,
        startup_timeout_sec: Some(Duration::from_secs(30)),
        tool_timeout_sec: None,
        enabled_tools: None,
        disabled_tools: None,
        scopes: None,
        oauth_resource: None,
    }
}

pub(crate) fn with_codex_apps_mcp(
    mut servers: HashMap<String, McpServerConfig>,
    connectors_enabled: bool,
    auth: Option<&CodexAuth>,
    config: &Config,
) -> HashMap<String, McpServerConfig> {
    if connectors_enabled {
        servers.insert(
            CODEX_APPS_MCP_SERVER_NAME.to_string(),
            codex_apps_mcp_server_config(config, auth),
        );
    } else {
        servers.remove(CODEX_APPS_MCP_SERVER_NAME);
    }
    servers
}

pub struct McpManager {
    plugins_manager: Arc<PluginsManager>,
}

impl McpManager {
    pub fn new(plugins_manager: Arc<PluginsManager>) -> Self {
        Self { plugins_manager }
    }

    pub fn configured_servers(&self, config: &Config) -> HashMap<String, McpServerConfig> {
        let loaded_plugins = self.plugins_manager.plugins_for_config(config);
        let mut servers = config.mcp_servers.get().clone();
        for (name, plugin_server) in loaded_plugins.effective_mcp_servers() {
            servers.entry(name).or_insert(plugin_server);
        }
        servers
    }

    pub fn effective_servers(
        &self,
        config: &Config,
        auth: Option<&CodexAuth>,
    ) -> HashMap<String, McpServerConfig> {
        let servers = self.configured_servers(config);
        with_codex_apps_mcp(
            servers,
            config.features.apps_enabled_for_auth(auth),
            auth,
            config,
        )
    }

    pub fn tool_plugin_provenance(&self, config: &Config) -> ToolPluginProvenance {
        let loaded_plugins = self.plugins_manager.plugins_for_config(config);
        ToolPluginProvenance::from_capability_summaries(loaded_plugins.capability_summaries())
    }
}

pub async fn maybe_prompt_and_install_mcp_dependencies(
    _session: &crate::codex::Session,
    _turn_context: &crate::codex::TurnContext,
    _cancellation_token: &tokio_util::sync::CancellationToken,
    _mentioned_skills: &[crate::skills::model::SkillMetadata],
) -> anyhow::Result<()> {
    Ok(())
}

pub fn split_qualified_tool_name(qualified_name: &str) -> Option<(String, String)> {
    let mut parts = qualified_name.split(MCP_TOOL_NAME_DELIMITER);
    let prefix = parts.next()?;
    if prefix != MCP_TOOL_NAME_PREFIX {
        return None;
    }
    let server_name = parts.next()?;
    let tool_name: String = parts.collect::<Vec<_>>().join(MCP_TOOL_NAME_DELIMITER);
    if tool_name.is_empty() {
        return None;
    }
    Some((server_name.to_string(), tool_name))
}

pub fn group_tools_by_server(
    tools: &HashMap<String, Tool>,
) -> HashMap<String, HashMap<String, Tool>> {
    let mut grouped = HashMap::new();
    for (qualified_name, tool) in tools {
        if let Some((server_name, tool_name)) = split_qualified_tool_name(qualified_name) {
            grouped
                .entry(server_name)
                .or_insert_with(HashMap::new)
                .insert(tool_name, tool.clone());
        }
    }
    grouped
}

pub(crate) async fn collect_mcp_snapshot_from_manager(
    _mcp_connection_manager: &crate::mcp_connection_manager::McpConnectionManager,
    auth_status_entries: HashMap<String, crate::mcp::auth::McpAuthStatusEntry>,
) -> McpListToolsResponseEvent {
    let auth_statuses = auth_status_entries
        .iter()
        .map(|(name, entry)| (name.clone(), entry.auth_status))
        .collect();

    McpListToolsResponseEvent {
        tools: HashMap::<String, Tool>::new(),
        resources: HashMap::<String, Vec<Resource>>::new(),
        resource_templates: HashMap::<String, Vec<ResourceTemplate>>::new(),
        auth_statuses,
    }
}
