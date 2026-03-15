use async_trait::async_trait;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HostErrorCode {
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
pub(crate) struct HostError {
    pub(crate) code: HostErrorCode,
    pub(crate) message: String,
    pub(crate) retryable: bool,
    pub(crate) data: Option<Value>,
}

pub(crate) type HostResult<T> = Result<T, HostError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostFileEntry {
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    pub(crate) size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadFileRequest {
    pub(crate) path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadFileResponse {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListDirRequest {
    pub(crate) path: String,
    pub(crate) recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListDirResponse {
    pub(crate) entries: Vec<HostFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    pub(crate) path: String,
    pub(crate) query: String,
    pub(crate) case_sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchMatch {
    pub(crate) path: String,
    pub(crate) line_number: u32,
    pub(crate) line: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResponse {
    pub(crate) matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyPatchRequest {
    pub(crate) patch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyPatchResponse {
    pub(crate) files_changed: Vec<String>,
}

#[async_trait]
pub(crate) trait HostFs: Send + Sync {
    async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse>;
    async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse>;
    async fn search(&self, request: SearchRequest) -> HostResult<SearchResponse>;
    async fn apply_patch(&self, request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse>;
}

#[derive(Debug, Default)]
pub(crate) struct UnavailableHostFs;

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

fn unavailable_host_error(tool_name: &str) -> HostError {
    HostError {
        code: HostErrorCode::Unavailable,
        message: format!("{tool_name} is unavailable until a browser workspace host is attached"),
        retryable: false,
        data: None,
    }
}
