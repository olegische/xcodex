use codex_app_server_protocol::JSONRPCNotification;
use codex_app_server_protocol::JSONRPCRequest;
use codex_app_server_protocol::ServerRequest;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;
#[cfg(target_arch = "wasm32")]
use web_sys::console;

pub(crate) fn server_notification_to_jsonrpc(
    notification: codex_app_server_protocol::ServerNotification,
) -> JSONRPCNotification {
    let value = match serde_json::to_value(&notification) {
        Ok(value) => value,
        Err(error) => {
            browser_error(&format!(
                "[wasm/browser] server notification serialization failed: {error}"
            ));
            unreachable!("server notification should serialize: {error}")
        }
    };
    let mut object = jsonrpc_object_from_value(value);
    let method = jsonrpc_method_from_object(&mut object, "server notification");
    let params = object.remove("params");
    JSONRPCNotification { method, params }
}

pub(crate) fn server_request_to_jsonrpc(request: ServerRequest) -> JSONRPCRequest {
    let value = match serde_json::to_value(&request) {
        Ok(value) => value,
        Err(error) => {
            browser_error(&format!(
                "[wasm/browser] server request serialization failed: {error}"
            ));
            unreachable!("server request should serialize: {error}")
        }
    };
    let request_object = jsonrpc_object_from_value(value);
    let request_id = request_object
        .get("id")
        .map(serde_json::Value::to_string)
        .unwrap_or_else(|| "unknown".to_string());
    let request_method = request_object
        .get("method")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    browser_log(&format!(
        "[wasm/browser] server_request_to_jsonrpc method={request_method} id={request_id}"
    ));
    let mut object = request_object;
    let id = object
        .remove("id")
        .map(serde_json::from_value)
        .unwrap_or_else(|| unreachable!("server request should include id"))
        .unwrap_or_else(|error| unreachable!("server request id should decode: {error}"));
    let method = jsonrpc_method_from_object(&mut object, "server request");
    let params = object.remove("params");
    let trace = object
        .remove("trace")
        .map(serde_json::from_value)
        .transpose()
        .unwrap_or_else(|error| unreachable!("server request trace should decode: {error}"));
    JSONRPCRequest {
        id,
        method,
        params,
        trace,
    }
}

fn jsonrpc_object_from_value(
    value: serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    let serde_json::Value::Object(object) = value else {
        unreachable!("jsonrpc payload should serialize to an object");
    };
    object
}

fn jsonrpc_method_from_object(
    object: &mut serde_json::Map<String, serde_json::Value>,
    context: &str,
) -> String {
    object
        .remove("method")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| unreachable!("{context} should include string method"))
}

#[cfg(target_arch = "wasm32")]
fn browser_log(message: &str) {
    console::log_1(&JsValue::from_str(message));
}

#[cfg(not(target_arch = "wasm32"))]
fn browser_log(_message: &str) {}

#[cfg(target_arch = "wasm32")]
fn browser_error(message: &str) {
    console::error_1(&JsValue::from_str(message));
}

#[cfg(not(target_arch = "wasm32"))]
fn browser_error(_message: &str) {}
