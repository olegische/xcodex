use async_trait::async_trait;
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

#[async_trait]
pub trait HostFs: Send + Sync {
    async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse>;
    async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse>;
    async fn search(&self, request: SearchRequest) -> HostResult<SearchResponse>;
    async fn apply_patch(&self, request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse>;
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
