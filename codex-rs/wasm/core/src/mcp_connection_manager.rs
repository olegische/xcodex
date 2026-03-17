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
use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(target_arch = "wasm32")]
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use crate::compat::rmcp::ElicitationResponse;
use crate::compat::rmcp::OAuthCredentialsStoreMode;
use crate::config::Constrained;
use crate::config::types::McpServerConfig;
#[cfg(target_arch = "wasm32")]
use crate::config::types::McpServerTransportConfig;
use crate::mcp::ToolPluginProvenance;
#[cfg(target_arch = "wasm32")]
use crate::tools::browser_host::McpOauthHost;

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
                name: String::new().into(),
                description: None,
                input_schema: serde_json::Map::new().into(),
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

#[derive(Debug, Clone)]
pub struct McpStartupFailure {
    pub server: String,
    pub error: String,
}

const MCP_TOOL_NAME_DELIMITER: &str = "__";
const MAX_TOOL_NAME_LENGTH: usize = 64;

fn sanitize_responses_api_tool_name(name: &str) -> String {
    let mut sanitized = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            sanitized.push(c);
        } else {
            sanitized.push('_');
        }
    }

    if sanitized.is_empty() {
        "_".to_string()
    } else {
        sanitized
    }
}

fn qualify_tools<I>(tools: I) -> HashMap<String, ToolInfo>
where
    I: IntoIterator<Item = ToolInfo>,
{
    let mut qualified_tools = HashMap::new();
    for tool in tools {
        let qualified_name_raw = format!(
            "mcp{MCP_TOOL_NAME_DELIMITER}{}{MCP_TOOL_NAME_DELIMITER}{}",
            tool.server_name, tool.tool_name
        );
        let mut qualified_name = sanitize_responses_api_tool_name(&qualified_name_raw);
        if qualified_name.len() > MAX_TOOL_NAME_LENGTH {
            qualified_name.truncate(MAX_TOOL_NAME_LENGTH);
        }
        qualified_tools.insert(qualified_name, tool);
    }
    qualified_tools
}

#[derive(Default, Clone)]
pub(crate) struct ToolFilter {
    enabled: Option<std::collections::HashSet<String>>,
    disabled: std::collections::HashSet<String>,
}

