use crate::bridge::AccountPayload;
use crate::bridge::AccountReadResult;
use crate::bridge::AuthRefreshResult;
use crate::bridge::AuthStateLoadResult;
use crate::bridge::AuthStatePayload;
use crate::bridge::BridgeAuthMode;
use crate::bridge::BridgeEvent;
use crate::bridge::BridgeFileEntry;
use crate::bridge::BridgeRequest;
use crate::bridge::BridgeResponse;
use crate::bridge::BridgeToolSpec;
use crate::bridge::EmptyResult;
use crate::bridge::FsApplyPatchResult;
use crate::bridge::FsListDirResult;
use crate::bridge::FsReadFileResult;
use crate::bridge::FsSearchMatch;
use crate::bridge::FsSearchResult;
use crate::bridge::FsWriteFileResult;
use crate::bridge::GitMetadataResult;
use crate::bridge::McpInvokeResult;
use crate::bridge::ModelCompletedEvent;
use crate::bridge::ModelDeltaEvent;
use crate::bridge::ModelFailedEvent;
use crate::bridge::ModelListResult;
use crate::bridge::ModelOutputItemEvent;
use crate::bridge::ModelPresetPayload;
use crate::bridge::ModelStartResult;
use crate::bridge::ModelStartedEvent;
use crate::bridge::SessionLoadResult;
use crate::bridge::SessionSnapshotPayload;
use crate::bridge::ToolCallProgressEvent;
use crate::bridge::ToolInvokeResult;
use crate::bridge::ToolListResult;
use crate::host::AccountReadRequest;
use crate::host::ApplyPatchRequest;
use crate::host::AuthRefreshContext;
use crate::host::AuthRefreshReason;
use crate::host::AuthState;
use crate::host::GitMetadataRequest;
use crate::host::HostAuth;
use crate::host::HostAuthMode;
use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::HostFs;
use crate::host::HostGit;
use crate::host::HostMcp;
use crate::host::HostModelTransport;
use crate::host::HostResult;
use crate::host::HostSessionStore;
use crate::host::HostToolExecutor;
use crate::host::ListDirRequest;
use crate::host::McpInvokeRequest;
use crate::host::ModelListRequest;
use crate::host::ModelRequest;
use crate::host::ModelTransportEvent;
use crate::host::ReadFileRequest;
use crate::host::SearchRequest;
use crate::host::SessionSnapshot;
use crate::host::ToolInvokeRequest;
use crate::host::WriteFileRequest;
use core::pin::Pin;
use futures::StreamExt;
use futures::stream::Stream;

pub type BridgeEventStream = Pin<Box<dyn Stream<Item = BridgeEvent> + Send + 'static>>;

pub enum BridgeDispatchOutcome {
    Response(BridgeResponse),
    ResponseWithEvents {
        response: BridgeResponse,
        events: BridgeEventStream,
    },
}

pub struct BridgeRuntime<'a> {
    fs: &'a dyn HostFs,
    model_transport: &'a dyn HostModelTransport,
    tool_executor: &'a dyn HostToolExecutor,
    session_store: &'a dyn HostSessionStore,
    auth: Option<&'a dyn HostAuth>,
    git: Option<&'a dyn HostGit>,
    mcp: Option<&'a dyn HostMcp>,
}

impl<'a> BridgeRuntime<'a> {
    pub fn new(
        fs: &'a dyn HostFs,
        model_transport: &'a dyn HostModelTransport,
        tool_executor: &'a dyn HostToolExecutor,
        session_store: &'a dyn HostSessionStore,
    ) -> Self {
        Self {
            fs,
            model_transport,
            tool_executor,
            session_store,
            auth: None,
            git: None,
            mcp: None,
        }
    }

    pub fn with_auth(mut self, auth: &'a dyn HostAuth) -> Self {
        self.auth = Some(auth);
        self
    }

    pub fn with_git(mut self, git: &'a dyn HostGit) -> Self {
        self.git = Some(git);
        self
    }

    pub fn with_mcp(mut self, mcp: &'a dyn HostMcp) -> Self {
        self.mcp = Some(mcp);
        self
    }

