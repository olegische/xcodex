use std::sync::Arc;

use async_trait::async_trait;
use codex_app_server_protocol::AppInfo;
use codex_protocol::config_types::ServiceTier;
use codex_protocol::openai_models::ModelsResponse;
use codex_wasm_v2_core::ApplyPatchRequest;
use codex_wasm_v2_core::ApplyPatchResponse;
use codex_wasm_v2_core::BrowserModelEvent;
use codex_wasm_v2_core::BrowserModelRequest;
use codex_wasm_v2_core::CodexAuth;
use codex_wasm_v2_core::ConfigStorageHost;
use codex_wasm_v2_core::DeleteThreadSessionRequest;
use codex_wasm_v2_core::DiscoverableAppsProvider;
use codex_wasm_v2_core::HostError;
use codex_wasm_v2_core::HostErrorCode;
use codex_wasm_v2_core::HostFs;
use codex_wasm_v2_core::HostResult;
use codex_wasm_v2_core::ListDirRequest;
use codex_wasm_v2_core::ListDirResponse;
use codex_wasm_v2_core::ListThreadSessionsRequest;
use codex_wasm_v2_core::ListThreadSessionsResponse;
use codex_wasm_v2_core::LoadThreadSessionRequest;
use codex_wasm_v2_core::LoadThreadSessionResponse;
use codex_wasm_v2_core::LoadUserConfigRequest;
use codex_wasm_v2_core::LoadUserConfigResponse;
use codex_wasm_v2_core::ModelProviderInfo;
use codex_wasm_v2_core::ModelTransportHost;
use codex_wasm_v2_core::ReadFileRequest;
use codex_wasm_v2_core::ReadFileResponse;
use codex_wasm_v2_core::SaveThreadSessionRequest;
use codex_wasm_v2_core::SaveUserConfigRequest;
use codex_wasm_v2_core::SaveUserConfigResponse;
use codex_wasm_v2_core::SearchRequest;
use codex_wasm_v2_core::SearchResponse;
use codex_wasm_v2_core::ThreadStorageHost;
use js_sys::Function;
use js_sys::Promise;
use serde::Deserialize;
use serde::Serialize;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "BrowserRuntimeHost")]
    pub type BrowserRuntimeHost;
}

#[wasm_bindgen(typescript_custom_section)]
const BROWSER_RUNTIME_HOST_TS: &str = r#"
export interface BrowserBootstrap {
  codexHome: string;
  cwd?: string | null;
  model?: string | null;
  modelProviderId?: string | null;
  modelProvider?: unknown;
  serviceTier?: unknown;
  approvalPolicy?: unknown;
  sandboxPolicy?: unknown;
  reasoningEffort?: unknown;
  reasoningSummary?: unknown;
  personality?: unknown;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  userInstructions?: string | null;
  apiKey?: string | null;
  modelCatalog?: unknown;
  ephemeral?: boolean;
}

export interface BrowserRuntimeHost {
  loadBootstrap(request: unknown): Promise<BrowserBootstrap>;
  readFile?(request: unknown): Promise<unknown>;
  listDir?(request: unknown): Promise<unknown>;
  search?(request: unknown): Promise<unknown>;
  applyPatch?(request: unknown): Promise<unknown>;
  loadUserConfig?(request: unknown): Promise<unknown>;
  saveUserConfig?(request: unknown): Promise<unknown>;
  loadThreadSession?(request: unknown): Promise<unknown>;
  saveThreadSession?(request: unknown): Promise<unknown>;
  deleteThreadSession?(request: unknown): Promise<unknown>;
  listThreadSessions?(request: unknown): Promise<unknown>;
  listDiscoverableApps?(request: unknown): Promise<unknown>;
  runModelTurn?(request: unknown): Promise<unknown>;
}
"#;

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBootstrap {
    pub codex_home: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub model_provider_id: Option<String>,
    pub model_provider: Option<ModelProviderInfo>,
    pub service_tier: Option<Option<ServiceTier>>,
    pub approval_policy: Option<codex_app_server_protocol::AskForApproval>,
    pub sandbox_policy: Option<codex_protocol::protocol::SandboxPolicy>,
    pub reasoning_effort: Option<codex_protocol::openai_models::ReasoningEffort>,
    pub reasoning_summary: Option<codex_protocol::config_types::ReasoningSummary>,
    pub personality: Option<codex_protocol::config_types::Personality>,
    pub base_instructions: Option<String>,
    pub developer_instructions: Option<String>,
    pub user_instructions: Option<String>,
    pub api_key: Option<String>,
    pub model_catalog: Option<ModelsResponse>,
    pub ephemeral: Option<bool>,
}

