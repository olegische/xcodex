use std::path::PathBuf;
use std::sync::Arc;

use async_channel::unbounded;
use codex_app_server_protocol::AppsListParams;
use codex_app_server_protocol::AskForApproval;
use codex_app_server_protocol::ClientNotification;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::InitializeParams;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::JSONRPCError;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::JSONRPCNotification;
use codex_app_server_protocol::JSONRPCRequest;
use codex_app_server_protocol::JSONRPCResponse;
use codex_app_server_protocol::McpServerElicitationRequestResponse;
use codex_app_server_protocol::ModelListParams;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::ThreadReadParams;
use codex_app_server_protocol::ThreadStartParams;
use codex_app_server_protocol::ThreadStartResponse;
use codex_app_server_protocol::TurnInterruptParams;
use codex_app_server_protocol::TurnInterruptResponse;
use codex_app_server_protocol::TurnStartParams;
use codex_app_server_protocol::TurnSteerParams;
use codex_app_server_protocol::TurnSteerResponse;
use codex_protocol::config_types::SandboxMode as CoreSandboxMode;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::InitialHistory;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::SessionSource;
use codex_wasm_v2_core::BrowserCodexSpawnArgs;
use codex_wasm_v2_core::codex::Codex;
use codex_wasm_v2_core::config::Config;
use codex_wasm_v2_core::spawn_browser_codex;
use tokio::sync::Mutex;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen_futures::spawn_local;
#[cfg(target_arch = "wasm32")]
use web_sys::console;

use crate::host::BrowserBootstrap;
use crate::host::BrowserRuntimeHost;
use crate::host::JsHost;
use crate::mapping::abort_reason_to_turn_status;
use crate::mapping::apply_item_completed;
use crate::mapping::apply_item_started;
use crate::mapping::build_thread;
use crate::mapping::default_turn_error;
use crate::mapping::delta_notification;
use crate::mapping::dynamic_tool_response_to_core;
use crate::mapping::exec_decision_to_core;
use crate::mapping::fallback_dynamic_tool_response;
use crate::mapping::fallback_request_permissions_response;
use crate::mapping::fallback_user_input_response;
use crate::mapping::file_change_decision_to_core;
use crate::mapping::initialize_user_agent;
use crate::mapping::item_completed_notification;
use crate::mapping::item_started_notification;
use crate::mapping::map_apps_list;
use crate::mapping::map_model_list;
use crate::mapping::map_server_request;
use crate::mapping::now_unix_seconds;
use crate::mapping::permissions_request_args_from_response;
use crate::mapping::request_resolved_notification;
use crate::mapping::thread_read_response;
use crate::mapping::thread_started_notification;
use crate::mapping::tool_request_user_input_response_to_core;
use crate::mapping::turn_completed_notification;
use crate::mapping::turn_start_response;
use crate::mapping::turn_started_notification;
use crate::mapping::update_item_with_delta;
use crate::state::LoadedThread;
use crate::state::PendingServerRequest;
use crate::state::RuntimeBootstrap;
use crate::state::RuntimeState;
use crate::state::ThreadRecord;
use crate::state::TurnRecord;

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
            runtime_family: "wasm_v2",
            status: "app_server_v2",
            message: "wasm_v2 browser runtime exposes an in-memory app-server protocol facade over the mirror-track browser core.",
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
}