    pub async fn dispatch(&self, request: BridgeRequest) -> HostResult<BridgeDispatchOutcome> {
        match request {
            BridgeRequest::FsReadFile(params) => {
                let response = self
                    .fs
                    .read_file(ReadFileRequest { path: params.path })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::FsReadFile(
                    FsReadFileResult {
                        path: response.path,
                        content: response.content,
                    },
                )))
            }
            BridgeRequest::FsListDir(params) => {
                let response = self
                    .fs
                    .list_dir(ListDirRequest {
                        path: params.path,
                        recursive: params.recursive,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::FsListDir(
                    FsListDirResult {
                        entries: response
                            .entries
                            .into_iter()
                            .map(|entry| BridgeFileEntry {
                                path: entry.path,
                                is_dir: entry.is_dir,
                                size_bytes: entry.size_bytes,
                            })
                            .collect(),
                    },
                )))
            }
            BridgeRequest::FsSearch(params) => {
                let response = self
                    .fs
                    .search(SearchRequest {
                        path: params.path,
                        query: params.query,
                        case_sensitive: params.case_sensitive,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::FsSearch(
                    FsSearchResult {
                        matches: response
                            .matches
                            .into_iter()
                            .map(|entry| FsSearchMatch {
                                path: entry.path,
                                line_number: entry.line_number,
                                line: entry.line,
                            })
                            .collect(),
                    },
                )))
            }
            BridgeRequest::FsWriteFile(params) => {
                let response = self
                    .fs
                    .write_file(WriteFileRequest {
                        path: params.path,
                        content: params.content,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::FsWriteFile(FsWriteFileResult {
                        path: response.path,
                        bytes_written: response.bytes_written,
                    }),
                ))
            }
            BridgeRequest::FsApplyPatch(params) => {
                let response = self
                    .fs
                    .apply_patch(ApplyPatchRequest {
                        patch: params.patch,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::FsApplyPatch(FsApplyPatchResult {
                        files_changed: response.files_changed,
                    }),
                ))
            }
            BridgeRequest::AuthStateLoad(_) => {
                let Some(auth) = self.auth else {
                    return Err(optional_adapter_unavailable("auth"));
                };
                let auth_state = auth.load_auth_state().await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::AuthStateLoad(AuthStateLoadResult {
                        auth_state: auth_state.map(auth_state_to_payload),
                    }),
                ))
            }
            BridgeRequest::AuthStateSave(params) => {
                let Some(auth) = self.auth else {
                    return Err(optional_adapter_unavailable("auth"));
                };
                auth.save_auth_state(auth_state_from_payload(params.auth_state))
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::AuthStateSave(EmptyResult {}),
                ))
            }
            BridgeRequest::AuthStateClear(_) => {
                let Some(auth) = self.auth else {
                    return Err(optional_adapter_unavailable("auth"));
                };
                auth.clear_auth_state().await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::AuthStateClear(EmptyResult {}),
                ))
            }
            BridgeRequest::AccountRead(params) => {
                let Some(auth) = self.auth else {
                    return Err(optional_adapter_unavailable("auth"));
                };
                let response = auth
                    .read_account(AccountReadRequest {
                        refresh_token: params.refresh_token,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::AccountRead(AccountReadResult {
                        account: response.account.map(|account| AccountPayload {
                            email: account.email,
                            plan_type: account.plan_type,
                            chatgpt_account_id: account.chatgpt_account_id,
                            auth_mode: account.auth_mode.map(auth_mode_to_bridge_mode),
                        }),
                        requires_openai_auth: response.requires_openai_auth,
                    }),
                ))
            }
            BridgeRequest::ModelList(params) => {
                let Some(auth) = self.auth else {
                    return Err(optional_adapter_unavailable("auth"));
                };
                let response = auth
                    .list_models(ModelListRequest {
                        cursor: params.cursor,
                        limit: params.limit,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::ModelList(
                    ModelListResult {
                        data: response
                            .data
                            .into_iter()
                            .map(|model| ModelPresetPayload {
                                id: model.id,
                                display_name: model.display_name,
                                is_default: model.is_default,
                                show_in_picker: model.show_in_picker,
                                supports_api: model.supports_api,
                            })
                            .collect(),
                        next_cursor: response.next_cursor,
                    },
                )))
            }
            BridgeRequest::AuthRefresh(params) => {
                let Some(auth) = self.auth else {
                    return Err(optional_adapter_unavailable("auth"));
                };
                let response = auth
                    .refresh_auth(AuthRefreshContext {
                        reason: match params.reason {
                            crate::bridge::AuthRefreshReason::Unauthorized => {
                                AuthRefreshReason::Unauthorized
                            }
                        },
                        previous_account_id: params.previous_account_id,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::AuthRefresh(AuthRefreshResult {
                        access_token: response.access_token,
                        chatgpt_account_id: response.chatgpt_account_id,
                        chatgpt_plan_type: response.chatgpt_plan_type,
                    }),
                ))
            }
            BridgeRequest::ModelStart(params) => {
                let request_id = params.request_id;
                let stream = self
                    .model_transport
                    .start_stream(ModelRequest {
                        request_id: request_id.clone(),
                        payload: params.payload,
                    })
                    .await?;
                let events = Box::pin(stream.map(model_event_to_bridge_event));
                Ok(BridgeDispatchOutcome::ResponseWithEvents {
                    response: BridgeResponse::ModelStart(ModelStartResult { request_id }),
                    events,
                })
            }
            BridgeRequest::ModelCancel(params) => {
                self.model_transport.cancel(params.request_id).await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::ModelCancel(EmptyResult {}),
                ))
            }
            BridgeRequest::ToolList(_) => {
                let tools = self.tool_executor.list_tools().await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::ToolList(
                    ToolListResult {
                        tools: tools
                            .into_iter()
                            .map(|tool| BridgeToolSpec {
                                name: tool.name,
                                description: tool.description,
                                input_schema: tool.input_schema,
                            })
                            .collect(),
                    },
                )))
            }
            BridgeRequest::ToolInvoke(params) => {
                let response = self
                    .tool_executor
                    .invoke(ToolInvokeRequest {
                        call_id: params.call_id,
                        tool_name: params.tool_name,
                        input: params.input,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::ToolInvoke(
                    ToolInvokeResult {
                        call_id: response.call_id,
                        output: response.output,
                    },
                )))
            }
            BridgeRequest::ToolCancel(params) => {
                self.tool_executor.cancel(params.call_id).await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::ToolCancel(
                    EmptyResult {},
                )))
            }
            BridgeRequest::SessionLoad(params) => {
                let snapshot = self.session_store.load_thread(params.thread_id).await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::SessionLoad(SessionLoadResult {
                        snapshot: snapshot.map(|snapshot| SessionSnapshotPayload {
                            thread_id: snapshot.thread_id,
                            metadata: snapshot.metadata,
                            items: snapshot.items,
                        }),
                    }),
                ))
            }
            BridgeRequest::SessionSave(params) => {
                self.session_store
                    .save_thread(SessionSnapshot {
                        thread_id: params.snapshot.thread_id,
                        metadata: params.snapshot.metadata,
                        items: params.snapshot.items,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::SessionSave(EmptyResult {}),
                ))
            }
            BridgeRequest::GitMetadata(params) => {
                let Some(git) = self.git else {
                    return Err(optional_adapter_unavailable("git"));
                };
                let response = git
                    .metadata(GitMetadataRequest { path: params.path })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(
                    BridgeResponse::GitMetadata(GitMetadataResult {
                        branch: response.branch,
                        commit: response.commit,
                        is_dirty: response.is_dirty,
                    }),
                ))
            }
            BridgeRequest::McpInvoke(params) => {
                let Some(mcp) = self.mcp else {
                    return Err(optional_adapter_unavailable("mcp"));
                };
                let response = mcp
                    .invoke(McpInvokeRequest {
                        server: params.server,
                        method: params.method,
                        params: params.params,
                    })
                    .await?;
                Ok(BridgeDispatchOutcome::Response(BridgeResponse::McpInvoke(
                    McpInvokeResult {
                        result: response.result,
                    },
                )))
            }
        }
    }
}

