use async_trait::async_trait;
use codex_protocol::models::ResponseItem;
use core::pin::Pin;
use futures::stream::Stream;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

use crate::instructions::InstructionSnapshot;

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
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResponse {
    pub path: String,
    pub bytes_written: usize,
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

#[async_trait(?Send)]
pub trait HostFs: Send + Sync {
    async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse>;
    async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse>;
    async fn search(&self, request: SearchRequest) -> HostResult<SearchResponse>;
    async fn write_file(&self, request: WriteFileRequest) -> HostResult<WriteFileResponse>;
    async fn apply_patch(&self, request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequest {
    pub request_id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ModelTransportEvent {
    Started {
        request_id: String,
    },
    Delta {
        request_id: String,
        payload: Value,
    },
    OutputItemDone {
        request_id: String,
        item: ResponseItem,
    },
    Completed {
        request_id: String,
    },
    Failed {
        request_id: String,
        error: HostError,
    },
}

pub type ModelEventStream = Pin<Box<dyn Stream<Item = ModelTransportEvent> + Send + 'static>>;

#[async_trait(?Send)]
pub trait HostModelTransport: Send + Sync {
    async fn start_stream(&self, request: ModelRequest) -> HostResult<ModelEventStream>;
    async fn cancel(&self, request_id: String) -> HostResult<()>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeRequest {
    pub call_id: String,
    pub tool_name: String,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeResponse {
    pub call_id: String,
    pub output: Value,
}

#[async_trait(?Send)]
pub trait HostToolExecutor: Send + Sync {
    async fn list_tools(&self) -> HostResult<Vec<HostToolSpec>>;
    async fn invoke(&self, request: ToolInvokeRequest) -> HostResult<ToolInvokeResponse>;
    async fn cancel(&self, call_id: String) -> HostResult<()>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub thread_id: String,
    pub metadata: Value,
    pub items: Vec<Value>,
}

#[async_trait(?Send)]
pub trait HostSessionStore: Send + Sync {
    async fn load_thread(&self, thread_id: String) -> HostResult<Option<SessionSnapshot>>;
    async fn save_thread(&self, snapshot: SessionSnapshot) -> HostResult<()>;
}

#[async_trait(?Send)]
pub trait HostInstructionStore: Send + Sync {
    async fn load_instructions(&self, thread_id: String)
    -> HostResult<Option<InstructionSnapshot>>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub step: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlanRequest {
    pub explanation: Option<String>,
    pub plan: Vec<PlanStep>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputOption {
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputQuestion {
    pub header: String,
    pub id: String,
    pub question: String,
    pub options: Vec<RequestUserInputOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputRequest {
    pub questions: Vec<RequestUserInputQuestion>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputAnswer {
    pub id: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestUserInputResponse {
    pub answers: Vec<RequestUserInputAnswer>,
}

#[async_trait(?Send)]
pub trait HostCollaboration: Send + Sync {
    async fn update_plan(&self, request: UpdatePlanRequest) -> HostResult<()>;
    async fn request_user_input(
        &self,
        request: RequestUserInputRequest,
    ) -> HostResult<RequestUserInputResponse>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostAuthMode {
    ApiKey,
    Chatgpt,
    ChatgptAuthTokens,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthRefreshReason {
    Unauthorized,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    pub auth_mode: HostAuthMode,
    pub openai_api_key: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub chatgpt_account_id: Option<String>,
    pub chatgpt_plan_type: Option<String>,
    pub last_refresh_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRefreshContext {
    pub reason: AuthRefreshReason,
    pub previous_account_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAuthTokens {
    pub access_token: String,
    pub chatgpt_account_id: String,
    pub chatgpt_plan_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub chatgpt_account_id: Option<String>,
    pub auth_mode: Option<HostAuthMode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadRequest {
    pub refresh_token: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadResponse {
    pub account: Option<AccountSummary>,
    pub requires_openai_auth: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListRequest {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostModelPreset {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub show_in_picker: bool,
    pub supports_api: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub data: Vec<HostModelPreset>,
    pub next_cursor: Option<String>,
}

#[async_trait]
pub trait HostAuth: Send + Sync {
    async fn load_auth_state(&self) -> HostResult<Option<AuthState>>;
    async fn save_auth_state(&self, auth_state: AuthState) -> HostResult<()>;
    async fn clear_auth_state(&self) -> HostResult<()>;
    async fn read_account(&self, request: AccountReadRequest) -> HostResult<AccountReadResponse>;
    async fn list_models(&self, request: ModelListRequest) -> HostResult<ModelListResponse>;
    async fn refresh_auth(&self, context: AuthRefreshContext) -> HostResult<ExternalAuthTokens>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMetadataRequest {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMetadataResponse {
    pub branch: Option<String>,
    pub commit: Option<String>,
    pub is_dirty: bool,
}

#[async_trait]
pub trait HostGit: Send + Sync {
    async fn metadata(&self, request: GitMetadataRequest) -> HostResult<GitMetadataResponse>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInvokeRequest {
    pub server: String,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInvokeResponse {
    pub result: Value,
}

#[async_trait]
pub trait HostMcp: Send + Sync {
    async fn invoke(&self, request: McpInvokeRequest) -> HostResult<McpInvokeResponse>;
}
