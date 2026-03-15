#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_rmcp_client::ElicitationAction;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_rmcp_client::ElicitationResponse;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_rmcp_client::OAuthCredentialsStoreMode;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_rmcp_client::determine_streamable_http_auth_status;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_rmcp_client::supports_oauth_login;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::ListResourceTemplatesResult;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::ListResourcesResult;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::NumberOrString;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::PaginatedRequestParams;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::ReadResourceRequestParams;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::ReadResourceResult;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::RequestId;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::Resource;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::ResourceTemplate;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use rmcp::model::Tool;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) type JsonObject = rmcp::model::JsonObject;

#[cfg(target_arch = "wasm32")]
pub(crate) use codex_protocol::approvals::ElicitationAction;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Default, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum OAuthCredentialsStoreMode {
    #[default]
    Auto,
    File,
    Keyring,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct ElicitationResponse {
    pub(crate) action: ElicitationAction,
    pub(crate) content: Option<serde_json::Value>,
    #[serde(rename = "_meta")]
    pub(crate) meta: Option<serde_json::Value>,
}

#[cfg(target_arch = "wasm32")]
pub(crate) async fn supports_oauth_login(_url: &str) -> anyhow::Result<bool> {
    Ok(false)
}

#[cfg(target_arch = "wasm32")]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn determine_streamable_http_auth_status(
    _server_name: &str,
    _url: &str,
    _bearer_token_env_var: Option<&str>,
    _http_headers: Option<std::collections::HashMap<String, String>>,
    _env_http_headers: Option<std::collections::HashMap<String, String>>,
    _store_mode: OAuthCredentialsStoreMode,
) -> anyhow::Result<McpAuthStatus> {
    Ok(McpAuthStatus::Unsupported)
}

#[cfg(target_arch = "wasm32")]
pub(crate) type JsonObject = serde_json::Map<String, Value>;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum NumberOrString {
    String(String),
    Number(i64),
}

#[cfg(target_arch = "wasm32")]
impl fmt::Display for NumberOrString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::String(value) => write!(f, "{value}"),
            Self::Number(value) => write!(f, "{value}"),
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) type RequestId = NumberOrString;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Tool {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) input_schema: JsonObject,
    pub(crate) annotations: Option<Value>,
    pub(crate) meta: Option<Value>,
    pub(crate) output_schema: Option<JsonObject>,
    pub(crate) icons: Option<Vec<Value>>,
    pub(crate) title: Option<String>,
    pub(crate) execution: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Resource;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ResourceTemplate;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct PaginatedRequestParams {
    pub(crate) cursor: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ReadResourceRequestParams {
    pub(crate) uri: String,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ReadResourceResult {
    pub(crate) contents: Vec<Value>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ListResourcesResult {
    pub(crate) resources: Vec<Resource>,
    pub(crate) next_cursor: Option<String>,
    pub(crate) meta: Option<HashMap<String, Value>>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ListResourceTemplatesResult {
    pub(crate) resource_templates: Vec<ResourceTemplate>,
    pub(crate) next_cursor: Option<String>,
    pub(crate) meta: Option<HashMap<String, Value>>,
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn clone_tool_input_schema(tool: &Tool) -> JsonObject {
    (*tool.input_schema).clone()
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn clone_tool_input_schema(tool: &Tool) -> JsonObject {
    tool.input_schema.clone()
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn clone_tool_output_schema(tool: &Tool) -> Option<JsonObject> {
    tool.output_schema.as_ref().map(|schema| (**schema).clone())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn clone_tool_output_schema(tool: &Tool) -> Option<JsonObject> {
    tool.output_schema.clone()
}