impl WasmBrowserRuntime {
    async fn ensure_bootstrap_loaded(&self) -> Result<(), JsValue> {
        let already_loaded = {
            let state = self.state.lock().await;
            state.bootstrap.is_some()
        };
        if already_loaded {
            return Ok(());
        }

        let bootstrap = self.host.load_bootstrap().await?;
        let browser_fs = self.host.browser_fs();
        let discoverable_apps_provider = self.host.discoverable_apps_provider();
        let model_transport_host = self.host.model_transport_host();
        let config = build_bootstrap_config(&bootstrap);
        let bootstrap = RuntimeBootstrap {
            auth: bootstrap.auth(),
            model_catalog: bootstrap.model_catalog.clone(),
            config,
            browser_fs,
            discoverable_apps_provider,
            model_transport_host,
        };

        let mut state = self.state.lock().await;
        if state.bootstrap.is_none() {
            state.bootstrap = Some(bootstrap);
        }
        Ok(())
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
            ClientRequest::ThreadStart {
                request_id: _,
                params,
            } => self.handle_thread_start(request.id.clone(), params).await,
            ClientRequest::ThreadRead {
                request_id: _,
                params,
            } => self.handle_thread_read(request.id.clone(), params).await,
            ClientRequest::TurnStart {
                request_id: _,
                params,
            } => self.handle_turn_start(request.id.clone(), params).await,
            ClientRequest::TurnSteer {
                request_id: _,
                params,
            } => self.handle_turn_steer(request.id.clone(), params).await,
            ClientRequest::TurnInterrupt {
                request_id: _,
                params,
            } => self.handle_turn_interrupt(request.id.clone(), params).await,
            ClientRequest::ModelList {
                request_id: _,
                params,
            } => self.handle_model_list(request.id.clone(), params).await,
            ClientRequest::AppsList {
                request_id: _,
                params,
            } => self.handle_apps_list(request.id.clone(), params).await,
            _ => Err(method_not_found_error(
                request.id.clone(),
                request.method.as_str(),
            )),
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

    async fn handle_thread_start(
        &self,
        id: RequestId,
        params: ThreadStartParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let bootstrap = self.bootstrap_or_internal(id.clone()).await?;
        let mut config = bootstrap.config.clone();
        apply_thread_start_overrides(&mut config, &params);
        let model = resolve_model(
            params.model.clone().or_else(|| config.model.clone()),
            bootstrap.model_catalog.as_ref(),
        );
        config.model = Some(model.clone());

        let browser_fs = Arc::clone(&bootstrap.browser_fs);
        let discoverable_apps_provider = Arc::clone(&bootstrap.discoverable_apps_provider);
        let model_transport_host = Arc::clone(&bootstrap.model_transport_host);
        let model_catalog = bootstrap.model_catalog.clone();
        let spawn = spawn_browser_codex(BrowserCodexSpawnArgs {
            config: config.clone(),
            auth: bootstrap.auth.clone(),
            model_catalog,
            conversation_history: InitialHistory::New,
            session_source: SessionSource::Unknown,
            dynamic_tools: params
                .dynamic_tools
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|tool| codex_protocol::dynamic_tools::DynamicToolSpec {
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.input_schema,
                })
                .collect(),
            persist_extended_history: params.persist_extended_history,
            metrics_service_name: None,
            inherited_shell_snapshot: None,
            parent_trace: None,
            browser_fs,
            discoverable_apps_provider,
            model_transport_host,
        })
        .await
        .map_err(|error| internal_error(id.clone(), error))?;

        let thread_id = spawn.thread_id.to_string();
        let timestamp = now_unix_seconds();
        let record = ThreadRecord {
            id: thread_id.clone(),
            preview: String::new(),
            ephemeral: params.ephemeral.unwrap_or(config.ephemeral),
            model_provider: config.model_provider_id.clone(),
            cwd: config.cwd.clone(),
            source: SessionSource::Unknown,
            name: None,
            created_at: timestamp,
            updated_at: timestamp,
            turns: Default::default(),
            active_turn_id: None,
            waiting_on_approval: false,
            waiting_on_user_input: false,
        };
        let codex = Arc::new(spawn.codex);

        {
            let mut state = self.state.lock().await;
            state.threads.insert(
                thread_id.clone(),
                LoadedThread {
                    codex: Arc::clone(&codex),
                    record,
                },
            );
        }

        self.enqueue_notification_for_thread_started(&thread_id)
            .await?;
        self.spawn_event_pump(thread_id.clone(), codex);

        let state = self.state.lock().await;
        let loaded = state
            .threads
            .get(&thread_id)
            .ok_or_else(|| internal_error(id.clone(), "thread missing after spawn"))?;
        let response = ThreadStartResponse {
            thread: build_thread(&loaded.record, false, loaded.record.protocol_status()),
            model,
            model_provider: config.model_provider_id.clone(),
            service_tier: config.service_tier,
            cwd: config.cwd.clone(),
            approval_policy: params.approval_policy.unwrap_or_else(|| {
                AskForApproval::from(config.permissions.approval_policy.value())
            }),
            sandbox: config.permissions.sandbox_policy.get().clone().into(),
            reasoning_effort: config.model_reasoning_effort,
        };
        success_response(id, &response)
    }

    async fn handle_thread_read(
        &self,
        id: RequestId,
        params: ThreadReadParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let state = self.state.lock().await;
        let loaded = state
            .threads
            .get(&params.thread_id)
            .ok_or_else(|| method_error(id.clone(), "thread/read requires a loaded thread"))?;
        let response = thread_read_response(
            &loaded.record,
            loaded.record.protocol_status(),
            params.include_turns,
        );
        success_response(id, &response)
    }

