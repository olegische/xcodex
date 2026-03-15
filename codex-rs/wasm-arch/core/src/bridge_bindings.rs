use crate::bridge::BridgeEnvelope;
use crate::host::HostError;
use serde_json::Value;

pub fn normalize_bridge_envelope(envelope: BridgeEnvelope) -> BridgeEnvelope {
    envelope
}

pub fn bridge_error_to_value(error: HostError) -> Value {
    serde_json::to_value(error).unwrap_or_else(|serialization_error| {
        serde_json::json!({
            "code": "internal",
            "message": format!("failed to serialize host error: {serialization_error}"),
            "retryable": false,
            "data": null,
        })
    })
}

#[cfg(target_arch = "wasm32")]
mod wasm_exports {
    use super::bridge_error_to_value;
    use super::normalize_bridge_envelope;
    use crate::bridge::BridgeEnvelope;
    use crate::host::HostError;
    use serde::Serialize;
    use serde::de::DeserializeOwned;
    use wasm_bindgen::JsValue;
    use wasm_bindgen::prelude::wasm_bindgen;

    #[wasm_bindgen]
    pub struct WasmBridgeCodec;

    #[wasm_bindgen]
    impl WasmBridgeCodec {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self
        }

        #[wasm_bindgen(js_name = normalizeEnvelope)]
        pub fn normalize_envelope(&self, value: JsValue) -> Result<JsValue, JsValue> {
            let envelope: BridgeEnvelope = decode_js_value(value)?;
            encode_js_value(&normalize_bridge_envelope(envelope))
        }

        #[wasm_bindgen(js_name = hostErrorToJs)]
        pub fn host_error_to_js(&self, value: JsValue) -> Result<JsValue, JsValue> {
            let error: HostError = decode_js_value(value)?;
            encode_js_value(&bridge_error_to_value(error))
        }
    }

    fn decode_js_value<T>(value: JsValue) -> Result<T, JsValue>
    where
        T: DeserializeOwned,
    {
        serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    fn encode_js_value<T>(value: &T) -> Result<JsValue, JsValue>
    where
        T: Serialize,
    {
        serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::bridge_error_to_value;
    use super::normalize_bridge_envelope;
    use crate::bridge::BridgeEnvelope;
    use crate::bridge::BridgeMessage;
    use crate::bridge::BridgeRequest;
    use crate::bridge::FsReadFileParams;
    use crate::host::HostError;
    use crate::host::HostErrorCode;
    use pretty_assertions::assert_eq;
    use serde_json::Value;

    #[test]
    fn normalize_bridge_envelope_preserves_shape() {
        let envelope = BridgeEnvelope {
            id: "msg-1".to_string(),
            payload: BridgeMessage::Request(BridgeRequest::FsReadFile(FsReadFileParams {
                path: "/repo/README.md".to_string(),
            })),
        };

        assert_eq!(normalize_bridge_envelope(envelope.clone()), envelope);
    }

    #[test]
    fn bridge_error_to_value_serializes_host_error_shape() {
        let value = bridge_error_to_value(HostError {
            code: HostErrorCode::Unavailable,
            message: "host adapter missing".to_string(),
            retryable: false,
            data: Some(serde_json::json!({
                "adapter": "git"
            })),
        });

        assert_eq!(value, fixture_json("host-error.json"));
    }

    fn fixture_json(path: &str) -> Value {
        let fixture = match path {
            "host-error.json" => include_str!("../../fixtures/bridge/host-error.json"),
            other => panic!("unknown fixture: {other}"),
        };
        serde_json::from_str(fixture).expect("fixture should be valid json")
    }
}