impl ToolFilter {
    fn from_config(cfg: &McpServerConfig) -> Self {
        let enabled = cfg.enabled_tools.as_ref().map(|tools| {
            tools
                .iter()
                .cloned()
                .collect::<std::collections::HashSet<_>>()
        });
        let disabled = cfg
            .disabled_tools
            .as_ref()
            .map(|tools| {
                tools
                    .iter()
                    .cloned()
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        Self { enabled, disabled }
    }

    fn allows(&self, tool_name: &str) -> bool {
        if let Some(enabled) = &self.enabled
            && !enabled.contains(tool_name)
        {
            return false;
        }
        !self.disabled.contains(tool_name)
    }
}

fn filter_tools(tools: Vec<ToolInfo>, filter: &ToolFilter) -> Vec<ToolInfo> {
    tools
        .into_iter()
        .filter(|tool| filter.allows(tool.tool.name.as_ref()))
        .collect()
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
struct ManagedClient {
    client: WasmMcpClient,
    tool_filter: ToolFilter,
    tool_timeout: Option<Duration>,
    tool_plugin_provenance: ToolPluginProvenance,
}

#[cfg(target_arch = "wasm32")]
impl ManagedClient {
    async fn listed_tools(&self) -> anyhow::Result<Vec<ToolInfo>> {
        let tools = self.client.list_tools(self.tool_timeout).await?;
        Ok(filter_tools(
            tools
                .into_iter()
                .map(|tool| {
                    tool_info_from_tool(
                        &self.client.server_name,
                        tool,
                        &self.tool_plugin_provenance,
                    )
                })
                .collect(),
            &self.tool_filter,
        ))
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
struct WasmMcpClient {
    server_name: String,
    url: String,
    default_headers: HashMap<String, String>,
    session_id: std::sync::Arc<tokio::sync::Mutex<Option<String>>>,
    initialized: std::sync::Arc<tokio::sync::Mutex<bool>>,
    init_lock: std::sync::Arc<tokio::sync::Mutex<()>>,
    mcp_oauth_host: std::sync::Arc<dyn McpOauthHost>,
}

#[cfg(target_arch = "wasm32")]
impl WasmMcpClient {
    fn new(
        server_name: String,
        url: String,
        default_headers: HashMap<String, String>,
        mcp_oauth_host: std::sync::Arc<dyn McpOauthHost>,
    ) -> Self {
        Self {
            server_name,
            url,
            default_headers,
            session_id: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
            initialized: std::sync::Arc::new(tokio::sync::Mutex::new(false)),
            init_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
            mcp_oauth_host,
        }
    }

    async fn ensure_initialized(&self, timeout: Option<Duration>) -> anyhow::Result<()> {
        if *self.initialized.lock().await {
            return Ok(());
        }

        let _guard = self.init_lock.lock().await;
        if *self.initialized.lock().await {
            return Ok(());
        }

        let result = self
            .post_json_rpc(
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2025-11-25",
                    "capabilities": {
                        "tools": {},
                        "resources": {}
                    },
                    "clientInfo": {
                        "name": "codex-wasm-browser",
                        "version": "0.0.0"
                    }
                }),
                timeout,
                true,
            )
            .await?;

        if result
            .get("protocolVersion")
            .and_then(serde_json::Value::as_str)
            .is_none()
        {
            return Err(anyhow::anyhow!(
                "initialize for '{}' did not return protocolVersion",
                self.server_name
            ));
        }

        self.post_notification("notifications/initialized", None)
            .await?;
        *self.initialized.lock().await = true;
        Ok(())
    }

    async fn list_tools(&self, timeout: Option<Duration>) -> anyhow::Result<Vec<Tool>> {
        self.ensure_initialized(timeout).await?;
        let result = self
            .post_json_rpc("tools/list", serde_json::json!({}), timeout, false)
            .await?;
        let tools = result
            .get("tools")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
        serde_json::from_value::<Vec<Tool>>(tools)
            .map_err(|error| anyhow::anyhow!("failed to parse tools/list result: {error}"))
    }

    async fn call_tool(
        &self,
        tool_name: &str,
        arguments: Option<serde_json::Value>,
        timeout: Option<Duration>,
    ) -> anyhow::Result<CallToolResult> {
        self.ensure_initialized(timeout).await?;
        let result = self
            .post_json_rpc(
                "tools/call",
                serde_json::json!({
                    "name": tool_name,
                    "arguments": match arguments {
                        Some(serde_json::Value::Object(map)) => serde_json::Value::Object(map),
                        Some(other) => {
                            return Err(anyhow::anyhow!(
                                "MCP tool arguments must be a JSON object, got {other}"
                            ));
                        }
                        None => serde_json::Value::Null,
                    }
                }),
                timeout,
                false,
            )
            .await?;

        let content = result
            .get("content")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(CallToolResult {
            content,
            structured_content: result.get("structuredContent").cloned(),
            is_error: Some(
                result
                    .get("isError")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            ),
            meta: result.get("_meta").cloned(),
        })
    }

    async fn post_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params.unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
        });
        let _ = self.fetch_json(payload, None, false).await?;
        Ok(())
    }