fn optional_adapter_unavailable(adapter: &str) -> HostError {
    HostError {
        code: HostErrorCode::Unavailable,
        message: format!("optional host adapter `{adapter}` is not configured"),
        retryable: false,
        data: Some(serde_json::json!({
            "adapter": adapter
        })),
    }
}

fn auth_state_to_payload(auth_state: AuthState) -> AuthStatePayload {
    AuthStatePayload {
        auth_mode: auth_mode_to_bridge_mode(auth_state.auth_mode),
        openai_api_key: auth_state.openai_api_key,
        access_token: auth_state.access_token,
        refresh_token: auth_state.refresh_token,
        chatgpt_account_id: auth_state.chatgpt_account_id,
        chatgpt_plan_type: auth_state.chatgpt_plan_type,
        last_refresh_at: auth_state.last_refresh_at,
    }
}

fn auth_state_from_payload(payload: AuthStatePayload) -> AuthState {
    AuthState {
        auth_mode: auth_mode_from_bridge_mode(payload.auth_mode),
        openai_api_key: payload.openai_api_key,
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        chatgpt_account_id: payload.chatgpt_account_id,
        chatgpt_plan_type: payload.chatgpt_plan_type,
        last_refresh_at: payload.last_refresh_at,
    }
}

fn auth_mode_to_bridge_mode(auth_mode: HostAuthMode) -> BridgeAuthMode {
    match auth_mode {
        HostAuthMode::ApiKey => BridgeAuthMode::ApiKey,
        HostAuthMode::Chatgpt => BridgeAuthMode::Chatgpt,
        HostAuthMode::ChatgptAuthTokens => BridgeAuthMode::ChatgptAuthTokens,
    }
}