impl BrowserBootstrap {
    pub fn auth(&self) -> Option<CodexAuth> {
        self.api_key
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(CodexAuth::from_api_key)
    }
}

#[derive(Clone)]
pub struct JsHost {
    host: JsValue,
}

impl JsHost {
    pub fn new(host: BrowserRuntimeHost) -> Self {
        Self { host: host.into() }
    }

    pub async fn load_bootstrap(&self) -> Result<BrowserBootstrap, JsValue> {
        let value = call_required_method(&self.host, "loadBootstrap", JsValue::NULL).await?;
        decode_js_value(value)
    }

    pub fn browser_fs(&self) -> Arc<dyn HostFs> {
        Arc::new(self.clone())
    }

    pub fn discoverable_apps_provider(&self) -> Arc<dyn DiscoverableAppsProvider> {
        Arc::new(self.clone())
    }

    pub fn model_transport_host(&self) -> Arc<dyn ModelTransportHost> {
        Arc::new(self.clone())
    }

    pub fn config_storage_host(&self) -> Arc<dyn ConfigStorageHost> {
        Arc::new(self.clone())
    }

    pub fn thread_storage_host(&self) -> Arc<dyn ThreadStorageHost> {
        Arc::new(self.clone())
    }
}

// SAFETY: browser runtimes execute this host wrapper on the single JS main thread. We never move
// the inner JS object to a real OS thread, but `wasm_v2/core` requires `Send + Sync` host traits.
#[cfg(target_arch = "wasm32")]
unsafe impl Send for JsHost {}
#[cfg(target_arch = "wasm32")]
unsafe impl Sync for JsHost {}

#[async_trait]
impl HostFs for JsHost {
    async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse> {
        call_host_method(&self.host, "readFile", request).await
    }

    async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse> {
        call_host_method(&self.host, "listDir", request).await
    }

    async fn search(&self, request: SearchRequest) -> HostResult<SearchResponse> {
        call_host_method(&self.host, "search", request).await
    }

    async fn apply_patch(&self, request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse> {
        call_host_method(&self.host, "applyPatch", request).await
    }
}

#[async_trait]
impl DiscoverableAppsProvider for JsHost {
    async fn list_discoverable_apps(&self) -> anyhow::Result<Vec<AppInfo>> {
        match call_optional_method::<(), Vec<AppInfo>>(&self.host, "listDiscoverableApps", ()).await
        {
            Ok(Some(apps)) => Ok(apps),
            Ok(None) => Ok(Vec::new()),
            Err(error) => Err(anyhow::anyhow!(js_error_string(&error))),
        }
    }
}

#[async_trait]
impl ModelTransportHost for JsHost {
    async fn run_model_turn(
        &self,
        request: BrowserModelRequest,
    ) -> HostResult<Vec<BrowserModelEvent>> {
        call_host_method(&self.host, "runModelTurn", request).await
    }
}

#[async_trait]
impl ThreadStorageHost for JsHost {
    async fn load_thread_session(
        &self,
        request: LoadThreadSessionRequest,
    ) -> HostResult<LoadThreadSessionResponse> {
        call_host_method(&self.host, "loadThreadSession", request).await
    }

    async fn save_thread_session(&self, request: SaveThreadSessionRequest) -> HostResult<()> {
        call_host_method(&self.host, "saveThreadSession", request).await
    }