    async fn handle_turn_start(
        &self,
        id: RequestId,
        params: TurnStartParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        browser_log(&format!(
            "[wasm_v2/browser] handle_turn_start begin thread_id={} input_items={}",
            params.thread_id,
            params.input.len()
        ));
        let codex = {
            let state = self.state.lock().await;
            let loaded = state
                .threads
                .get(&params.thread_id)
                .ok_or_else(|| method_error(id.clone(), "turn/start requires a loaded thread"))?;
            Arc::clone(&loaded.codex)
        };

        browser_log("[wasm_v2/browser] handle_turn_start loaded codex");
        let bootstrap = self.bootstrap_or_internal(id.clone()).await?;
        browser_log("[wasm_v2/browser] handle_turn_start loaded bootstrap");
        let active_model = resolve_model(
            params
                .model
                .clone()
                .or_else(|| bootstrap.config.model.clone()),
            bootstrap.model_catalog.as_ref(),
        );
        browser_log(&format!(
            "[wasm_v2/browser] handle_turn_start resolved model={active_model}"
        ));
        let preview = params
            .input
            .iter()
            .find_map(|item| match item {
                codex_app_server_protocol::UserInput::Text { text, .. } => Some(text.clone()),
                _ => None,
            })
            .unwrap_or_default();
        let op = Op::UserTurn {
            items: params
                .input
                .into_iter()
                .map(codex_app_server_protocol::UserInput::into_core)
                .collect(),
            cwd: params
                .cwd
                .clone()
                .unwrap_or_else(|| bootstrap.config.cwd.clone()),
            approval_policy: params
                .approval_policy
                .map(codex_app_server_protocol::AskForApproval::to_core)
                .unwrap_or_else(|| bootstrap.config.permissions.approval_policy.value()),
            sandbox_policy: params
                .sandbox_policy
                .clone()
                .map(|policy| policy.to_core())
                .unwrap_or_else(|| bootstrap.config.permissions.sandbox_policy.get().clone()),
            model: active_model,
            effort: params.effort,
            summary: params.summary,
            service_tier: params.service_tier,
            final_output_json_schema: params.output_schema,
            collaboration_mode: params.collaboration_mode,
            personality: params.personality,
        };
        browser_log("[wasm_v2/browser] handle_turn_start built op, submitting");
        let turn_id = codex
            .submit(op)
            .await
            .map_err(|error| internal_error(id.clone(), error))?;
        browser_log(&format!(
            "[wasm_v2/browser] handle_turn_start submit returned turn_id={turn_id}"
        ));

        {
            let mut state = self.state.lock().await;
            let loaded = state
                .threads
                .get_mut(&params.thread_id)
                .ok_or_else(|| method_error(id.clone(), "turn/start requires a loaded thread"))?;
            loaded.record.updated_at = now_unix_seconds();
            loaded.record.active_turn_id = Some(turn_id.clone());
            loaded.record.turns.insert(
                turn_id.clone(),
                TurnRecord {
                    id: turn_id.clone(),
                    items: Vec::new(),
                    status: codex_app_server_protocol::TurnStatus::InProgress,
                    error: None,
                },
            );
            if loaded.record.preview.is_empty() {
                loaded.record.preview = preview;
            }
        }

        success_response(id, &turn_start_response(turn_id))
    }

    async fn handle_turn_steer(
        &self,
        id: RequestId,
        params: TurnSteerParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let codex = {
            let state = self.state.lock().await;
            let loaded = state
                .threads
                .get(&params.thread_id)
                .ok_or_else(|| method_error(id.clone(), "turn/steer requires a loaded thread"))?;
            Arc::clone(&loaded.codex)
        };
        let turn_id = codex
            .steer_input(
                params
                    .input
                    .into_iter()
                    .map(codex_app_server_protocol::UserInput::into_core)
                    .collect(),
                Some(params.expected_turn_id.as_str()),
            )
            .await
            .map_err(|error| method_error(id.clone(), &format!("turn/steer failed: {error:?}")))?;
        success_response(id, &TurnSteerResponse { turn_id })
    }

    async fn handle_turn_interrupt(
        &self,
        id: RequestId,
        params: TurnInterruptParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let codex = {
            let state = self.state.lock().await;
            let loaded = state.threads.get(&params.thread_id).ok_or_else(|| {
                method_error(id.clone(), "turn/interrupt requires a loaded thread")
            })?;
            if loaded.record.active_turn_id.as_deref() != Some(params.turn_id.as_str()) {
                return Err(method_error(
                    id.clone(),
                    "turn/interrupt expected the currently active turn id",
                ));
            }
            Arc::clone(&loaded.codex)
        };
        codex
            .submit(Op::Interrupt)
            .await
            .map_err(|error| internal_error(id.clone(), error))?;
        success_response(id, &TurnInterruptResponse {})
    }

