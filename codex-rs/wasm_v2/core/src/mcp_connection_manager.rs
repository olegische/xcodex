use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::compat::rmcp::ListResourceTemplatesResult;
use crate::compat::rmcp::ListResourcesResult;
use crate::compat::rmcp::PaginatedRequestParams;
use crate::compat::rmcp::ReadResourceRequestParams;
use crate::compat::rmcp::ReadResourceResult;
use crate::compat::rmcp::RequestId;
use crate::compat::rmcp::Resource;
use crate::compat::rmcp::ResourceTemplate;
use crate::compat::rmcp::Tool;
use async_channel::Sender;
use codex_protocol::mcp::CallToolResult;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::SandboxPolicy;
use tokio_util::sync::CancellationToken;

use crate::compat::rmcp::ElicitationResponse;
use crate::compat::rmcp::OAuthCredentialsStoreMode;
use crate::config::Constrained;
use crate::config::types::McpServerConfig;
use crate::mcp::ToolPluginProvenance;

#[derive(Debug, Clone)]
pub struct SandboxState {
    pub sandbox_policy: SandboxPolicy,
    pub codex_linux_sandbox_exe: Option<PathBuf>,
    pub sandbox_cwd: PathBuf,
    pub use_legacy_landlock: bool,
}

#[derive(Debug, Clone)]
pub struct ToolInfo {
    pub server_name: String,
    pub tool_name: String,
    pub tool_namespace: String,
    pub tool: Tool,
    pub connector_id: Option<String>,
    pub connector_name: Option<String>,
    pub plugin_display_names: Vec<String>,
    pub connector_description: Option<String>,
}

impl Default for ToolInfo {
    fn default() -> Self {
        Self {
            server_name: String::new(),
            tool_name: String::new(),
            tool_namespace: String::new(),
            tool: Tool {
                name: String::new(),
                description: None,
                input_schema: Arc::new(serde_json::Map::new()),
                annotations: None,
                meta: None,
                output_schema: None,
                icons: None,
                title: None,
                execution: None,
            },
            connector_id: None,
            connector_name: None,
            plugin_display_names: Vec::new(),
            connector_description: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CodexAppsToolsCacheKey {
    pub account_id: Option<String>,
    pub chatgpt_user_id: Option<String>,
    pub is_workspace_account: bool,
}

pub fn codex_apps_tools_cache_key(_auth: Option<&crate::CodexAuth>) -> CodexAppsToolsCacheKey {
    CodexAppsToolsCacheKey::default()
}

pub fn filter_non_codex_apps_mcp_tools_only(
    tools: &HashMap<String, ToolInfo>,
) -> HashMap<String, ToolInfo> {
    tools.clone()
}

#[derive(Debug, Default)]
pub struct McpConnectionManager;

impl McpConnectionManager {
    pub fn new_uninitialized(_approval_policy: &Constrained<AskForApproval>) -> Self {
        Self
    }

    pub async fn new(
        _mcp_servers: &HashMap<String, McpServerConfig>,
        _store_mode: OAuthCredentialsStoreMode,
        _auth_statuses: HashMap<String, crate::mcp::auth::McpAuthStatusEntry>,
        _approval_policy: &Constrained<AskForApproval>,
        _tx_event: Sender<Event>,
        _sandbox_state: SandboxState,
        _codex_home: PathBuf,
        _cache_key: CodexAppsToolsCacheKey,
        _tool_plugin_provenance: ToolPluginProvenance,
    ) -> (Self, CancellationToken) {
        (Self, CancellationToken::new())
    }

    pub fn new_mcp_connection_manager_for_tests(
        _approval_policy: &Constrained<AskForApproval>,
    ) -> Self {
        Self
    }

    pub async fn list_all_tools(&self) -> HashMap<String, ToolInfo> {
        HashMap::new()
    }

    pub fn has_servers(&self) -> bool {
        false
    }

    pub async fn list_all_resources(&self) -> HashMap<String, Vec<Resource>> {
        HashMap::new()
    }

    pub async fn list_all_resource_templates(&self) -> HashMap<String, Vec<ResourceTemplate>> {
        HashMap::new()
    }

    pub async fn list_resources(
        &self,
        _server: &str,
        _params: Option<PaginatedRequestParams>,
    ) -> anyhow::Result<ListResourcesResult> {
        Ok(ListResourcesResult {
            resources: Vec::new(),
            next_cursor: None,
            meta: None,
        })
    }

    pub async fn list_resource_templates(
        &self,
        _server: &str,
        _params: Option<PaginatedRequestParams>,
    ) -> anyhow::Result<ListResourceTemplatesResult> {
        Ok(ListResourceTemplatesResult {
            resource_templates: Vec::new(),
            next_cursor: None,
            meta: None,
        })
    }

    pub async fn read_resource(
        &self,
        _server: &str,
        _params: ReadResourceRequestParams,
    ) -> anyhow::Result<ReadResourceResult> {
        Ok(ReadResourceResult {
            contents: Vec::new(),
        })
    }

    pub async fn call_tool(
        &self,
        _server: &str,
        _tool: &str,
        _arguments: Option<serde_json::Value>,
    ) -> anyhow::Result<CallToolResult> {
        Ok(CallToolResult::from_error_text(
            "mcp tool execution is not implemented in wasm_v2 yet".to_string(),
        ))
    }

    pub async fn parse_tool_name(&self, _tool_name: &str) -> Option<(String, String)> {
        None
    }

    pub async fn required_startup_failures(
        &self,
        _required_mcp_servers: &[String],
    ) -> Vec<McpStartupFailure> {
        Vec::new()
    }

    pub async fn resolve_elicitation(
        &self,
        _server_name: String,
        _id: RequestId,
        _response: ElicitationResponse,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    pub fn set_approval_policy(&self, _approval_policy: &Constrained<AskForApproval>) {}

    pub async fn notify_sandbox_state_change(
        &self,
        _sandbox_state: &SandboxState,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct McpStartupFailure {
    pub server: String,
    pub error: String,
}