fn auth_mode_from_bridge_mode(auth_mode: BridgeAuthMode) -> HostAuthMode {
    match auth_mode {
        BridgeAuthMode::ApiKey => HostAuthMode::ApiKey,
        BridgeAuthMode::Chatgpt => HostAuthMode::Chatgpt,
        BridgeAuthMode::ChatgptAuthTokens => HostAuthMode::ChatgptAuthTokens,
    }
}

fn model_event_to_bridge_event(event: ModelTransportEvent) -> BridgeEvent {
    match event {
        ModelTransportEvent::Started { request_id } => {
            BridgeEvent::ModelStarted(ModelStartedEvent { request_id })
        }
        ModelTransportEvent::Delta {
            request_id,
            payload,
        } => BridgeEvent::ModelDelta(ModelDeltaEvent {
            request_id,
            payload,
        }),
        ModelTransportEvent::OutputItemDone { request_id, item } => {
            BridgeEvent::ModelOutputItem(ModelOutputItemEvent { request_id, item })
        }
        ModelTransportEvent::Completed { request_id } => {
            BridgeEvent::ModelCompleted(ModelCompletedEvent { request_id })
        }
        ModelTransportEvent::Failed { request_id, error } => {
            BridgeEvent::ModelFailed(ModelFailedEvent { request_id, error })
        }
    }
}

