#[cfg(target_arch = "wasm32")]
mod wasm_exports {
    use crate::app_server_events::browser_dispatch_from_turn;
    use crate::app_server_events::browser_dispatch_without_events;
    use crate::codex::BrowserRuntime as CoreBrowserRuntime;
    use crate::codex::ResumeThreadRequest;
    use crate::codex::RunTurnRequest;
    use crate::codex::StartThreadRequest;
    use crate::host::AccountReadRequest;
    use crate::host::AccountReadResponse;
    use crate::host::ApplyPatchRequest;
    use crate::host::ApplyPatchResponse;
    use crate::host::AuthRefreshContext;
    use crate::host::AuthState;
    use crate::host::ExternalAuthTokens;
    use crate::host::HostCollaboration;
    use crate::host::HostError;
    use crate::host::HostErrorCode;
    use crate::host::HostFs;
    use crate::host::HostInstructionStore;
    use crate::host::HostModelTransport;
    use crate::host::HostNotificationSink;
    use crate::host::HostResult;
    use crate::host::HostSessionStore;
    use crate::host::HostToolExecutor;
    use crate::host::HostToolSpec;
    use crate::host::ListDirRequest;
    use crate::host::ListDirResponse;
    use crate::host::ModelEventStream;
    use crate::host::ModelListRequest;
    use crate::host::ModelListResponse;
    use crate::host::ModelRequest;
    use crate::host::ModelTransportEvent;
    use crate::host::ReadFileRequest;
    use crate::host::ReadFileResponse;
    use crate::host::RequestUserInputRequest;
    use crate::host::RequestUserInputResponse;
    use crate::host::SearchRequest;
    use crate::host::SearchResponse;
    use crate::host::SessionSnapshot;
    use crate::host::ToolInvokeRequest;
    use crate::host::ToolInvokeResponse;
    use crate::host::UpdatePlanRequest;
    use crate::host::WriteFileRequest;
    use crate::host::WriteFileResponse;
    use crate::instructions::InstructionSnapshot;
    use crate::tools::runtime::CollaborationMode;
    use async_trait::async_trait;
    use codex_app_server_protocol::ServerNotification;
    use futures::stream;
    use serde::Deserialize;
    use serde::Serialize;
    use serde::de::DeserializeOwned;
    use serde_json::json;
    use wasm_bindgen::JsCast;
    use wasm_bindgen::JsValue;
    use wasm_bindgen::prelude::wasm_bindgen;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(typescript_type = "BrowserRuntimeHost")]
        pub type BrowserRuntimeHost;

        #[wasm_bindgen(method, catch, js_name = loadSession)]
        async fn load_session(
            this: &BrowserRuntimeHost,
            thread_id: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = loadInstructions)]
        async fn load_instructions(
            this: &BrowserRuntimeHost,
            thread_id: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = saveSession)]
        async fn save_session(
            this: &BrowserRuntimeHost,
            snapshot: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = startModelTurn)]
        async fn start_model_turn(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = cancelModelTurn)]
        async fn cancel_model_turn(
            this: &BrowserRuntimeHost,
            request_id: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = loadAuthState)]
        async fn load_auth_state(this: &BrowserRuntimeHost) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = saveAuthState)]
        async fn save_auth_state(
            this: &BrowserRuntimeHost,
            auth_state: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = clearAuthState)]
        async fn clear_auth_state(this: &BrowserRuntimeHost) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = readAccount)]
        async fn read_account(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = listModels)]
        async fn list_models(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = refreshAuth)]
        async fn refresh_auth(
            this: &BrowserRuntimeHost,
            context: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = readFile)]
        async fn read_file(this: &BrowserRuntimeHost, request: JsValue)
        -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = listDir)]
        async fn list_dir(this: &BrowserRuntimeHost, request: JsValue) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = search)]
        async fn search(this: &BrowserRuntimeHost, request: JsValue) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = writeFile)]
        async fn write_file(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = applyPatch)]
        async fn apply_patch(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = updatePlan)]
        async fn update_plan(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = requestUserInput)]
        async fn request_user_input(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = listTools)]
        async fn list_tools(this: &BrowserRuntimeHost) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = invokeTool)]
        async fn invoke_tool(
            this: &BrowserRuntimeHost,
            request: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = cancelTool)]
        async fn cancel_tool(
            this: &BrowserRuntimeHost,
            call_id: JsValue,
        ) -> Result<JsValue, JsValue>;

        #[wasm_bindgen(method, catch, js_name = emitNotification)]
        async fn emit_notification(
            this: &BrowserRuntimeHost,
            notification: JsValue,
        ) -> Result<JsValue, JsValue>;
    }

    #[wasm_bindgen(typescript_custom_section)]
    const BROWSER_RUNTIME_HOST_TS: &str = r#"
