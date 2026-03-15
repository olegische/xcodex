use crate::host::HostError;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEnvelope {
    pub id: String,
    pub payload: BridgeMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BridgeMessage {
    Request(BridgeRequest),
    Response(BridgeResponse),
    Event(BridgeEvent),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum BridgeRequest {
    FsReadFile(FsReadFileParams),
    FsListDir(FsListDirParams),
    FsSearch(FsSearchParams),
    FsWriteFile(FsWriteFileParams),
    FsApplyPatch(FsApplyPatchParams),
    AuthStateLoad(EmptyParams),
    AuthStateSave(AuthStateSaveParams),
    AuthStateClear(EmptyParams),
    AccountRead(AccountReadParams),
    ModelList(ModelListParams),
    AuthRefresh(AuthRefreshParams),
    ModelStart(ModelStartParams),
    ModelCancel(ModelCancelParams),
    ToolList(ToolListParams),
    ToolInvoke(ToolInvokeParams),
    ToolCancel(ToolCancelParams),
    SessionLoad(SessionLoadParams),
    SessionSave(SessionSaveParams),
    GitMetadata(GitMetadataParams),
    McpInvoke(McpInvokeParams),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "result", rename_all = "camelCase")]
pub enum BridgeResponse {
    FsReadFile(FsReadFileResult),
    FsListDir(FsListDirResult),
    FsSearch(FsSearchResult),
    FsWriteFile(FsWriteFileResult),
    FsApplyPatch(FsApplyPatchResult),
    AuthStateLoad(AuthStateLoadResult),
    AuthStateSave(EmptyResult),
    AuthStateClear(EmptyResult),
    AccountRead(AccountReadResult),
    ModelList(ModelListResult),
    AuthRefresh(AuthRefreshResult),
    ModelStart(ModelStartResult),
    ModelCancel(EmptyResult),
    ToolList(ToolListResult),
    ToolInvoke(ToolInvokeResult),
    ToolCancel(EmptyResult),
    SessionLoad(SessionLoadResult),
    SessionSave(EmptyResult),
    GitMetadata(GitMetadataResult),
    McpInvoke(McpInvokeResult),
    Error(BridgeErrorResult),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", content = "payload", rename_all = "camelCase")]
pub enum BridgeEvent {
    ModelStarted(ModelStartedEvent),
    ModelDelta(ModelDeltaEvent),
    ModelOutputItem(ModelOutputItemEvent),
    ModelCompleted(ModelCompletedEvent),
    ModelFailed(ModelFailedEvent),
    ToolCallProgress(ToolCallProgressEvent),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileParams {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileResult {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListDirParams {
    pub path: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListDirResult {
    pub entries: Vec<BridgeFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchParams {
    pub path: String,
    pub query: String,
    pub case_sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchMatch {
    pub path: String,
    pub line_number: u32,
    pub line: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchResult {
    pub matches: Vec<FsSearchMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteFileParams {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteFileResult {
    pub path: String,
    pub bytes_written: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsApplyPatchParams {
    pub patch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsApplyPatchResult {
    pub files_changed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmptyParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeAuthMode {
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
pub struct AuthStatePayload {
    pub auth_mode: BridgeAuthMode,
    pub openai_api_key: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub chatgpt_account_id: Option<String>,
    pub chatgpt_plan_type: Option<String>,
    pub last_refresh_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateLoadResult {
    pub auth_state: Option<AuthStatePayload>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateSaveParams {
    pub auth_state: AuthStatePayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadParams {
    pub refresh_token: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPayload {
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub chatgpt_account_id: Option<String>,
    pub auth_mode: Option<BridgeAuthMode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReadResult {
    pub account: Option<AccountPayload>,
    pub requires_openai_auth: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListParams {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPresetPayload {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub show_in_picker: bool,
    pub supports_api: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResult {
    pub data: Vec<ModelPresetPayload>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRefreshParams {
    pub reason: AuthRefreshReason,
    pub previous_account_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRefreshResult {
    pub access_token: String,
    pub chatgpt_account_id: String,
    pub chatgpt_plan_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStartParams {
    pub request_id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStartResult {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCancelParams {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolListParams {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeToolSpec {
    pub tool_name: String,
    pub tool_namespace: Option<String>,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolListResult {
    pub tools: Vec<BridgeToolSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeParams {
    pub call_id: String,
    pub tool_name: String,
    pub tool_namespace: Option<String>,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvokeResult {
    pub call_id: String,
    pub output: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCancelParams {
    pub call_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoadParams {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotPayload {
    pub thread_id: String,
    pub metadata: Value,
    pub items: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoadResult {
    pub snapshot: Option<SessionSnapshotPayload>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSaveParams {
    pub snapshot: SessionSnapshotPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMetadataParams {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMetadataResult {
    pub branch: Option<String>,
    pub commit: Option<String>,
    pub is_dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInvokeParams {
    pub server: String,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInvokeResult {
    pub result: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyResult {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeErrorResult {
    pub error: HostError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStartedEvent {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDeltaEvent {
    pub request_id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOutputItemEvent {
    pub request_id: String,
    pub item: codex_protocol::models::ResponseItem,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCompletedEvent {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFailedEvent {
    pub request_id: String,
    pub error: HostError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallProgressEvent {
    pub call_id: String,
    pub payload: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::Value;

    #[test]
    fn bridge_request_matches_fixture() {
        let message = BridgeEnvelope {
            id: "msg-1".to_string(),
            payload: BridgeMessage::Request(BridgeRequest::FsReadFile(FsReadFileParams {
                path: "/repo/src/lib.rs".to_string(),
            })),
        };

        let value = serde_json::to_value(&message).expect("bridge request should serialize");
        assert_eq!(value, fixture_json("fs-read-file.request.json"));

        let decoded: BridgeEnvelope =
            serde_json::from_value(value).expect("bridge request should deserialize");
        assert_eq!(decoded, message);
    }

    #[test]
    fn bridge_event_matches_fixture() {
        let message = BridgeEnvelope {
            id: "evt-1".to_string(),
            payload: BridgeMessage::Event(BridgeEvent::ModelDelta(ModelDeltaEvent {
                request_id: "req-1".to_string(),
                payload: serde_json::json!({
                    "delta": "hello"
                }),
            })),
        };

        let value = serde_json::to_value(&message).expect("bridge event should serialize");
        assert_eq!(value, fixture_json("model-delta.event.json"));

        let decoded: BridgeEnvelope =
            serde_json::from_value(value).expect("bridge event should deserialize");
        assert_eq!(decoded, message);
    }

    fn fixture_json(path: &str) -> Value {
        let fixture = match path {
            "fs-read-file.request.json" => {
                include_str!("../../fixtures/bridge/fs-read-file.request.json")
            }
            "model-delta.event.json" => {
                include_str!("../../fixtures/bridge/model-delta.event.json")
            }
            other => panic!("unknown fixture: {other}"),
        };
        serde_json::from_str(fixture).expect("fixture should be valid json")
    }
}
