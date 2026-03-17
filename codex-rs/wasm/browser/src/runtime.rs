use std::sync::Arc;

use async_channel::unbounded;
use codex_app_server_protocol::ClientNotification;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::InitializeParams;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::JSONRPCError;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::JSONRPCNotification;
use codex_app_server_protocol::JSONRPCRequest;
use codex_app_server_protocol::JSONRPCResponse;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use tokio::sync::Mutex;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::bootstrap_bridge::ensure_bootstrap_loaded;
use crate::event_bridge::enqueue_host_server_notification;
use crate::event_bridge::enqueue_server_notification;
use crate::host::BrowserRuntimeHost;
use crate::host::JsHost;
use crate::mapping::initialize_user_agent;
use crate::rpc::app_server_error;
use crate::rpc::decode_js_value;
use crate::rpc::encode_js_value;
use crate::rpc::invalid_params_error;
use crate::rpc::invalid_request_error;
use crate::rpc::method_error;
use crate::rpc::success_response;
use crate::state::RuntimeState;
use crate::thread_host::install_loaded_thread;
use crate::thread_host::loaded_thread_app_server;
use crate::thread_host::pending_server_response_target;
use crate::thread_host::sync_loaded_thread_record;
use codex_wasm_app_server::RequestTarget;
use codex_wasm_app_server::RootRequestResult;
use codex_wasm_app_server::process_loaded_thread_request;
use codex_wasm_app_server::process_loaded_thread_server_response;
use codex_wasm_app_server::process_root_or_thread_start_request;
use codex_wasm_app_server::request_target;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo<'a> {
    runtime_family: &'a str,
    status: &'a str,
    message: &'a str,
}

#[wasm_bindgen]
pub struct WasmBrowserRuntime {
    host: JsHost,
    state: Arc<Mutex<RuntimeState>>,
}

#[wasm_bindgen]
impl WasmBrowserRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(host: JsValue) -> Result<Self, JsValue> {
        console_error_panic_hook::set_once();
        if !host.is_object() {
            return Err(JsValue::from_str(
                "WasmBrowserRuntime host must be a JavaScript object",
            ));
        }

        let host = host.unchecked_into::<BrowserRuntimeHost>();
        let host = JsHost::new(host);
        let (outgoing_tx, outgoing_rx) = unbounded();
        Ok(Self {
            host,
            state: Arc::new(Mutex::new(RuntimeState::new(outgoing_tx, outgoing_rx))),
        })
    }

    #[wasm_bindgen(js_name = runtimeInfo)]
    pub fn runtime_info(&self) -> Result<JsValue, JsValue> {
        encode_js_value(&RuntimeInfo {
            runtime_family: "wasm",
            status: "app_server_v2",
            message: "wasm browser runtime exposes an in-memory app-server protocol facade over the mirror-track browser core.",
        })
    }

    #[wasm_bindgen(js_name = contractVersion)]
    pub fn contract_version(&self) -> String {
        "app_server.v2.browser.in_memory.v1".to_string()
    }

    #[wasm_bindgen(js_name = send)]
    pub async fn send(&self, message: JsValue) -> Result<JsValue, JsValue> {
        let message: JSONRPCMessage = decode_js_value(message)?;
        self.ensure_bootstrap_loaded().await?;
        match message {
            JSONRPCMessage::Request(request) => {
                let response = self.handle_client_request(request).await;
                encode_js_value(&response)
            }
            JSONRPCMessage::Notification(notification) => {
                self.handle_client_notification(notification).await?;
                Ok(JsValue::NULL)
            }
            JSONRPCMessage::Response(response) => {
                self.handle_server_response(response.id, Ok(response.result))
                    .await?;
                Ok(JsValue::NULL)
            }
            JSONRPCMessage::Error(error) => {
                let message = error.error.message;
                self.handle_server_response(error.id, Err(message)).await?;
                Ok(JsValue::NULL)
            }
        }
    }

    #[wasm_bindgen(js_name = nextMessage)]
    pub async fn next_message(&self) -> Result<JsValue, JsValue> {
        let rx = {
            let state = self.state.lock().await;
            state.outgoing_rx.clone()
        };
        match rx.recv().await {
            Ok(message) => encode_js_value(&message),
            Err(_) => Ok(JsValue::NULL),
        }
    }

    #[wasm_bindgen(js_name = enqueueNotification)]
    pub async fn enqueue_notification(&self, notification: JsValue) -> Result<(), JsValue> {
        self.ensure_bootstrap_loaded().await?;
        let notification: ServerNotification = decode_js_value(notification)?;
        enqueue_host_server_notification(&self.state, notification).await;
        Ok(())
    }
}