export interface BrowserRuntimeHost {
  loadSession(threadId: string): Promise<import("./protocol").SessionSnapshotPayload | null>;
  loadInstructions(threadId: string): Promise<import("./protocol").JsonValue | null>;
  saveSession(snapshot: import("./protocol").SessionSnapshotPayload): Promise<void>;
  loadAuthState(): Promise<import("./protocol").JsonValue | null>;
  saveAuthState(authState: import("./protocol").JsonValue): Promise<void>;
  clearAuthState(): Promise<void>;
  readAccount(request: { refreshToken: boolean }): Promise<import("./protocol").JsonValue>;
  listModels(request: {
    cursor: string | null;
    limit: number | null;
  }): Promise<import("./protocol").JsonValue>;
  refreshAuth(context: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  readFile(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  listDir(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  search(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  writeFile(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  applyPatch(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  updatePlan(request: import("./protocol").JsonValue): Promise<void>;
  requestUserInput(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  listTools(): Promise<Array<{
    toolName: string;
    toolNamespace: string | null;
    description: string;
    inputSchema: import("./protocol").JsonValue;
  }>>;
  invokeTool(request: import("./protocol").JsonValue): Promise<import("./protocol").JsonValue>;
  cancelTool(callId: string): Promise<void>;
  emitNotification(notification: import("./protocol").JsonValue): Promise<void>;
  startModelTurn(request: {
    requestId: string;
    payload: import("./protocol").JsonValue;
  }): Promise<Array<
    | { type: "started"; requestId: string }
    | { type: "delta"; requestId: string; payload: import("./protocol").JsonValue }
    | { type: "outputItemDone"; requestId: string; item: import("./protocol").JsonValue }
    | { type: "completed"; requestId: string }
    | { type: "failed"; requestId: string; error: import("./protocol").HostError }
  >>;
  cancelModelTurn(requestId: string): Promise<void>;
}
"#;

    #[wasm_bindgen]
    pub struct WasmBrowserRuntime {
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

        #[wasm_bindgen(js_name = startThread)]
        pub async fn start_thread(&self, request: JsValue) -> Result<JsValue, JsValue> {
            let request = decode_js_value::<StartThreadRequest>(request)?;
            let fs = JsHostFs { host: &self.host };
            let collaboration = JsHostCollaboration { host: &self.host };
            let instructions = JsHostInstructionStore { host: &self.host };
            let model_transport = JsHostModelTransport { host: &self.host };
            let notification_sink = JsHostNotificationSink { host: &self.host };
            let session_store = JsHostSessionStore { host: &self.host };
            let tool_executor = JsHostToolExecutor { host: &self.host };
            let runtime = CoreBrowserRuntime::new(
                &fs,
                &collaboration,
                &instructions,
                &model_transport,
                &notification_sink,
                &session_store,
                &tool_executor,
            )
            .with_collaboration_mode(CollaborationMode::Default);
            let dispatch = runtime
                .start_thread(request)
                .await
                .map_err(host_error_to_js_value)?;
            encode_js_value(&browser_dispatch_without_events(dispatch))
        }

        #[wasm_bindgen(js_name = resumeThread)]
        pub async fn resume_thread(&self, request: JsValue) -> Result<JsValue, JsValue> {
            let request = decode_js_value::<ResumeThreadRequest>(request)?;
            let fs = JsHostFs { host: &self.host };
            let collaboration = JsHostCollaboration { host: &self.host };
            let instructions = JsHostInstructionStore { host: &self.host };
            let model_transport = JsHostModelTransport { host: &self.host };
            let notification_sink = JsHostNotificationSink { host: &self.host };
            let session_store = JsHostSessionStore { host: &self.host };
            let tool_executor = JsHostToolExecutor { host: &self.host };
            let runtime = CoreBrowserRuntime::new(
                &fs,
                &collaboration,
                &instructions,
                &model_transport,
                &notification_sink,
                &session_store,
                &tool_executor,
            )
            .with_collaboration_mode(CollaborationMode::Default);
            let dispatch = runtime
                .resume_thread(request)
                .await
                .map_err(host_error_to_js_value)?;
            encode_js_value(&browser_dispatch_without_events(dispatch))
        }

        #[wasm_bindgen(js_name = runTurn)]
        pub async fn run_turn(&self, request: JsValue) -> Result<JsValue, JsValue> {
            let request = decode_js_value::<RunTurnRequest>(request)?;
            let turn_id = request.turn_id.clone();
            let fs = JsHostFs { host: &self.host };
            let collaboration = JsHostCollaboration { host: &self.host };
            let instructions = JsHostInstructionStore { host: &self.host };
            let model_transport = JsHostModelTransport { host: &self.host };
            let notification_sink = JsHostNotificationSink { host: &self.host };
            let session_store = JsHostSessionStore { host: &self.host };
            let tool_executor = JsHostToolExecutor { host: &self.host };
            let runtime = CoreBrowserRuntime::new(
                &fs,
                &collaboration,
                &instructions,
                &model_transport,
                &notification_sink,
                &session_store,
                &tool_executor,
            )
            .with_collaboration_mode(CollaborationMode::Default);
            let dispatch = runtime
                .run_turn(request)
                .await
                .map_err(host_error_to_js_value)?;
            encode_js_value(&browser_dispatch_from_turn(dispatch, &turn_id))
        }

        #[wasm_bindgen(js_name = cancelModelTurn)]
        pub async fn cancel_model_turn(&self, request_id: String) -> Result<(), JsValue> {
            self.host
                .cancel_model_turn(JsValue::from_str(&request_id))
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            Ok(())
        }

        #[wasm_bindgen(js_name = loadAuthState)]
        pub async fn load_auth_state(&self) -> Result<JsValue, JsValue> {
            let value = self
                .host
                .load_auth_state()
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            let auth_state = decode_js_value::<Option<AuthState>>(value)?;
            encode_js_value(&auth_state)
        }

        #[wasm_bindgen(js_name = saveAuthState)]
        pub async fn save_auth_state(&self, auth_state: JsValue) -> Result<(), JsValue> {
            let auth_state = decode_js_value::<AuthState>(auth_state)?;
            let value = encode_js_value(&auth_state)?;
            self.host
                .save_auth_state(value)
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            Ok(())
        }

        #[wasm_bindgen(js_name = clearAuthState)]
        pub async fn clear_auth_state(&self) -> Result<(), JsValue> {
            self.host
                .clear_auth_state()
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            Ok(())
        }

        #[wasm_bindgen(js_name = readAccount)]
        pub async fn read_account(&self, request: JsValue) -> Result<JsValue, JsValue> {
            let request = decode_js_value::<AccountReadRequest>(request)?;
            let request = encode_js_value(&request)?;
            let value = self
                .host
                .read_account(request)
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            let response = decode_js_value::<AccountReadResponse>(value)?;
            encode_js_value(&response)
        }

        #[wasm_bindgen(js_name = listModels)]
        pub async fn list_models(&self, request: JsValue) -> Result<JsValue, JsValue> {
            let request = decode_js_value::<ModelListRequest>(request)?;
            let request = encode_js_value(&request)?;
            let value = self
                .host
                .list_models(request)
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            let response = decode_js_value::<ModelListResponse>(value)?;
            encode_js_value(&response)
        }

        #[wasm_bindgen(js_name = refreshAuth)]
        pub async fn refresh_auth(&self, context: JsValue) -> Result<JsValue, JsValue> {
            let context = decode_js_value::<AuthRefreshContext>(context)?;
            let context = encode_js_value(&context)?;
            let value = self
                .host
                .refresh_auth(context)
                .await
                .map_err(js_value_to_host_error)
                .map_err(host_error_to_js_value)?;
            let response = decode_js_value::<ExternalAuthTokens>(value)?;
            encode_js_value(&response)
        }
    }

    #[derive(Debug, Clone, PartialEq, Deserialize)]
    #[serde(tag = "type", rename_all = "camelCase")]
    enum JsModelEvent {
        Started {
            #[serde(rename = "requestId", alias = "request_id")]
            request_id: String,
        },
        Delta {
            #[serde(rename = "requestId", alias = "request_id")]
            request_id: String,
            payload: serde_json::Value,
        },
        OutputItemDone {
            #[serde(rename = "requestId", alias = "request_id")]
            request_id: String,
            item: codex_protocol::models::ResponseItem,
        },
        Completed {
            #[serde(rename = "requestId", alias = "request_id")]
            request_id: String,
        },
        Failed {
            #[serde(rename = "requestId", alias = "request_id")]
            request_id: String,
            error: HostError,
        },
    }

    struct JsHostFs<'a> {
        host: &'a BrowserRuntimeHost,
    }

    unsafe impl Send for JsHostFs<'_> {}
    unsafe impl Sync for JsHostFs<'_> {}

    #[async_trait(?Send)]
    impl<'a> HostFs for JsHostFs<'a> {
        async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .read_file(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn list_dir(&self, request: ListDirRequest) -> HostResult<ListDirResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .list_dir(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn search(&self, request: SearchRequest) -> HostResult<SearchResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .search(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn write_file(&self, request: WriteFileRequest) -> HostResult<WriteFileResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .write_file(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn apply_patch(&self, request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .apply_patch(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }
    }

    struct JsHostToolExecutor<'a> {
        host: &'a BrowserRuntimeHost,
    }

    unsafe impl Send for JsHostToolExecutor<'_> {}
    unsafe impl Sync for JsHostToolExecutor<'_> {}

    #[async_trait(?Send)]
    impl<'a> HostToolExecutor for JsHostToolExecutor<'a> {
        async fn list_tools(&self) -> HostResult<Vec<HostToolSpec>> {
            let value = self
                .host
                .list_tools()
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn invoke(&self, request: ToolInvokeRequest) -> HostResult<ToolInvokeResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .invoke_tool(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn cancel(&self, call_id: String) -> HostResult<()> {
            self.host
                .cancel_tool(JsValue::from_str(&call_id))
                .await
                .map_err(js_value_to_host_error)?;
            Ok(())
        }
    }

    struct JsHostModelTransport<'a> {
        host: &'a BrowserRuntimeHost,
    }

    struct JsHostNotificationSink<'a> {
        host: &'a BrowserRuntimeHost,
    }

    unsafe impl Send for JsHostModelTransport<'_> {}
    unsafe impl Sync for JsHostModelTransport<'_> {}
    unsafe impl Send for JsHostNotificationSink<'_> {}
    unsafe impl Sync for JsHostNotificationSink<'_> {}

    #[async_trait(?Send)]
    impl<'a> HostModelTransport for JsHostModelTransport<'a> {
        async fn start_stream(&self, request: ModelRequest) -> HostResult<ModelEventStream> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .start_model_turn(value)
                .await
                .map_err(js_value_to_host_error)?;
            let events =
                decode_js_value::<Vec<JsModelEvent>>(value).map_err(js_value_decode_error)?;
            let events = events
                .into_iter()
                .map(js_model_event_to_host_event)
                .collect::<Vec<_>>();
            Ok(Box::pin(stream::iter(events)))
        }

        async fn cancel(&self, request_id: String) -> HostResult<()> {
            self.host
                .cancel_model_turn(JsValue::from_str(&request_id))
                .await
                .map_err(js_value_to_host_error)?;
            Ok(())
        }
    }

    #[async_trait(?Send)]
    impl<'a> HostNotificationSink for JsHostNotificationSink<'a> {
        async fn emit_notification(&self, notification: ServerNotification) -> HostResult<()> {
            let value = encode_js_value(&notification).map_err(js_value_encode_error)?;
            self.host
                .emit_notification(value)
                .await
                .map_err(js_value_to_host_error)?;
            Ok(())
        }
    }

    struct JsHostSessionStore<'a> {
        host: &'a BrowserRuntimeHost,
    }

    unsafe impl Send for JsHostSessionStore<'_> {}
    unsafe impl Sync for JsHostSessionStore<'_> {}

    #[async_trait(?Send)]
    impl<'a> HostSessionStore for JsHostSessionStore<'a> {
        async fn load_thread(&self, thread_id: String) -> HostResult<Option<SessionSnapshot>> {
            let value = self
                .host
                .load_session(JsValue::from_str(&thread_id))
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }

        async fn save_thread(&self, snapshot: SessionSnapshot) -> HostResult<()> {
            let value = encode_js_value(&snapshot).map_err(js_value_encode_error)?;
            self.host
                .save_session(value)
                .await
                .map_err(js_value_to_host_error)?;
            Ok(())
        }
    }

    struct JsHostInstructionStore<'a> {
        host: &'a BrowserRuntimeHost,
    }

    unsafe impl Send for JsHostInstructionStore<'_> {}
    unsafe impl Sync for JsHostInstructionStore<'_> {}

    #[async_trait(?Send)]
    impl<'a> HostInstructionStore for JsHostInstructionStore<'a> {
        async fn load_instructions(
            &self,
            thread_id: String,
        ) -> HostResult<Option<InstructionSnapshot>> {
            let value = self
                .host
                .load_instructions(JsValue::from_str(&thread_id))
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }
    }

    struct JsHostCollaboration<'a> {
        host: &'a BrowserRuntimeHost,
    }

    unsafe impl Send for JsHostCollaboration<'_> {}
    unsafe impl Sync for JsHostCollaboration<'_> {}

    #[async_trait(?Send)]
    impl<'a> HostCollaboration for JsHostCollaboration<'a> {
        async fn update_plan(&self, request: UpdatePlanRequest) -> HostResult<()> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            self.host
                .update_plan(value)
                .await
                .map_err(js_value_to_host_error)?;
            Ok(())
        }

        async fn request_user_input(
            &self,
            request: RequestUserInputRequest,
        ) -> HostResult<RequestUserInputResponse> {
            let value = encode_js_value(&request).map_err(js_value_encode_error)?;
            let value = self
                .host
                .request_user_input(value)
                .await
                .map_err(js_value_to_host_error)?;
            decode_js_value(value).map_err(js_value_decode_error)
        }
    }

    fn js_model_event_to_host_event(event: JsModelEvent) -> ModelTransportEvent {
        match event {
            JsModelEvent::Started { request_id } => ModelTransportEvent::Started { request_id },
            JsModelEvent::Delta {
                request_id,
                payload,
            } => ModelTransportEvent::Delta {
                request_id,
                payload,
            },
            JsModelEvent::OutputItemDone { request_id, item } => {
                ModelTransportEvent::OutputItemDone { request_id, item }
            }
            JsModelEvent::Completed { request_id } => ModelTransportEvent::Completed { request_id },
            JsModelEvent::Failed { request_id, error } => {
                ModelTransportEvent::Failed { request_id, error }
            }
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

    fn host_error_to_js_value(error: HostError) -> JsValue {
        serde_wasm_bindgen::to_value(&error).unwrap_or_else(|serialization_error| {
            JsValue::from_str(&format!(
                "failed to serialize host error: {serialization_error}"
            ))
        })
    }

    fn js_value_to_host_error(value: JsValue) -> HostError {
        serde_wasm_bindgen::from_value::<HostError>(value.clone()).unwrap_or_else(|_| {
            if let Some(error) = value.dyn_ref::<js_sys::Error>() {
                let message = error.message().as_string().unwrap_or_default();
                let name = error.name().as_string().unwrap_or_default();
                let stack = js_sys::Reflect::get(error, &JsValue::from_str("stack"))
                    .ok()
                    .and_then(|value| value.as_string());
                return HostError {
                    code: HostErrorCode::Internal,
                    message: if name.is_empty() {
                        message
                    } else {
                        format!("{name}: {message}")
                    },
                    retryable: false,
                    data: Some(json!({
                        "name": if name.is_empty() { None::<String> } else { Some(name) },
                        "stack": stack,
                    })),
                };
            }

            HostError {
                code: HostErrorCode::Internal,
                message: value
                    .as_string()
                    .unwrap_or_else(|| "browser runtime host call failed".to_string()),
                retryable: false,
                data: None,
            }
        })
    }

    fn js_value_decode_error(error: JsValue) -> HostError {
        HostError {
            code: HostErrorCode::Internal,
            message: error
                .as_string()
                .unwrap_or_else(|| "failed to decode browser runtime host payload".to_string()),
            retryable: false,
            data: None,
        }
    }

    fn js_value_encode_error(error: JsValue) -> HostError {
        HostError {
            code: HostErrorCode::Internal,
            message: error
                .as_string()
                .unwrap_or_else(|| "failed to encode browser runtime host payload".to_string()),
            retryable: false,
            data: None,
        }
    }
}