pub fn tool_progress_event(call_id: String, payload: serde_json::Value) -> BridgeEvent {
    BridgeEvent::ToolCallProgress(ToolCallProgressEvent { call_id, payload })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::bridge::BridgeRequest;
    use crate::bridge::EmptyParams;
    use crate::bridge::FsReadFileParams;
    use crate::bridge::ModelStartParams;
    use crate::host::AccountReadResponse;
    use crate::host::AccountSummary;
    use crate::host::ApplyPatchResponse;
    use crate::host::AuthRefreshContext;
    use crate::host::AuthState;
    use crate::host::ExternalAuthTokens;
    use crate::host::HostAuthMode;
    use crate::host::HostError;
    use crate::host::HostErrorCode;
    use crate::host::HostResult;
    use crate::host::HostToolSpec;
    use crate::host::ListDirResponse;
    use crate::host::ModelEventStream;
    use crate::host::ModelListResponse;
    use crate::host::ReadFileResponse;
    use crate::host::SearchResponse;
    use crate::host::ToolInvokeResponse;
    use crate::host::WriteFileResponse;
    use async_trait::async_trait;
    use futures::StreamExt;
    use futures::stream;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    pub(crate) struct MockFs;
    pub(crate) struct MockModelTransport;
    pub(crate) struct MockToolExecutor;
    pub(crate) struct MockSessionStore;
    pub(crate) struct MockAuth;

    #[async_trait(?Send)]
    impl HostFs for MockFs {
        async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse> {
            Ok(ReadFileResponse {
                path: request.path,
                content: "hello".to_string(),
            })
        }

        async fn list_dir(&self, _request: ListDirRequest) -> HostResult<ListDirResponse> {
            Ok(ListDirResponse {
                entries: Vec::new(),
            })
        }

        async fn search(&self, _request: SearchRequest) -> HostResult<SearchResponse> {
            Ok(SearchResponse {
                matches: Vec::new(),
            })
        }

        async fn write_file(&self, request: WriteFileRequest) -> HostResult<WriteFileResponse> {
            Ok(WriteFileResponse {
                path: request.path,
                bytes_written: request.content.len(),
            })
        }

        async fn apply_patch(&self, _request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse> {
            Ok(ApplyPatchResponse {
                files_changed: vec!["src/lib.rs".to_string()],
            })
        }
    }

    #[async_trait(?Send)]
    impl HostModelTransport for MockModelTransport {
        async fn start_stream(&self, request: ModelRequest) -> HostResult<ModelEventStream> {
            Ok(Box::pin(stream::iter(vec![
                ModelTransportEvent::Started {
                    request_id: request.request_id.clone(),
                },
                ModelTransportEvent::Delta {
                    request_id: request.request_id.clone(),
                    payload: json!({ "delta": "hi" }),
                },
                ModelTransportEvent::Completed {
                    request_id: request.request_id,
                },
            ])))
        }

        async fn cancel(&self, _request_id: String) -> HostResult<()> {
            Ok(())
        }
    }

    #[async_trait(?Send)]
    impl HostToolExecutor for MockToolExecutor {
        async fn list_tools(&self) -> HostResult<Vec<HostToolSpec>> {
            Ok(vec![HostToolSpec {
                name: "readFile".to_string(),
                description: "Read a file".to_string(),
                input_schema: json!({ "type": "object" }),
            }])
        }

        async fn invoke(&self, request: ToolInvokeRequest) -> HostResult<ToolInvokeResponse> {
            Ok(ToolInvokeResponse {
                call_id: request.call_id,
                output: json!({ "ok": true }),
            })
        }

        async fn cancel(&self, _call_id: String) -> HostResult<()> {
            Ok(())
        }
    }

    #[async_trait(?Send)]
    impl HostSessionStore for MockSessionStore {
        async fn load_thread(&self, thread_id: String) -> HostResult<Option<SessionSnapshot>> {
            Ok(Some(SessionSnapshot {
                thread_id,
                metadata: json!({}),
                items: vec![json!({"kind": "message"})],
            }))
        }

        async fn save_thread(&self, _snapshot: SessionSnapshot) -> HostResult<()> {
            Ok(())
        }
    }

    #[async_trait]
    impl HostAuth for MockAuth {
        async fn load_auth_state(&self) -> HostResult<Option<AuthState>> {
            Ok(Some(AuthState {
                auth_mode: HostAuthMode::ChatgptAuthTokens,
                openai_api_key: None,
                access_token: Some("access-token".to_string()),
                refresh_token: None,
                chatgpt_account_id: Some("workspace-123".to_string()),
                chatgpt_plan_type: Some("pro".to_string()),
                last_refresh_at: Some(1_741_366_400),
            }))
        }

        async fn save_auth_state(&self, _auth_state: AuthState) -> HostResult<()> {
            Ok(())
        }

        async fn clear_auth_state(&self) -> HostResult<()> {
            Ok(())
        }

        async fn read_account(
            &self,
            _request: AccountReadRequest,
        ) -> HostResult<AccountReadResponse> {
            Ok(AccountReadResponse {
                account: Some(AccountSummary {
                    email: Some("user@example.com".to_string()),
                    plan_type: Some("pro".to_string()),
                    chatgpt_account_id: Some("workspace-123".to_string()),
                    auth_mode: Some(HostAuthMode::ChatgptAuthTokens),
                }),
                requires_openai_auth: true,
            })
        }

        async fn list_models(&self, _request: ModelListRequest) -> HostResult<ModelListResponse> {
            Ok(ModelListResponse {
                data: vec![crate::host::HostModelPreset {
                    id: "gpt-5".to_string(),
                    display_name: "GPT-5".to_string(),
                    is_default: true,
                    show_in_picker: true,
                    supports_api: false,
                }],
                next_cursor: None,
            })
        }

        async fn refresh_auth(
            &self,
            _context: AuthRefreshContext,
        ) -> HostResult<ExternalAuthTokens> {
            Ok(ExternalAuthTokens {
                access_token: "refreshed-token".to_string(),
                chatgpt_account_id: "workspace-123".to_string(),
                chatgpt_plan_type: Some("pro".to_string()),
            })
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn dispatches_read_file_request() {
        let runtime = BridgeRuntime::new(
            &MockFs,
            &MockModelTransport,
            &MockToolExecutor,
            &MockSessionStore,
        );

        let outcome = runtime
            .dispatch(BridgeRequest::FsReadFile(FsReadFileParams {
                path: "/repo/README.md".to_string(),
            }))
            .await
            .expect("dispatch should succeed");

        match outcome {
            BridgeDispatchOutcome::Response(BridgeResponse::FsReadFile(result)) => {
                assert_eq!(result.path, "/repo/README.md");
                assert_eq!(result.content, "hello");
            }
            _ => panic!("unexpected outcome"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn dispatches_model_start_with_streamed_events() {
        let runtime = BridgeRuntime::new(
            &MockFs,
            &MockModelTransport,
            &MockToolExecutor,
            &MockSessionStore,
        );

        let outcome = runtime
            .dispatch(BridgeRequest::ModelStart(ModelStartParams {
                request_id: "req-1".to_string(),
                payload: json!({ "input": [] }),
            }))
            .await
            .expect("dispatch should succeed");

        match outcome {
            BridgeDispatchOutcome::ResponseWithEvents {
                response,
                mut events,
            } => {
                assert_eq!(
                    response,
                    BridgeResponse::ModelStart(ModelStartResult {
                        request_id: "req-1".to_string(),
                    })
                );
                let collected = events.by_ref().collect::<Vec<_>>().await;
                assert_eq!(
                    collected,
                    vec![
                        BridgeEvent::ModelStarted(ModelStartedEvent {
                            request_id: "req-1".to_string(),
                        }),
                        BridgeEvent::ModelDelta(ModelDeltaEvent {
                            request_id: "req-1".to_string(),
                            payload: json!({ "delta": "hi" }),
                        }),
                        BridgeEvent::ModelCompleted(ModelCompletedEvent {
                            request_id: "req-1".to_string(),
                        }),
                    ]
                );
            }
            _ => panic!("unexpected outcome"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn dispatches_auth_state_load_request() {
        let runtime = BridgeRuntime::new(
            &MockFs,
            &MockModelTransport,
            &MockToolExecutor,
            &MockSessionStore,
        )
        .with_auth(&MockAuth);

        let outcome = runtime
            .dispatch(BridgeRequest::AuthStateLoad(EmptyParams {}))
            .await
            .expect("dispatch should succeed");

        match outcome {
            BridgeDispatchOutcome::Response(BridgeResponse::AuthStateLoad(result)) => {
                assert_eq!(
                    result.auth_state,
                    Some(AuthStatePayload {
                        auth_mode: BridgeAuthMode::ChatgptAuthTokens,
                        openai_api_key: None,
                        access_token: Some("access-token".to_string()),
                        refresh_token: None,
                        chatgpt_account_id: Some("workspace-123".to_string()),
                        chatgpt_plan_type: Some("pro".to_string()),
                        last_refresh_at: Some(1_741_366_400),
                    })
                );
            }
            _ => panic!("unexpected outcome"),
        }
    }

    #[test]
    fn tool_progress_event_wraps_payload() {
        assert_eq!(
            tool_progress_event("call-1".to_string(), json!({ "status": "running" })),
            BridgeEvent::ToolCallProgress(ToolCallProgressEvent {
                call_id: "call-1".to_string(),
                payload: json!({ "status": "running" }),
            })
        );
    }

    #[test]
    fn host_error_shape_is_stable() {
        assert_eq!(
            HostError {
                code: HostErrorCode::Unavailable,
                message: "no host".to_string(),
                retryable: false,
                data: None,
            }
            .code,
            HostErrorCode::Unavailable
        );
    }
}