    async fn handle_model_list(
        &self,
        id: RequestId,
        params: ModelListParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let bootstrap = self.bootstrap_or_internal(id.clone()).await?;
        let models = bootstrap
            .model_catalog
            .map(|catalog| catalog.models)
            .unwrap_or_default();
        let response = map_model_list(models, params.include_hidden.unwrap_or(false));
        success_response(id, &response)
    }

    async fn handle_apps_list(
        &self,
        id: RequestId,
        _params: AppsListParams,
    ) -> Result<JSONRPCResponse, JSONRPCError> {
        let bootstrap = self.bootstrap_or_internal(id.clone()).await?;
        let apps = bootstrap
            .discoverable_apps_provider
            .list_discoverable_apps()
            .await
            .map_err(|error| internal_error(id.clone(), error))?;
        success_response(id, &map_apps_list(apps))
    }

    fn spawn_event_pump(&self, thread_id: String, codex: Arc<Codex>) {
        let state = Arc::clone(&self.state);
        spawn_local(async move {
            loop {
                let event = match codex.next_event().await {
                    Ok(event) => event,
                    Err(_) => break,
                };
                if process_core_event(&state, &thread_id, event).await.is_err() {
                    break;
                }
            }
        });
    }

    async fn enqueue_notification_for_thread_started(
        &self,
        thread_id: &str,
    ) -> Result<(), JSONRPCError> {
        let notification = {
            let state = self.state.lock().await;
            let loaded = state.threads.get(thread_id).ok_or_else(|| {
                internal_error(
                    RequestId::String("thread/start".to_string()),
                    "thread missing",
                )
            })?;
            thread_started_notification(&loaded.record, loaded.record.protocol_status())
        };
        enqueue_server_notification(&self.state, notification).await;
        Ok(())
    }

    async fn handle_server_response(
        &self,
        request_id: RequestId,
        result: Result<serde_json::Value, String>,
    ) -> Result<(), JsValue> {
        let pending = {
            let mut state = self.state.lock().await;
            state.pending_server_requests.remove(&request_id)
        };
        let Some(pending) = pending else {
            return Ok(());
        };
        let (codex, thread_id) = {
            let state = self.state.lock().await;
            let thread_id = match &pending {
                PendingServerRequest::ExecApproval { thread_id, .. }
                | PendingServerRequest::PatchApproval { thread_id, .. }
                | PendingServerRequest::UserInput { thread_id, .. }
                | PendingServerRequest::RequestPermissions { thread_id, .. }
                | PendingServerRequest::DynamicTool { thread_id, .. }
                | PendingServerRequest::Elicitation { thread_id, .. } => thread_id.clone(),
            };
            let loaded = state
                .threads
                .get(&thread_id)
                .ok_or_else(|| JsValue::from_str("thread missing for pending server request"))?;
            (Arc::clone(&loaded.codex), thread_id)
        };

        let op = match pending {
            PendingServerRequest::ExecApproval { id, turn_id, .. } => {
                let decision = match result {
                    Ok(value) => {
                        let response: codex_app_server_protocol::CommandExecutionRequestApprovalResponse =
                            serde_json::from_value(value)
                                .map_err(|error| JsValue::from_str(&error.to_string()))?;
                        exec_decision_to_core(response.decision)
                    }
                    Err(_) => codex_protocol::protocol::ReviewDecision::Abort,
                };
                Op::ExecApproval {
                    id,
                    turn_id: Some(turn_id),
                    decision,
                }
            }
            PendingServerRequest::PatchApproval { id, .. } => {
                let decision = match result {
                    Ok(value) => {
                        let response: codex_app_server_protocol::FileChangeRequestApprovalResponse =
                            serde_json::from_value(value)
                                .map_err(|error| JsValue::from_str(&error.to_string()))?;
                        file_change_decision_to_core(response.decision)
                    }
                    Err(_) => codex_protocol::protocol::ReviewDecision::Abort,
                };
                Op::PatchApproval { id, decision }
            }
            PendingServerRequest::UserInput { id, .. } => {
                let response = match result {
                    Ok(value) => {
                        let response: codex_app_server_protocol::ToolRequestUserInputResponse =
                            serde_json::from_value(value)
                                .map_err(|error| JsValue::from_str(&error.to_string()))?;
                        tool_request_user_input_response_to_core(response)
                    }
                    Err(_) => fallback_user_input_response(),
                };
                Op::UserInputAnswer { id, response }
            }
            PendingServerRequest::RequestPermissions { id, .. } => {
                let response = match result {
                    Ok(value) => {
                        let response: codex_app_server_protocol::PermissionsRequestApprovalResponse =
                            serde_json::from_value(value)
                                .map_err(|error| JsValue::from_str(&error.to_string()))?;
                        permissions_request_args_from_response(response)
                    }
                    Err(_) => fallback_request_permissions_response(),
                };
                Op::RequestPermissionsResponse { id, response }
            }
            PendingServerRequest::DynamicTool { id, .. } => {
                let response = match result {
                    Ok(value) => {
                        let response: codex_app_server_protocol::DynamicToolCallResponse =
                            serde_json::from_value(value)
                                .map_err(|error| JsValue::from_str(&error.to_string()))?;
                        dynamic_tool_response_to_core(response)
                    }
                    Err(_) => fallback_dynamic_tool_response(),
                };
                Op::DynamicToolResponse { id, response }
            }
            PendingServerRequest::Elicitation {
                request_id,
                server_name,
                ..
            } => {
                let response = match result {
                    Ok(value) => {
                        serde_json::from_value::<McpServerElicitationRequestResponse>(value)
                            .map_err(|error| JsValue::from_str(&error.to_string()))?
                    }
                    Err(_) => McpServerElicitationRequestResponse {
                        action: codex_app_server_protocol::McpServerElicitationAction::Cancel,
                        content: None,
                        meta: None,
                    },
                };
                Op::ResolveElicitation {
                    server_name,
                    request_id,
                    decision: response.action.to_core(),
                    content: response.content,
                    meta: response.meta,
                }
            }
        };

        codex
            .submit(op)
            .await
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        enqueue_server_notification(
            &self.state,
            request_resolved_notification(thread_id, request_id),
        )
        .await;
        Ok(())
    }

