#![deny(clippy::print_stdout, clippy::print_stderr)]

use serde::Serialize;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "BrowserRuntimeHost")]
    pub type BrowserRuntimeHost;
}

#[wasm_bindgen(typescript_custom_section)]
const BROWSER_RUNTIME_HOST_TS: &str = r#"
export interface BrowserRuntimeHost {
  readFile?(request: unknown): Promise<unknown>;
  listDir?(request: unknown): Promise<unknown>;
  search?(request: unknown): Promise<unknown>;
  applyPatch?(request: unknown): Promise<unknown>;
  updatePlan?(request: unknown): Promise<void>;
  requestUserInput?(request: unknown): Promise<unknown>;
  listModels?(request: unknown): Promise<unknown>;
  emitNotification?(notification: unknown): Promise<void>;
}
"#;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo<'a> {
    runtime_family: &'a str,
    status: &'a str,
    message: &'a str,
}

#[wasm_bindgen]
pub struct WasmBrowserRuntime {
    #[allow(dead_code)]
    host: BrowserRuntimeHost,
}

#[wasm_bindgen]
impl WasmBrowserRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(host: JsValue) -> Result<Self, JsValue> {
        if !host.is_object() {
            return Err(JsValue::from_str(
                "WasmBrowserRuntime host must be a JavaScript object",
            ));
        }

        Ok(Self {
            host: host.unchecked_into::<BrowserRuntimeHost>(),
        })
    }

    #[wasm_bindgen(js_name = runtimeInfo)]
    pub fn runtime_info(&self) -> Result<JsValue, JsValue> {
        encode_js_value(&RuntimeInfo {
            runtime_family: "wasm_v2",
            status: "bootstrap_only",
            message: "The wasm_v2 browser export crate is packaged, but the full browser runtime bridge is not connected yet.",
        })
    }

    #[wasm_bindgen(js_name = contractVersion)]
    pub fn contract_version(&self) -> String {
        "wasm_v2.browser.bootstrap.v1".to_string()
    }
}

fn encode_js_value<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: Serialize,
{
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}