impl WasmBrowserRuntime {
    async fn ensure_bootstrap_loaded(&self) -> Result<(), JsValue> {
        ensure_bootstrap_loaded(&self.host, &self.state).await
    }

    async fn handle_client_request(&self, request: JSONRPCRequest) -> JSONRPCMessage {
        match self.dispatch_client_request(request).await {
            Ok(result) => JSONRPCMessage::Response(result),
            Err(error) => JSONRPCMessage::Error(error),
        }
    }

    async fn dispatch_client_request(
        &self,
        request: JSONRPCRequest,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let client_request: ClientRequest = serde_json::from_value(
            serde_json::to_value(&request)
                .map_err(|error| invalid_request_error(request.id.clone(), error))?,
        )
        .map_err(|error| invalid_params_error(request.id.clone(), error))?;

        let response = match client_request {
            ClientRequest::Initialize {
                request_id: _,
                params,
            } => self.handle_initialize(request.id.clone(), params).await,
            other => self.handle_request(other).await,
        }?;

        Ok(response)
    }

    async fn handle_client_notification(
        &self,
        notification: JSONRPCNotification,
    ) -> Result<(), JsValue> {
        let notification: ClientNotification = serde_json::from_value(
            serde_json::to_value(notification)
                .map_err(|error| JsValue::from_str(&error.to_string()))?,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        match notification {
            ClientNotification::Initialized => {
                let mut state = self.state.lock().await;
                state.initialized = true;
            }
        }
        Ok(())
    }

    async fn handle_initialize(
        &self,
        id: RequestId,
        _params: InitializeParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        success_response(
            id,
            &InitializeResponse {
                user_agent: initialize_user_agent(),
            },
        )
    }

    async fn handle_request(
        &self,
        request: ClientRequest,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let id = request.id().clone();
        match request_target(&request) {
            Some(RequestTarget::ThreadStart) | Some(RequestTarget::Root) => {
                self.handle_root_or_thread_start_request(request).await
            }
            Some(RequestTarget::LoadedThread { thread_id, .. }) => {
                self.handle_loaded_thread_request(id, request, thread_id)
                    .await
            }
            None => Err(method_error(
                id,
                &format!("unsupported method: {}", request.method()),
            )),
        }
    }

    async fn handle_root_or_thread_start_request(
        &self,
        request: ClientRequest,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let id = request.id().clone();
        let (app_server, bootstrap) = {
            let state = self.state.lock().await;
            (Arc::clone(&state.app_server), state.bootstrap.clone())
        };
        let result = {
            let mut app_server = app_server.lock().await;
            process_root_or_thread_start_request(&mut app_server, request, bootstrap.as_ref()).await
        }
        .map_err(|error| app_server_error(id.clone(), error))?;

        match result {
            RootRequestResult::Response(response) => success_response(id, &response),
            RootRequestResult::LoadedThreadReady(loaded) => {
                let response = loaded.response.clone();
                let notifications = loaded.runtime.notifications.clone();
                for notification in notifications {
                    enqueue_server_notification(&self.state, notification).await;
                }
                install_loaded_thread(&self.state, loaded).await;
                success_response(id, &response)
            }
        }
    }

    async fn handle_loaded_thread_request(
        &self,
        id: RequestId,
        request: ClientRequest,
        thread_id: String,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let method = request.method();
        let app_server =
            loaded_thread_app_server(&self.state, id.clone(), &thread_id, &method).await?;
        let root_app_server = {
            let state = self.state.lock().await;
            Arc::clone(&state.app_server)
        };
        let request_result = {
            let mut thread_app_server = app_server.lock().await;
            process_loaded_thread_request(&mut thread_app_server, request)
                .await
                .map_err(|error| app_server_error(id.clone(), error))?
        };
        if let Some(updated_record) = request_result.updated_record {
            sync_loaded_thread_record(
                &self.state,
                &root_app_server,
                id.clone(),
                &thread_id,
                updated_record,
            )
            .await?;
        }
        success_response(id, &request_result.response)
    }

    async fn handle_server_response(
        &self,
        request_id: RequestId,
        result: Result<serde_json::Value, String>,
    ) -> Result<(), JsValue> {
        let Some((app_server, codex)) =
            pending_server_response_target(&self.state, &request_id).await?
        else {
            return Ok(());
        };
        let response_result = {
            let mut app_server = app_server.lock().await;
            process_loaded_thread_server_response(&mut app_server, request_id, result)
                .map_err(|error| JsValue::from_str(&error.message))?
        };

        codex
            .submit(response_result.resolved.op)
            .await
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        for notification in response_result.notifications {
            enqueue_server_notification(&self.state, notification).await;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::ServerNotification;
    use codex_app_server_protocol::ServerRequest;
    use codex_app_server_protocol::ThreadStartedNotification;
    use codex_app_server_protocol::ThreadStatus;
    use codex_protocol::protocol::SessionSource;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use crate::jsonrpc_bridge::server_notification_to_jsonrpc;
    use crate::jsonrpc_bridge::server_request_to_jsonrpc;
    use crate::mapping::build_thread;
    use crate::mapping::request_resolved_notification;
    use crate::state::ThreadRecord;

    #[test]
    fn thread_started_notification_maps_to_jsonrpc_notification_shape() {
        let record = ThreadRecord {
            id: "thread-1".to_string(),
            preview: String::new(),
            ephemeral: false,
            model_provider: "xrouter-browser".to_string(),
            cwd: PathBuf::from("/workspace"),
            source: SessionSource::Unknown,
            name: None,
            created_at: 10,
            updated_at: 11,
            archived: false,
            turns: BTreeMap::new(),
            active_turn_id: None,
            waiting_on_approval: false,
            waiting_on_user_input: false,
        };
        let notification = ServerNotification::ThreadStarted(ThreadStartedNotification {
            thread: build_thread(&record, false, ThreadStatus::Idle),
        });

        let actual = server_notification_to_jsonrpc(notification);

        assert_eq!(actual.method, "thread/started".to_string());
        assert_eq!(
            actual.params,
            Some(json!({
                "thread": {
                    "id": "thread-1",
                    "preview": "",
                    "ephemeral": false,
                    "modelProvider": "xrouter-browser",
                    "createdAt": 10,
                    "updatedAt": 11,
                    "status": {
                        "type": "idle"
                    },
                    "path": null,
                    "cwd": "/workspace",
                    "cliVersion": env!("CARGO_PKG_VERSION"),
                    "source": "unknown",
                    "agentNickname": null,
                    "agentRole": null,
                    "gitInfo": null,
                    "name": null,
                    "turns": []
                }
            }))
        );
    }

    #[test]
    fn server_request_resolved_maps_to_jsonrpc_notification_shape() {
        let notification =
            request_resolved_notification("thread-1".to_string(), RequestId::Integer(7));

        let actual = server_notification_to_jsonrpc(notification);

        assert_eq!(actual.method, "serverRequest/resolved".to_string());
        assert_eq!(
            actual.params,
            Some(json!({
                "threadId": "thread-1",
                "requestId": 7
            }))
        );
    }

    #[test]
    fn tool_request_user_input_maps_to_jsonrpc_request_shape() {
        let request = ServerRequest::ToolRequestUserInput {
            request_id: RequestId::Integer(3),
            params: codex_app_server_protocol::ToolRequestUserInputParams {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                item_id: "item-1".to_string(),
                questions: vec![codex_app_server_protocol::ToolRequestUserInputQuestion {
                    id: "api_key".to_string(),
                    header: "API Key".to_string(),
                    question: "Provide key".to_string(),
                    is_other: false,
                    is_secret: true,
                    options: Some(vec![
                        codex_app_server_protocol::ToolRequestUserInputOption {
                            label: "Stored".to_string(),
                            description: "Use stored key".to_string(),
                        },
                    ]),
                }],
            },
        };

        let actual = server_request_to_jsonrpc(request);

        assert_eq!(actual.id, RequestId::Integer(3));
        assert_eq!(actual.method, "item/tool/requestUserInput".to_string());
        assert_eq!(
            actual.params,
            Some(json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "questions": [
                    {
                        "id": "api_key",
                        "header": "API Key",
                        "question": "Provide key",
                        "isOther": false,
                        "isSecret": true,
                        "options": [
                            {
                                "label": "Stored",
                                "description": "Use stored key"
                            }
                        ]
                    }
                ]
            }))
        );
        assert_eq!(actual.trace, None);
    }
}