    async fn bootstrap_or_internal(&self, id: RequestId) -> Result<RuntimeBootstrap, JSONRPCError> {
        self.state
            .lock()
            .await
            .bootstrap
            .clone()
            .ok_or_else(|| internal_error(id, "runtime bootstrap is not loaded"))
    }
}

async fn process_core_event(
    state: &Arc<Mutex<RuntimeState>>,
    thread_id: &str,
    event: codex_protocol::protocol::Event,
) -> Result<(), JsValue> {
    browser_log(&format!(
        "[wasm_v2/browser] process_core_event type={}",
        event_name(&event.msg)
    ));
    let mut outgoing_notifications = Vec::new();
    let mut outgoing_requests = Vec::new();
    {
        let mut state = state.lock().await;
        let request_id = if matches!(
            &event.msg,
            EventMsg::ExecApprovalRequest(_)
                | EventMsg::ApplyPatchApprovalRequest(_)
                | EventMsg::RequestPermissions(_)
                | EventMsg::RequestUserInput(_)
                | EventMsg::ElicitationRequest(_)
                | EventMsg::DynamicToolCallRequest(_)
        ) {
            Some(state.next_request_id())
        } else {
            None
        };
        let loaded = match state.threads.get_mut(thread_id) {
            Some(loaded) => loaded,
            None => return Ok(()),
        };
        loaded.record.updated_at = now_unix_seconds();
        match &event.msg {
            EventMsg::TurnStarted(started) => {
                loaded.record.active_turn_id = Some(started.turn_id.clone());
                loaded
                    .record
                    .turns
                    .entry(started.turn_id.clone())
                    .or_insert(TurnRecord {
                        id: started.turn_id.clone(),
                        items: Vec::new(),
                        status: codex_app_server_protocol::TurnStatus::InProgress,
                        error: None,
                    });
                outgoing_notifications.push(turn_started_notification(thread_id, &started.turn_id));
            }
            EventMsg::TurnComplete(completed) => {
                if let Some(turn) = loaded.record.turns.get_mut(&completed.turn_id) {
                    turn.status = codex_app_server_protocol::TurnStatus::Completed;
                    outgoing_notifications.push(turn_completed_notification(thread_id, turn));
                }
                loaded.record.active_turn_id = None;
                loaded.record.waiting_on_approval = false;
                loaded.record.waiting_on_user_input = false;
            }
            EventMsg::TurnAborted(aborted) => {
                if let Some(turn_id) = aborted.turn_id.as_ref()
                    && let Some(turn) = loaded.record.turns.get_mut(turn_id)
                {
                    turn.status = abort_reason_to_turn_status(&aborted.reason);
                    outgoing_notifications.push(turn_completed_notification(thread_id, turn));
                }
                loaded.record.active_turn_id = None;
                loaded.record.waiting_on_approval = false;
                loaded.record.waiting_on_user_input = false;
            }
            EventMsg::Error(error) => {
                if let Some(turn_id) = loaded.record.active_turn_id.clone()
                    && let Some(turn) = loaded.record.turns.get_mut(&turn_id)
                {
                    turn.status = codex_app_server_protocol::TurnStatus::Failed;
                    turn.error = Some(default_turn_error(error.message.clone()));
                    outgoing_notifications.push(turn_completed_notification(thread_id, turn));
                    loaded.record.active_turn_id = None;
                    loaded.record.waiting_on_approval = false;
                    loaded.record.waiting_on_user_input = false;
                }
            }
            EventMsg::ItemStarted(item) => {
                if let Some(turn) = loaded.record.turns.get_mut(&item.turn_id) {
                    apply_item_started(turn, item.item.clone());
                }
                outgoing_notifications.push(item_started_notification(
                    thread_id,
                    &item.turn_id,
                    item.item.clone(),
                ));
            }
            EventMsg::ItemCompleted(item) => {
                if let Some(turn) = loaded.record.turns.get_mut(&item.turn_id) {
                    apply_item_completed(turn, item.item.clone());
                }
                outgoing_notifications.push(item_completed_notification(
                    thread_id,
                    &item.turn_id,
                    item.item.clone(),
                ));
            }
            EventMsg::AgentMessageContentDelta(delta) => {
                if let Some(turn) = loaded.record.turns.get_mut(&delta.turn_id) {
                    update_item_with_delta(turn, &delta.item_id, &delta.delta, false);
                }
                if let Some(notification) = delta_notification(&event.msg) {
                    outgoing_notifications.push(notification);
                }
            }
            EventMsg::PlanDelta(delta) => {
                if let Some(turn) = loaded.record.turns.get_mut(&delta.turn_id) {
                    update_item_with_delta(turn, &delta.item_id, &delta.delta, true);
                }
                if let Some(notification) = delta_notification(&event.msg) {
                    outgoing_notifications.push(notification);
                }
            }
            EventMsg::ExecApprovalRequest(_)
            | EventMsg::ApplyPatchApprovalRequest(_)
            | EventMsg::RequestPermissions(_)
            | EventMsg::RequestUserInput(_)
            | EventMsg::ElicitationRequest(_)
            | EventMsg::DynamicToolCallRequest(_) => {
                if matches!(
                    &event.msg,
                    EventMsg::ExecApprovalRequest(_)
                        | EventMsg::ApplyPatchApprovalRequest(_)
                        | EventMsg::RequestPermissions(_)
                ) {
                    loaded.record.waiting_on_approval = true;
                }
                if matches!(&event.msg, EventMsg::RequestUserInput(_)) {
                    loaded.record.waiting_on_user_input = true;
                }
                if let Some(request_id) = request_id
                    && let Some((pending, request)) =
                        map_server_request(thread_id, request_id.clone(), &event.msg)
                {
                    state.pending_server_requests.insert(request_id, pending);
                    outgoing_requests.push(request);
                }
            }
            _ => {
                if let Some(notification) = delta_notification(&event.msg) {
                    outgoing_notifications.push(notification);
                }
            }
        }
    }

    for notification in outgoing_notifications {
        enqueue_server_notification(state, notification).await;
    }
    for request in outgoing_requests {
        enqueue_server_request(state, request).await;
    }
    Ok(())
}

