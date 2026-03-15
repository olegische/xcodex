use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
pub use codex_app_server_protocol::AppInfo;

use crate::config::Config;
use crate::plugins::AppConnectorId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct AppToolPolicy {
    pub enabled: bool,
}

pub fn connector_display_label(connector: &AppInfo) -> String {
    connector.name.clone()
}

pub fn connector_mention_slug(connector: &AppInfo) -> String {
    sanitize_name(&connector_display_label(connector))
}

pub(crate) fn accessible_connectors_from_mcp_tools(
    mcp_tools: &HashMap<String, crate::mcp_connection_manager::ToolInfo>,
) -> Vec<AppInfo> {
    let mut connectors = HashMap::<String, AppInfo>::new();
    for tool in mcp_tools.values() {
        let Some(connector_id) = tool.connector_id.clone() else {
            continue;
        };
        let name = tool
            .connector_name
            .clone()
            .unwrap_or_else(|| connector_id.clone());
        connectors
            .entry(connector_id.clone())
            .or_insert_with(|| AppInfo {
                id: connector_id.clone(),
                name: name.clone(),
                description: tool.connector_description.clone(),
                logo_url: None,
                logo_url_dark: None,
                distribution_channel: None,
                branding: None,
                app_metadata: None,
                labels: None,
                install_url: Some(connector_install_url(&name, &connector_id)),
                is_accessible: true,
                is_enabled: true,
                plugin_display_names: tool.plugin_display_names.clone(),
            });
    }
    let mut connectors = connectors.into_values().collect::<Vec<_>>();
    connectors.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    connectors
}

pub fn merge_plugin_apps_with_accessible(
    plugin_apps: Vec<AppConnectorId>,
    accessible_connectors: Vec<AppInfo>,
) -> Vec<AppInfo> {
    let accessible_connector_ids = accessible_connectors
        .iter()
        .map(|connector| connector.id.clone())
        .collect::<std::collections::HashSet<_>>();

    let mut merged = accessible_connectors;
    for connector_id in plugin_apps {
        if accessible_connector_ids.contains(&connector_id.0) {
            continue;
        }
        merged.push(AppInfo {
            id: connector_id.0.clone(),
            name: connector_id.0.clone(),
            description: None,
            logo_url: None,
            logo_url_dark: None,
            distribution_channel: None,
            branding: None,
            app_metadata: None,
            labels: None,
            install_url: Some(connector_install_url(&connector_id.0, &connector_id.0)),
            is_accessible: false,
            is_enabled: false,
            plugin_display_names: Vec::new(),
        });
    }
    merged.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    merged
}

pub fn with_app_enabled_state(mut connectors: Vec<AppInfo>, _config: &Config) -> Vec<AppInfo> {
    for connector in &mut connectors {
        connector.is_enabled = true;
    }
    connectors
}

#[async_trait]
pub(crate) trait DiscoverableAppsProvider: Send + Sync {
    async fn list_discoverable_apps(&self) -> anyhow::Result<Vec<AppInfo>>;
}

#[derive(Debug, Default)]
pub(crate) struct UnavailableDiscoverableAppsProvider;

#[async_trait]
impl DiscoverableAppsProvider for UnavailableDiscoverableAppsProvider {
    async fn list_discoverable_apps(&self) -> anyhow::Result<Vec<AppInfo>> {
        Ok(Vec::new())
    }
}

pub(crate) async fn list_tool_suggest_discoverable_tools(
    provider: Arc<dyn DiscoverableAppsProvider>,
    accessible_connectors: &[AppInfo],
) -> anyhow::Result<Vec<AppInfo>> {
    let directory_connectors = provider.list_discoverable_apps().await?;
    Ok(filter_tool_suggest_discoverable_tools(
        directory_connectors,
        accessible_connectors,
    ))
}

fn filter_tool_suggest_discoverable_tools(
    directory_connectors: Vec<AppInfo>,
    accessible_connectors: &[AppInfo],
) -> Vec<AppInfo> {
    let accessible_connector_ids: HashSet<&str> = accessible_connectors
        .iter()
        .filter(|connector| connector.is_accessible && connector.is_enabled)
        .map(|connector| connector.id.as_str())
        .collect();

    let mut connectors = directory_connectors
        .into_iter()
        .filter(|connector| !accessible_connector_ids.contains(connector.id.as_str()))
        .collect::<Vec<_>>();
    connectors.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.id.cmp(&right.id))
    });
    connectors
}

pub(crate) fn codex_app_tool_is_enabled(
    _config: &Config,
    tool_info: &crate::mcp_connection_manager::ToolInfo,
) -> bool {
    tool_info.connector_id.is_some()
}

pub fn connector_install_url(name: &str, connector_id: &str) -> String {
    let slug = sanitize_name(name);
    format!("https://chatgpt.com/apps/{slug}/{connector_id}")
}

pub fn sanitize_name(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character.to_ascii_lowercase());
        } else {
            normalized.push('-');
        }
    }
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "app".to_string()
    } else {
        normalized.to_string()
    }
}
