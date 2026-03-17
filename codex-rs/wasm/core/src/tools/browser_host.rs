use async_trait::async_trait;
use codex_protocol::protocol::RolloutItem;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostErrorCode {
    NotFound,
    PermissionDenied,
    InvalidInput,
    Conflict,
    RateLimited,
    Timeout,
    Unavailable,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostError {
    pub code: HostErrorCode,
    pub message: String,
    pub retryable: bool,
    pub data: Option<Value>,
}

pub type HostResult<T> = Result<T, HostError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileRequest {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResponse {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirRequest {
    pub path: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirResponse {
    pub entries: Vec<HostFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub path: String,
    pub query: String,
    pub case_sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub line_number: u32,
    pub line: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchRequest {
    pub patch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchResponse {
    pub files_changed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadThreadSessionRequest {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteThreadSessionRequest {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListThreadSessionsRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadUserConfigRequest {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadUserConfigResponse {
    pub file_path: String,
    pub version: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveUserConfigRequest {
    pub file_path: Option<String>,
    pub expected_version: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveUserConfigResponse {
    pub file_path: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredThreadSessionMetadata {
    pub thread_id: String,
    pub rollout_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
    pub name: Option<String>,
    pub preview: String,
    pub cwd: String,
    pub model_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredThreadSession {
    pub metadata: StoredThreadSessionMetadata,
    pub items: Vec<RolloutItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveThreadSessionRequest {
    pub session: StoredThreadSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadThreadSessionResponse {
    pub session: StoredThreadSession,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListThreadSessionsResponse {
    pub sessions: Vec<StoredThreadSessionMetadata>,
}

#[async_trait]
pub trait HostFs: Send + Sync {
    async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse>;
    async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse>;
    async fn search(&self, request: SearchRequest) -> HostResult<SearchResponse>;
    async fn apply_patch(&self, request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse>;
}

#[async_trait]
pub trait ThreadStorageHost: Send + Sync {
    async fn load_thread_session(
        &self,
        request: LoadThreadSessionRequest,
    ) -> HostResult<LoadThreadSessionResponse>;
    async fn save_thread_session(&self, request: SaveThreadSessionRequest) -> HostResult<()>;
    async fn delete_thread_session(&self, request: DeleteThreadSessionRequest) -> HostResult<()>;
    async fn list_thread_sessions(
        &self,
        request: ListThreadSessionsRequest,
    ) -> HostResult<ListThreadSessionsResponse>;
}

#[async_trait]
pub trait ConfigStorageHost: Send + Sync {
    async fn load_user_config(
        &self,
        request: LoadUserConfigRequest,
    ) -> HostResult<LoadUserConfigResponse>;
    async fn save_user_config(
        &self,
        request: SaveUserConfigRequest,
    ) -> HostResult<SaveUserConfigResponse>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMcpOauthRedirectUriRequest {
    pub server_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMcpOauthRedirectUriResponse {
    pub redirect_uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitForMcpOauthCallbackRequest {
    pub server_name: String,
    pub authorization_url: String,
    pub timeout_secs: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitForMcpOauthCallbackResponse {
    pub code: String,
    pub state: String,
}

#[async_trait]
pub trait McpOauthHost: Send + Sync {
    async fn resolve_mcp_oauth_redirect_uri(
        &self,
        request: ResolveMcpOauthRedirectUriRequest,
    ) -> HostResult<ResolveMcpOauthRedirectUriResponse>;

    async fn wait_for_mcp_oauth_callback(
        &self,
        request: WaitForMcpOauthCallbackRequest,
    ) -> HostResult<WaitForMcpOauthCallbackResponse>;
}

#[derive(Debug, Default)]
pub struct UnavailableHostFs;

#[async_trait]
impl HostFs for UnavailableHostFs {
    async fn read_file(&self, _request: ReadFileRequest) -> HostResult<ReadFileResponse> {
        Err(unavailable_host_error("read_file"))
    }

    async fn list_dir(&self, _request: ListDirRequest) -> HostResult<ListDirResponse> {
        Err(unavailable_host_error("list_dir"))
    }

    async fn search(&self, _request: SearchRequest) -> HostResult<SearchResponse> {
        Err(unavailable_host_error("grep_files"))
    }

    async fn apply_patch(&self, _request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse> {
        Err(unavailable_host_error("apply_patch"))
    }
}

#[derive(Debug, Default)]
pub struct UnavailableThreadStorageHost;

#[async_trait]
impl ThreadStorageHost for UnavailableThreadStorageHost {
    async fn load_thread_session(
        &self,
        _request: LoadThreadSessionRequest,
    ) -> HostResult<LoadThreadSessionResponse> {
        Err(unavailable_host_error("load_thread_session"))
    }

    async fn save_thread_session(&self, _request: SaveThreadSessionRequest) -> HostResult<()> {
        Err(unavailable_host_error("save_thread_session"))
    }

    async fn delete_thread_session(&self, _request: DeleteThreadSessionRequest) -> HostResult<()> {
        Err(unavailable_host_error("delete_thread_session"))
    }

    async fn list_thread_sessions(
        &self,
        _request: ListThreadSessionsRequest,
    ) -> HostResult<ListThreadSessionsResponse> {
        Err(unavailable_host_error("list_thread_sessions"))
    }
}

#[derive(Debug, Default)]
pub struct UnavailableConfigStorageHost;

#[async_trait]
impl ConfigStorageHost for UnavailableConfigStorageHost {
    async fn load_user_config(
        &self,
        _request: LoadUserConfigRequest,
    ) -> HostResult<LoadUserConfigResponse> {
        Err(unavailable_host_error("load_user_config"))
    }

    async fn save_user_config(
        &self,
        _request: SaveUserConfigRequest,
    ) -> HostResult<SaveUserConfigResponse> {
        Err(unavailable_host_error("save_user_config"))
    }
}

#[derive(Debug, Default)]
pub struct UnavailableMcpOauthHost;

#[async_trait]
impl McpOauthHost for UnavailableMcpOauthHost {
    async fn resolve_mcp_oauth_redirect_uri(
        &self,
        _request: ResolveMcpOauthRedirectUriRequest,
    ) -> HostResult<ResolveMcpOauthRedirectUriResponse> {
        Err(unavailable_host_error("resolve_mcp_oauth_redirect_uri"))
    }

    async fn wait_for_mcp_oauth_callback(
        &self,
        _request: WaitForMcpOauthCallbackRequest,
    ) -> HostResult<WaitForMcpOauthCallbackResponse> {
        Err(unavailable_host_error("wait_for_mcp_oauth_callback"))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserModelRequest {
    // This is only a thin host envelope around the official Responses API payload.
    // `request_body` should stay aligned with the upstream OpenAI request contract.
    pub request_id: String,
    pub request_body: Value,
    pub transport_options: Option<BrowserTransportOptions>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTransportOptions {
    pub conversation_id: Option<String>,
    pub session_source: Option<String>,
    pub extra_headers: Option<Value>,
    pub use_websocket: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BrowserModelEvent {
    // These variants are a bridge envelope for browser transport events.
    // Field casing must remain camelCase to match the TS host wire contract.
    Started {
        request_id: String,
    },
    Delta {
        request_id: String,
        payload: BrowserModelDeltaPayload,
    },
    OutputItemDone {
        request_id: String,
        item: codex_protocol::models::ResponseItem,
    },
    Completed {
        request_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserModelDeltaPayload {
    pub output_text_delta: String,
}

#[async_trait]
pub trait ModelTransportHost: Send + Sync {
    async fn run_model_turn(
        &self,
        request: BrowserModelRequest,
    ) -> HostResult<Vec<BrowserModelEvent>>;
}

#[derive(Debug, Default)]
pub struct UnavailableModelTransportHost;

#[async_trait]
impl ModelTransportHost for UnavailableModelTransportHost {
    async fn run_model_turn(
        &self,
        _request: BrowserModelRequest,
    ) -> HostResult<Vec<BrowserModelEvent>> {
        Err(unavailable_host_error("run_model_turn"))
    }
}

fn unavailable_host_error(tool_name: &str) -> HostError {
    HostError {
        code: HostErrorCode::Unavailable,
        message: format!("{tool_name} is unavailable until a browser workspace host is attached"),
        retryable: false,
        data: None,
    }
}