fn event_name(event: &EventMsg) -> &'static str {
    match event {
        EventMsg::TurnStarted(_) => "TurnStarted",
        EventMsg::TurnComplete(_) => "TurnComplete",
        EventMsg::TurnAborted(_) => "TurnAborted",
        EventMsg::Error(_) => "Error",
        EventMsg::ItemStarted(_) => "ItemStarted",
        EventMsg::ItemCompleted(_) => "ItemCompleted",
        EventMsg::AgentMessageContentDelta(_) => "AgentMessageContentDelta",
        EventMsg::PlanDelta(_) => "PlanDelta",
        EventMsg::ExecApprovalRequest(_) => "ExecApprovalRequest",
        EventMsg::ApplyPatchApprovalRequest(_) => "ApplyPatchApprovalRequest",
        EventMsg::RequestPermissions(_) => "RequestPermissions",
        EventMsg::RequestUserInput(_) => "RequestUserInput",
        EventMsg::ElicitationRequest(_) => "ElicitationRequest",
        EventMsg::DynamicToolCallRequest(_) => "DynamicToolCallRequest",
        EventMsg::TokenCount(_) => "TokenCount",
        EventMsg::BackgroundEvent(_) => "BackgroundEvent",
        EventMsg::ExecCommandBegin(_) => "ExecCommandBegin",
        EventMsg::ExecCommandEnd(_) => "ExecCommandEnd",
        EventMsg::PatchApplyBegin(_) => "PatchApplyBegin",
        EventMsg::PatchApplyEnd(_) => "PatchApplyEnd",
        EventMsg::McpToolCallBegin(_) => "McpToolCallBegin",
        EventMsg::McpToolCallEnd(_) => "McpToolCallEnd",
        EventMsg::WebSearchBegin(_) => "WebSearchBegin",
        EventMsg::WebSearchEnd(_) => "WebSearchEnd",
        EventMsg::ImageGenerationBegin(_) => "ImageGenerationBegin",
        EventMsg::ImageGenerationEnd(_) => "ImageGenerationEnd",
        EventMsg::AgentReasoningDelta(_) => "AgentReasoningDelta",
        EventMsg::AgentReasoningRawContentDelta(_) => "AgentReasoningRawContentDelta",
        EventMsg::AgentMessageDelta(_) => "AgentMessageDelta",
        EventMsg::DynamicToolCallResponse(_) => "DynamicToolCallResponse",
        EventMsg::TurnDiff(_) => "TurnDiff",
        _ => "Other",
    }
}

