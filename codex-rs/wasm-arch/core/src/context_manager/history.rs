use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::HostResult;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;
use serde_json::Value;

pub(crate) fn serialize_response_item(item: &ResponseItem) -> HostResult<Value> {
    serde_json::to_value(item).map_err(|error| HostError {
        code: HostErrorCode::Internal,
        message: format!("failed to serialize response item: {error}"),
        retryable: false,
        data: None,
    })
}

pub(crate) fn serialize_response_input_item(item: &ResponseInputItem) -> HostResult<Value> {
    serde_json::to_value(item).map_err(|error| HostError {
        code: HostErrorCode::Internal,
        message: format!("failed to serialize response input item: {error}"),
        retryable: false,
        data: None,
    })
}