    async fn post_json_rpc(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout: Option<Duration>,
        allow_uninitialized: bool,
    ) -> anyhow::Result<serde_json::Value> {
        if !allow_uninitialized && !*self.initialized.lock().await {
            return Err(anyhow::anyhow!(
                "MCP server '{}' is not initialized",
                self.server_name
            ));
        }
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": next_request_id(),
            "method": method,
            "params": params,
        });
        let value = self.fetch_json(payload, timeout, true).await?;
        if let Some(error) = value.get("error") {
            return Err(anyhow::anyhow!(
                "MCP method '{}' failed for '{}': {}",
                method,
                self.server_name,
                error
            ));
        }
        value
            .get("result")
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("MCP method '{method}' did not return result"))
    }

    async fn fetch_json(
        &self,
        payload: serde_json::Value,
        timeout: Option<Duration>,
        expect_json_response: bool,
    ) -> anyhow::Result<serde_json::Value> {
        let future = self.fetch_json_inner(payload, expect_json_response);
        if let Some(timeout) = timeout {
            tokio::time::timeout(timeout, future).await.map_err(|_| {
                anyhow::anyhow!("timed out talking to MCP server '{}'", self.server_name)
            })?
        } else {
            future.await
        }
    }

    async fn fetch_json_inner(
        &self,
        payload: serde_json::Value,
        expect_json_response: bool,
    ) -> anyhow::Result<serde_json::Value> {
        use js_sys::Reflect;
        use wasm_bindgen::JsCast;
        use wasm_bindgen::JsValue;
        use wasm_bindgen_futures::JsFuture;
        use web_sys::Headers;
        use web_sys::Request;
        use web_sys::RequestInit;
        use web_sys::RequestMode;
        use web_sys::Response;

        let window =
            web_sys::window().ok_or_else(|| anyhow::anyhow!("browser window is unavailable"))?;
        let headers = Headers::new().map_err(js_error)?;
        headers
            .set("content-type", "application/json")
            .map_err(js_error)?;
        headers
            .set("accept", "application/json, text/event-stream")
            .map_err(js_error)?;
        headers
            .set("MCP-Protocol-Version", "2025-11-25")
            .map_err(js_error)?;

        let resolved_headers = self.resolved_headers().await?;
        let has_authorization = resolved_headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("authorization"));
        for (key, value) in resolved_headers {
            headers
                .set(key.as_str(), value.as_str())
                .map_err(js_error)?;
        }

        if let Some(session_id) = self.session_id.lock().await.clone() {
            headers
                .set("Mcp-Session-Id", session_id.as_str())
                .map_err(js_error)?;
        }

        let request_init = RequestInit::new();
        request_init.set_method("POST");
        request_init.set_mode(RequestMode::Cors);
        request_init.set_headers(&headers);
        request_init.set_body(&JsValue::from_str(&serde_json::to_string(&payload)?));
        let request =
            Request::new_with_str_and_init(self.url.as_str(), &request_init).map_err(js_error)?;

        let value = JsFuture::from(window.fetch_with_request(&request))
            .await
            .map_err(js_error)?;
        let response = value.dyn_into::<Response>().map_err(js_error)?;

        if let Some(session_id) = response.headers().get("Mcp-Session-Id").map_err(js_error)? {
            *self.session_id.lock().await = Some(session_id);
        }

        if !response.ok() {
            wasm_mcp_debug(format!(
                "fetch_json_inner:http_error server={}, status={}, has_authorization={has_authorization}",
                self.server_name,
                response.status(),
            ));
            return Err(anyhow::anyhow!(
                "HTTP {} while talking to MCP server '{}'",
                response.status(),
                self.server_name
            ));
        }
        if !expect_json_response || response.status() == 202 || response.status() == 204 {
            return Ok(serde_json::Value::Null);
        }

        let json = JsFuture::from(response.json().map_err(js_error)?)
            .await
            .map_err(js_error)?;
        let value = Reflect::get(&json, &JsValue::from_str("result"))
            .ok()
            .and_then(|_| serde_wasm_bindgen::from_value::<serde_json::Value>(json).ok())
            .ok_or_else(|| anyhow::anyhow!("failed to decode MCP response JSON"))?;
        Ok(value)
    }

    async fn resolved_headers(&self) -> anyhow::Result<HashMap<String, String>> {
        Ok(self.default_headers.clone())
    }
}