async fn enqueue_server_notification(
    state: &Arc<Mutex<RuntimeState>>,
    notification: codex_app_server_protocol::ServerNotification,
) {
    browser_log(&format!(
        "[wasm_v2/browser] enqueue_server_notification {}",
        notification
    ));
    let message = JSONRPCMessage::Notification(server_notification_to_jsonrpc(notification));
    let tx = {
        let state = state.lock().await;
        state.outgoing_tx.clone()
    };
    let _ = tx.send(message).await;
}

async fn enqueue_server_request(state: &Arc<Mutex<RuntimeState>>, request: ServerRequest) {
    let jsonrpc = server_request_to_jsonrpc(request);
    let tx = {
        let state = state.lock().await;
        state.outgoing_tx.clone()
    };
    let _ = tx.send(JSONRPCMessage::Request(jsonrpc)).await;
}

fn success_response<T>(id: RequestId, result: &T) -> Result<JSONRPCResponse, JSONRPCError>
where
    T: serde::Serialize,
{
    let result = serde_json::to_value(result).map_err(|error| internal_error(id.clone(), error))?;
    Ok(JSONRPCResponse { id, result })
}

fn invalid_request_error(id: RequestId, error: impl std::fmt::Display) -> JSONRPCError {
    jsonrpc_error(id, -32600, &format!("invalid request: {error}"))
}

fn invalid_params_error(id: RequestId, error: impl std::fmt::Display) -> JSONRPCError {
    jsonrpc_error(id, -32602, &format!("invalid params: {error}"))
}

fn method_not_found_error(id: RequestId, method: &str) -> JSONRPCError {
    jsonrpc_error(id, -32601, &format!("unsupported method: {method}"))
}

fn method_error(id: RequestId, message: &str) -> JSONRPCError {
    jsonrpc_error(id, -32000, message)
}