    async fn delete_thread_session(&self, request: DeleteThreadSessionRequest) -> HostResult<()> {
        call_host_method(&self.host, "deleteThreadSession", request).await
    }

    async fn list_thread_sessions(
        &self,
        request: ListThreadSessionsRequest,
    ) -> HostResult<ListThreadSessionsResponse> {
        call_host_method(&self.host, "listThreadSessions", request).await
    }
}

#[async_trait]
impl ConfigStorageHost for JsHost {
    async fn load_user_config(
        &self,
        request: LoadUserConfigRequest,
    ) -> HostResult<LoadUserConfigResponse> {
        call_host_method(&self.host, "loadUserConfig", request).await
    }

    async fn save_user_config(
        &self,
        request: SaveUserConfigRequest,
    ) -> HostResult<SaveUserConfigResponse> {
        call_host_method(&self.host, "saveUserConfig", request).await
    }
}

async fn call_host_method<Request, Response>(
    host: &JsValue,
    method: &str,
    request: Request,
) -> HostResult<Response>
where
    Request: Serialize + Send + 'static,
    Response: for<'de> Deserialize<'de> + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    let host = host.clone();
    let method = method.to_string();
    wasm_bindgen_futures::spawn_local(async move {
        let result = async {
            let request_value = encode_js_value(&request)?;
            let response = call_required_method(&host, &method, request_value).await?;
            decode_js_value(response)
        }
        .await
        .map_err(js_host_error);
        let _ = tx.send(result);
    });
    rx.await
        .map_err(|_| js_host_error(JsValue::from_str("host callback cancelled")))?
}

async fn call_optional_method<Request, Response>(
    host: &JsValue,
    method: &str,
    request: Request,
) -> Result<Option<Response>, JsValue>
where
    Request: Serialize + Send + 'static,
    Response: for<'de> Deserialize<'de> + Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    let host = host.clone();
    let method = method.to_string();
    wasm_bindgen_futures::spawn_local(async move {
        let result = async {
            let Some(function) = lookup_function(&host, &method)? else {
                return Ok(None);
            };
            let request_value = encode_js_value(&request)?;
            let promise = function
                .call1(&host, &request_value)?
                .dyn_into::<Promise>()
                .map_err(|_| JsValue::from_str(&format!("{method} must return a Promise")))?;
            let response = JsFuture::from(promise).await?;
            Ok(Some(decode_js_value(response)?))
        }
        .await;
        let _ = tx.send(result);
    });
    rx.await
        .map_err(|_| JsValue::from_str("host callback cancelled"))?
}

async fn call_required_method(
    host: &JsValue,
    method: &str,
    request: JsValue,
) -> Result<JsValue, JsValue> {
    let function = lookup_function(host, method)?
        .ok_or_else(|| JsValue::from_str(&format!("BrowserRuntimeHost.{method} is required")))?;
    let promise = function
        .call1(host, &request)?
        .dyn_into::<Promise>()
        .map_err(|_| JsValue::from_str(&format!("{method} must return a Promise")))?;
    JsFuture::from(promise).await
}

fn lookup_function(host: &JsValue, method: &str) -> Result<Option<Function>, JsValue> {
    let value = js_sys::Reflect::get(host, &JsValue::from_str(method))?;
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    value
        .dyn_into::<Function>()
        .map(Some)
        .map_err(|_| JsValue::from_str(&format!("BrowserRuntimeHost.{method} must be a function")))
}

fn encode_js_value<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: Serialize,
{
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn decode_js_value<T>(value: JsValue) -> Result<T, JsValue>
where
    T: for<'de> Deserialize<'de>,
{
    serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn js_host_error(error: JsValue) -> HostError {
    HostError {
        code: HostErrorCode::Unavailable,
        message: js_error_string(&error),
        data: None,
        retryable: false,
    }
}

pub fn js_error_string(error: &JsValue) -> String {
    error
        .as_string()
        .unwrap_or_else(|| "unknown JavaScript error".to_string())
}