#[cfg(target_arch = "wasm32")]
fn tool_info_from_tool(
    server_name: &str,
    tool: Tool,
    tool_plugin_provenance: &ToolPluginProvenance,
) -> ToolInfo {
    let connector_id = tool
        .meta
        .as_ref()
        .and_then(|meta| meta.get("connector_id"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let connector_name = tool
        .meta
        .as_ref()
        .and_then(|meta| {
            meta.get("connector_name")
                .or_else(|| meta.get("connector_display_name"))
        })
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let connector_description = tool
        .meta
        .as_ref()
        .and_then(|meta| {
            meta.get("connector_description")
                .or_else(|| meta.get("connectorDescription"))
        })
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let plugin_display_names = match connector_id.as_deref() {
        Some(connector_id) => tool_plugin_provenance
            .plugin_display_names_for_connector_id(connector_id)
            .to_vec(),
        None => tool_plugin_provenance
            .plugin_display_names_for_mcp_server_name(server_name)
            .to_vec(),
    };

    ToolInfo {
        server_name: server_name.to_string(),
        tool_name: tool.name.clone(),
        tool_namespace: "mcp".to_string(),
        tool,
        connector_id,
        connector_name,
        plugin_display_names,
        connector_description,
    }
}

#[cfg(target_arch = "wasm32")]
fn next_request_id() -> i64 {
    use std::sync::atomic::AtomicI64;
    use std::sync::atomic::Ordering;

    static NEXT_REQUEST_ID: AtomicI64 = AtomicI64::new(1);
    NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

#[cfg(target_arch = "wasm32")]
fn js_error(error: wasm_bindgen::JsValue) -> anyhow::Error {
    anyhow::anyhow!(error.as_string().unwrap_or_else(|| "js error".to_string()))
}

#[cfg(target_arch = "wasm32")]
fn wasm_mcp_debug(message: String) {
    web_sys::console::info_1(&wasm_bindgen::JsValue::from_str(&format!(
        "[wasm-mcp] {message}"
    )));
}

#[cfg(target_arch = "wasm32")]
fn mask_secret_middle(value: &str) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let len = chars.len();
    if len <= 12 {
        return "*".repeat(len.max(1));
    }
    let prefix = chars[..6].iter().collect::<String>();
    let suffix = chars[len - 6..].iter().collect::<String>();
    format!("{prefix}...{suffix}")
}

#[cfg(target_arch = "wasm32")]
fn resolved_transport_headers(
    config: &McpServerConfig,
) -> anyhow::Result<(String, HashMap<String, String>)> {
    match &config.transport {
        McpServerTransportConfig::StreamableHttp {
            url,
            bearer_token_env_var,
            http_headers,
            env_http_headers,
        } => {
            let mut headers = http_headers.clone().unwrap_or_default();
            if let Some(env_headers) = env_http_headers {
                for (header, env_name) in env_headers {
                    if let Ok(value) = std::env::var(env_name)
                        && !value.trim().is_empty()
                    {
                        headers.insert(header.to_string(), value);
                    }
                }
            }
            if let Some(env_name) = bearer_token_env_var
                && let Ok(token) = std::env::var(env_name)
                && !token.trim().is_empty()
            {
                headers
                    .entry("Authorization".to_string())
                    .or_insert_with(|| format!("Bearer {token}"));
            }
            Ok((url.clone(), headers))
        }
        McpServerTransportConfig::Stdio { .. } => Err(anyhow::anyhow!(
            "stdio MCP servers are not supported in wasm browser runtime"
        )),
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Default)]
pub struct McpConnectionManager {
    clients: HashMap<String, ManagedClient>,
    startup_failures: HashMap<String, String>,
}

#[cfg(target_arch = "wasm32")]
impl McpConnectionManager {
    pub fn new_uninitialized(_approval_policy: &Constrained<AskForApproval>) -> Self {
        Self::default()
    }

    pub fn new_mcp_connection_manager_for_tests(
        _approval_policy: &Constrained<AskForApproval>,
    ) -> Self {
        Self::default()
    }

    #[allow(clippy::too_many_arguments)]
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
        _mcp_oauth_host: std::sync::Arc<dyn McpOauthHost>,
    ) -> (Self, CancellationToken) {
        (Self::default(), CancellationToken::new())
    }

    pub fn has_servers(&self) -> bool {
        false
    }

    pub async fn list_all_tools(&self) -> HashMap<String, ToolInfo> {
        HashMap::new()
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
            "mcp tool execution is not implemented in wasm runtime".to_string(),
        ))
    }

    pub async fn parse_tool_name(&self, tool_name: &str) -> Option<(String, String)> {
        let _ = tool_name;
        None
    }

    pub async fn required_startup_failures(
        &self,
        required_mcp_servers: &[String],
    ) -> Vec<McpStartupFailure> {
        required_mcp_servers
            .iter()
            .filter_map(|server_name| {
                self.startup_failures
                    .get(server_name)
                    .map(|error| McpStartupFailure {
                        server: server_name.clone(),
                        error: error.clone(),
                    })
            })
            .collect()
    }

    pub async fn resolve_elicitation(
        &self,
        _server_name: String,
        _id: RequestId,
        _response: ElicitationResponse,
    ) -> anyhow::Result<()> {
        Err(anyhow::anyhow!(
            "MCP elicitations are not implemented in wasm yet"
        ))
    }

    pub fn set_approval_policy(&self, _approval_policy: &Constrained<AskForApproval>) {}

    pub async fn notify_sandbox_state_change(
        &self,
        _sandbox_state: &SandboxState,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Default)]
pub struct McpConnectionManager;

#[cfg(not(target_arch = "wasm32"))]
impl McpConnectionManager {
    pub fn new_uninitialized(_approval_policy: &Constrained<AskForApproval>) -> Self {
        Self
    }

    pub fn new_mcp_connection_manager_for_tests(
        _approval_policy: &Constrained<AskForApproval>,
    ) -> Self {
        Self
    }

    #[allow(clippy::too_many_arguments)]
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
        _mcp_oauth_host: std::sync::Arc<dyn crate::tools::browser_host::McpOauthHost>,
    ) -> (Self, CancellationToken) {
        (Self, CancellationToken::new())
    }

    pub fn has_servers(&self) -> bool {
        false
    }

    pub async fn list_all_tools(&self) -> HashMap<String, ToolInfo> {
        HashMap::new()
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
            "mcp tool execution is not implemented in wasm yet".to_string(),
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