fn internal_error(id: RequestId, error: impl std::fmt::Display) -> JSONRPCError {
    jsonrpc_error(id, -32603, &error.to_string())
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

fn server_notification_to_jsonrpc(
    notification: codex_app_server_protocol::ServerNotification,
) -> JSONRPCNotification {
    let value = match serde_json::to_value(&notification) {
        Ok(value) => {
            browser_log(&format!(
                "[wasm_v2/browser] server_notification_to_jsonrpc serialized={value}"
            ));
            value
        }
        Err(error) => {
            browser_error(&format!(
                "[wasm_v2/browser] server notification serialization failed: {error}"
            ));
            unreachable!("server notification should serialize: {error}")
        }
    };
    let mut object = jsonrpc_object_from_value(value);
    let method = jsonrpc_method_from_object(&mut object, "server notification");
    let params = object.remove("params");
    JSONRPCNotification { method, params }
}

fn server_request_to_jsonrpc(request: ServerRequest) -> JSONRPCRequest {
    let value = match serde_json::to_value(&request) {
        Ok(value) => {
            browser_log(&format!(
                "[wasm_v2/browser] server_request_to_jsonrpc serialized={value}"
            ));
            value
        }
        Err(error) => {
            browser_error(&format!(
                "[wasm_v2/browser] server request serialization failed: {error}"
            ));
            unreachable!("server request should serialize: {error}")
        }
    };
    let mut object = jsonrpc_object_from_value(value);
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

fn build_bootstrap_config(bootstrap: &BrowserBootstrap) -> Config {
    let mut config = Config {
        codex_home: PathBuf::from(bootstrap.codex_home.clone()),
        cwd: bootstrap
            .cwd
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(bootstrap.codex_home.clone())),
        model: bootstrap.model.clone(),
        model_provider_id: bootstrap
            .model_provider_id
            .clone()
            .unwrap_or_else(|| "openai".to_string()),
        model_provider: bootstrap
            .model_provider
            .clone()
            .unwrap_or_else(codex_wasm_v2_core::ModelProviderInfo::create_openai_provider),
        service_tier: bootstrap.service_tier.unwrap_or(None),
        model_reasoning_effort: bootstrap.reasoning_effort,
        model_reasoning_summary: bootstrap.reasoning_summary,
        personality: bootstrap.personality,
        base_instructions: bootstrap.base_instructions.clone(),
        developer_instructions: bootstrap.developer_instructions.clone(),
        user_instructions: bootstrap.user_instructions.clone(),
        ephemeral: bootstrap.ephemeral.unwrap_or(false),
        ..Config::default()
    };
    if let Some(approval_policy) = bootstrap.approval_policy {
        let _ = config
            .permissions
            .approval_policy
            .set(approval_policy.to_core());
    }
    if let Some(sandbox_policy) = bootstrap.sandbox_policy.clone() {
        let _ = config.permissions.sandbox_policy.set(sandbox_policy);
    }
    config
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

    use super::server_notification_to_jsonrpc;
    use super::server_request_to_jsonrpc;
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

fn apply_thread_start_overrides(config: &mut Config, params: &ThreadStartParams) {
    if let Some(model) = params.model.clone() {
        config.model = Some(model);
    }
    if let Some(model_provider) = params.model_provider.clone() {
        config.model_provider_id = model_provider;
    }
    if let Some(service_tier) = params.service_tier {
        config.service_tier = service_tier;
    }
    if let Some(cwd) = params.cwd.clone() {
        config.cwd = PathBuf::from(cwd);
    }
    if let Some(approval_policy) = params.approval_policy {
        let _ = config
            .permissions
            .approval_policy
            .set(approval_policy.to_core());
    }
    if let Some(sandbox) = params.sandbox {
        let _ = config
            .permissions
            .sandbox_policy
            .set(sandbox_policy_from_mode(sandbox.to_core()));
    }
    if let Some(base_instructions) = params.base_instructions.clone() {
        config.base_instructions = Some(base_instructions);
    }
    if let Some(developer_instructions) = params.developer_instructions.clone() {
        config.developer_instructions = Some(developer_instructions);
    }
    if let Some(personality) = params.personality {
        config.personality = Some(personality);
    }
    if let Some(ephemeral) = params.ephemeral {
        config.ephemeral = ephemeral;
    }
}

fn resolve_model(
    configured_model: Option<String>,
    model_catalog: Option<&codex_protocol::openai_models::ModelsResponse>,
) -> String {
    configured_model
        .or_else(|| {
            model_catalog
                .and_then(|catalog| catalog.models.first())
                .map(|model| model.slug.clone())
        })
        .unwrap_or_else(|| "gpt-4.1".to_string())
}

fn sandbox_policy_from_mode(mode: CoreSandboxMode) -> codex_protocol::protocol::SandboxPolicy {
    match mode {
        CoreSandboxMode::ReadOnly => {
            codex_protocol::protocol::SandboxPolicy::new_read_only_policy()
        }
        CoreSandboxMode::WorkspaceWrite => {
            codex_protocol::protocol::SandboxPolicy::new_workspace_write_policy()
        }
        CoreSandboxMode::DangerFullAccess => {
            codex_protocol::protocol::SandboxPolicy::DangerFullAccess
        }
    }
}

fn encode_js_value<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: serde::Serialize,
{
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn decode_js_value<T>(value: JsValue) -> Result<T, JsValue>
where
    T: for<'de> serde::Deserialize<'de>,
{
    serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}
