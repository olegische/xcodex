use wasm_bindgen::JsValue;

use codex_app_server_protocol::JSONRPCError;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::JSONRPCResponse;
use codex_app_server_protocol::RequestId;

pub(crate) fn success_response<T>(
    id: RequestId,
    result: &T,
) -> Result<JSONRPCResponse, JSONRPCError>
where
    T: serde::Serialize,
{
    let result = serde_json::to_value(result).map_err(|error| internal_error(id.clone(), error))?;
    Ok(JSONRPCResponse { id, result })
}

pub(crate) fn invalid_request_error(id: RequestId, error: impl std::fmt::Display) -> JSONRPCError {
    jsonrpc_error(id, -32600, &format!("invalid request: {error}"))
}

pub(crate) fn invalid_params_error(id: RequestId, error: impl std::fmt::Display) -> JSONRPCError {
    jsonrpc_error(id, -32602, &format!("invalid params: {error}"))
}

pub(crate) fn method_error(id: RequestId, message: &str) -> JSONRPCError {
    jsonrpc_error(id, -32000, message)
}

pub(crate) fn internal_error(id: RequestId, error: impl std::fmt::Display) -> JSONRPCError {
    jsonrpc_error(id, -32603, &error.to_string())
}

pub(crate) fn app_server_error(id: RequestId, error: JSONRPCErrorError) -> JSONRPCError {
    JSONRPCError { id, error }
}

pub(crate) fn decode_js_value<T>(value: JsValue) -> Result<T, JsValue>
where
    T: for<'de> serde::Deserialize<'de>,
{
    serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

pub(crate) fn encode_js_value<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: serde::Serialize,
{
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn jsonrpc_error(id: RequestId, code: i64, message: &str) -> JSONRPCError {
    JSONRPCError {
        id,
        error: JSONRPCErrorError {
            code,
            data: None,
            message: message.to_string(),
        },
    }
}
