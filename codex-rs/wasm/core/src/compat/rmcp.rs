#[cfg(target_arch = "wasm32")]
use codex_protocol::protocol::McpAuthStatus;
#[cfg(target_arch = "wasm32")]
use js_sys::Reflect;
#[cfg(target_arch = "wasm32")]
use serde::Deserialize;
#[cfg(target_arch = "wasm32")]
use serde::Serialize;
#[cfg(target_arch = "wasm32")]
use serde_json::Value;
#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::collections::HashMap;
#[cfg(target_arch = "wasm32")]
use std::fmt;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsCast;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;
#[cfg(target_arch = "wasm32")]
use web_sys::Headers;
#[cfg(target_arch = "wasm32")]
use web_sys::Request;
#[cfg(target_arch = "wasm32")]
use web_sys::RequestInit;
#[cfg(target_arch = "wasm32")]
use web_sys::RequestMode;
#[cfg(target_arch = "wasm32")]
use web_sys::Response;
#[cfg(target_arch = "wasm32")]
use web_sys::Url;

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
pub enum OAuthCredentialsStoreMode {
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
thread_local! {
    static OAUTH_DISCOVERY_SUPPORT_CACHE: RefCell<HashMap<String, bool>> =
        RefCell::new(HashMap::new());
}

#[cfg(target_arch = "wasm32")]
pub(crate) async fn supports_oauth_login(_url: &str) -> anyhow::Result<bool> {
    supports_oauth_login_with_headers(_url, &[]).await
}

#[cfg(target_arch = "wasm32")]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn determine_streamable_http_auth_status(
    _server_name: &str,
    url: &str,
    bearer_token_env_var: Option<&str>,
    http_headers: Option<std::collections::HashMap<String, String>>,
    env_http_headers: Option<std::collections::HashMap<String, String>>,
    _store_mode: OAuthCredentialsStoreMode,
) -> anyhow::Result<McpAuthStatus> {
    if bearer_token_env_var.is_some() {
        return Ok(McpAuthStatus::BearerToken);
    }

    let has_authorization_header = http_headers.as_ref().is_some_and(|headers| {
        headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("authorization"))
    }) || env_http_headers.as_ref().is_some_and(|headers| {
        headers
            .keys()
            .any(|key| key.eq_ignore_ascii_case("authorization"))
    });
    if has_authorization_header {
        return Ok(McpAuthStatus::BearerToken);
    }

    let mut default_headers = Vec::new();
    if let Some(headers) = http_headers.as_ref() {
        default_headers.extend(
            headers
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        );
    }
    if let Some(headers) = env_http_headers.as_ref() {
        default_headers.extend(headers.iter().filter_map(|(key, env_name)| {
            std::env::var(env_name)
                .ok()
                .map(|value| (key.as_str(), Box::leak(value.into_boxed_str()) as &str))
        }));
    }

    match supports_oauth_login_with_headers(url, &default_headers).await {
        Ok(true) => Ok(McpAuthStatus::NotLoggedIn),
        Ok(false) => Ok(McpAuthStatus::Unsupported),
        Err(error) => Err(error),
    }
}

#[cfg(target_arch = "wasm32")]
const OAUTH_DISCOVERY_HEADER: &str = "MCP-Protocol-Version";
#[cfg(target_arch = "wasm32")]
const OAUTH_DISCOVERY_VERSION: &str = "2024-11-05";
#[cfg(target_arch = "wasm32")]
async fn supports_oauth_login_with_headers(
    url: &str,
    default_headers: &[(&str, &str)],
) -> anyhow::Result<bool> {
    let cache_key = oauth_discovery_cache_key(url, default_headers);
    if let Some(cached) =
        OAUTH_DISCOVERY_SUPPORT_CACHE.with(|cache| cache.borrow().get(&cache_key).copied())
    {
        return Ok(cached);
    }

    let base_url = Url::new(url).map_err(js_error)?;
    let base_path = base_url.pathname();

    for candidate_path in discovery_paths(&base_path) {
        let discovery_url = Url::new(url).map_err(js_error)?;
        discovery_url.set_pathname(&candidate_path);
        discovery_url.set_search("");
        let response = match fetch_discovery_response(discovery_url.href(), default_headers).await {
            Ok(response) => response,
            Err(_) => continue,
        };

        if response.status() != 200 {
            continue;
        }

        let body = match JsFuture::from(response.json().map_err(js_error)?).await {
            Ok(value) => value,
            Err(_) => continue,
        };
        let authorization_endpoint =
            Reflect::get(&body, &JsValue::from_str("authorization_endpoint")).ok();
        let token_endpoint = Reflect::get(&body, &JsValue::from_str("token_endpoint")).ok();
        if authorization_endpoint
            .as_ref()
            .is_some_and(|value| value.is_string())
            && token_endpoint
                .as_ref()
                .is_some_and(|value| value.is_string())
        {
            OAUTH_DISCOVERY_SUPPORT_CACHE.with(|cache| {
                cache.borrow_mut().insert(cache_key.clone(), true);
            });
            return Ok(true);
        }
    }

    OAUTH_DISCOVERY_SUPPORT_CACHE.with(|cache| {
        cache.borrow_mut().insert(cache_key, false);
    });
    Ok(false)
}

#[cfg(target_arch = "wasm32")]
async fn fetch_discovery_response(
    url: String,
    default_headers: &[(&str, &str)],
) -> anyhow::Result<Response> {
    let window =
        web_sys::window().ok_or_else(|| anyhow::anyhow!("browser window is unavailable"))?;
    let headers = Headers::new().map_err(js_error)?;
    headers
        .set(OAUTH_DISCOVERY_HEADER, OAUTH_DISCOVERY_VERSION)
        .map_err(js_error)?;
    for (key, value) in default_headers {
        headers.set(key, value).map_err(js_error)?;
    }

    let request_init = RequestInit::new();
    request_init.set_method("GET");
    request_init.set_mode(RequestMode::Cors);
    request_init.set_headers(&headers);
    let request = Request::new_with_str_and_init(&url, &request_init).map_err(js_error)?;

    let value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(js_error)?;
    value.dyn_into::<Response>().map_err(js_error)
}

#[cfg(target_arch = "wasm32")]
fn discovery_paths(base_path: &str) -> Vec<String> {
    let trimmed = base_path.trim_start_matches('/').trim_end_matches('/');
    let canonical = "/.well-known/oauth-authorization-server".to_string();

    if trimmed.is_empty() {
        return vec![canonical];
    }

    let mut candidates = Vec::new();
    let mut push_unique = |candidate: String| {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    };

    push_unique(canonical.clone());
    push_unique(format!("{canonical}/{trimmed}"));
    push_unique(format!("/{trimmed}/.well-known/oauth-authorization-server"));

    candidates
}

#[cfg(target_arch = "wasm32")]
fn oauth_discovery_cache_key(url: &str, default_headers: &[(&str, &str)]) -> String {
    let mut key = url.to_string();
    for (header, value) in default_headers {
        key.push('\n');
        key.push_str(header);
        key.push('=');
        key.push_str(value);
    }
    key
}

#[cfg(target_arch = "wasm32")]
fn js_error(error: JsValue) -> anyhow::Error {
    anyhow::anyhow!(error.as_string().unwrap_or_else(|| "js error".to_string()))
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
