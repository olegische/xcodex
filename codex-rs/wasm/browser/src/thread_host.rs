use std::sync::Arc;

use codex_app_server_protocol::JSONRPCError;
use codex_app_server_protocol::RequestId;
use codex_wasm_app_server::LoadedThreadStartResult;
use codex_wasm_app_server::MessageProcessor;
use codex_wasm_core::codex::Codex;
use tokio::sync::Mutex;
use wasm_bindgen::JsValue;

use crate::event_bridge::process_core_event;
use crate::rpc::internal_error;
use crate::rpc::method_error;
use crate::state::LoadedThread;
use crate::state::RuntimeState;

pub(crate) async fn install_loaded_thread(
    state: &Arc<Mutex<RuntimeState>>,
    loaded: Box<LoadedThreadStartResult>,
) {
    let thread_id = loaded.runtime.record.id.clone();
    let app_server = Arc::new(Mutex::new(loaded.runtime.processor));
    {
        let mut state = state.lock().await;
        state.threads.insert(
            thread_id.clone(),
            LoadedThread {
                app_server,
                codex: Arc::clone(&loaded.runtime.codex),
                record: loaded.runtime.record.clone(),
            },
        );
    }
    spawn_event_pump(state, thread_id, loaded.runtime.codex);
}

pub(crate) async fn loaded_thread_app_server(
    state: &Arc<Mutex<RuntimeState>>,
    id: RequestId,
    thread_id: &str,
    method: &str,
) -> Result<Arc<Mutex<MessageProcessor>>, JSONRPCError> {
    let app_server = {
        let state = state.lock().await;
        Arc::clone(
            &state
                .threads
                .get(thread_id)
                .ok_or_else(|| method_error(id, &format!("{method} requires a loaded thread")))?
                .app_server,
        )
    };
    Ok(app_server)
}

pub(crate) async fn pending_server_response_target(
    state: &Arc<Mutex<RuntimeState>>,
    request_id: &RequestId,
) -> Result<Option<(Arc<Mutex<MessageProcessor>>, Arc<Codex>)>, JsValue> {
    let thread_id = {
        let mut state = state.lock().await;
        state.pending_server_request_threads.remove(request_id)
    };
    let Some(thread_id) = thread_id else {
        return Ok(None);
    };
    let (app_server, codex) = {
        let state = state.lock().await;
        let loaded = state
            .threads
            .get(&thread_id)
            .ok_or_else(|| JsValue::from_str("thread missing for pending server request"))?;
        (Arc::clone(&loaded.app_server), Arc::clone(&loaded.codex))
    };
    Ok(Some((app_server, codex)))
}

pub(crate) async fn sync_loaded_thread_record(
    state: &Arc<Mutex<RuntimeState>>,
    root_app_server: &Arc<Mutex<MessageProcessor>>,
    id: RequestId,
    thread_id: &str,
    updated_record: codex_wasm_app_server::ThreadRecord,
) -> Result<(), JSONRPCError> {
    let synced_record = {
        let mut state = state.lock().await;
        let loaded = state.threads.get_mut(thread_id).ok_or_else(|| {
            internal_error(id.clone(), format!("{thread_id} missing thread after sync"))
        })?;
        loaded.record = updated_record;
        loaded.record.clone()
    };
    codex_wasm_app_server::sync_loaded_thread_record(
        &mut *root_app_server.lock().await,
        synced_record,
    );
    Ok(())
}

fn spawn_event_pump(state: &Arc<Mutex<RuntimeState>>, thread_id: String, codex: Arc<Codex>) {
    let state = Arc::clone(state);
    codex_wasm_core::spawn_background_task(async move {
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;
    
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    use async_channel::unbounded;
    use async_trait::async_trait;
    use codex_app_server_protocol::ClientRequest;
    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::ThreadResumeParams;
    use codex_app_server_protocol::ThreadStartParams;
    use codex_app_server_protocol::TurnStartParams;
    use codex_app_server_protocol::UserInput;
    use codex_protocol::protocol::RolloutItem;
    use codex_protocol::protocol::SessionMeta;
    use codex_protocol::protocol::SessionMetaLine;
    use codex_protocol::protocol::SessionSource;
    use codex_wasm_app_server::ApiVersion;
    use codex_wasm_app_server::MessageProcessor;
    use codex_wasm_app_server::MessageProcessorArgs;
    use codex_wasm_app_server::RootRequestResult;
    use codex_wasm_app_server::RuntimeBootstrap;
    use codex_wasm_app_server::process_loaded_thread_request;
    use codex_wasm_app_server::process_root_or_thread_start_request;
    use codex_wasm_core::DeleteThreadSessionRequest;
    use codex_wasm_core::HostError;
    use codex_wasm_core::HostErrorCode;
    use codex_wasm_core::HostResult;
    use codex_wasm_core::ListThreadSessionsRequest;
    use codex_wasm_core::ListThreadSessionsResponse;
    use codex_wasm_core::LoadThreadSessionRequest;
    use codex_wasm_core::LoadThreadSessionResponse;
    use codex_wasm_core::SaveThreadSessionRequest;
    use codex_wasm_core::StoredThreadSession;
    use codex_wasm_core::StoredThreadSessionMetadata;
    use codex_wasm_core::ThreadStorageHost;
    use codex_wasm_core::UnavailableConfigStorageHost;
    use codex_wasm_core::UnavailableDiscoverableAppsProvider;
    use codex_wasm_core::UnavailableHostFs;
    use codex_wasm_core::UnavailableMcpOauthHost;
    use codex_wasm_core::UnavailableModelTransportHost;
    use codex_wasm_core::config::Config;
    use pretty_assertions::assert_eq;
    use tokio::sync::Mutex;

    use super::install_loaded_thread;
    use super::loaded_thread_app_server;
    use crate::state::RuntimeState;

    #[derive(Default)]
    struct InMemoryThreadStorageHost {
        sessions: StdMutex<HashMap<String, StoredThreadSession>>,
    }

    #[async_trait]
    impl ThreadStorageHost for InMemoryThreadStorageHost {
        async fn load_thread_session(
            &self,
            request: LoadThreadSessionRequest,
        ) -> HostResult<LoadThreadSessionResponse> {
            let sessions = self.sessions.lock().expect("lock sessions");
            let session = sessions
                .get(&request.thread_id)
                .cloned()
                .ok_or_else(|| HostError {
                    code: HostErrorCode::NotFound,
                    message: "session not found".to_string(),
                    retryable: false,
                    data: None,
                })?;
            Ok(LoadThreadSessionResponse { session })
        }

        async fn save_thread_session(&self, request: SaveThreadSessionRequest) -> HostResult<()> {
            let mut sessions = self.sessions.lock().expect("lock sessions");
            sessions.insert(request.session.metadata.thread_id.clone(), request.session);
            Ok(())
        }

        async fn delete_thread_session(
            &self,
            request: DeleteThreadSessionRequest,
        ) -> HostResult<()> {
            let mut sessions = self.sessions.lock().expect("lock sessions");
            sessions.remove(&request.thread_id);
            Ok(())
        }

        async fn list_thread_sessions(
            &self,
            _request: ListThreadSessionsRequest,
        ) -> HostResult<ListThreadSessionsResponse> {
            let sessions = self.sessions.lock().expect("lock sessions");
            Ok(ListThreadSessionsResponse {
                sessions: sessions
                    .values()
                    .map(|session| session.metadata.clone())
                    .collect(),
            })
        }
    }

    fn runtime_bootstrap(
        root: &Path,
        thread_storage_host: Arc<InMemoryThreadStorageHost>,
    ) -> RuntimeBootstrap {
        RuntimeBootstrap {
            config: Config {
                codex_home: root.to_path_buf(),
                cwd: root.to_path_buf(),
                model: Some("gpt-test".to_string()),
                model_provider_id: "openai".to_string(),
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host,
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        }
    }

    fn new_runtime_state() -> Arc<Mutex<RuntimeState>> {
        let (tx, rx) = unbounded();
        Arc::new(Mutex::new(RuntimeState::new(tx, rx)))
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resumed_thread_is_installed_into_runtime_state_for_immediate_turn_start() {
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-browser-resume-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        std::fs::create_dir_all(root.join("sessions")).expect("create sessions dir");
        let thread_storage_host = Arc::new(InMemoryThreadStorageHost::default());
        let bootstrap = runtime_bootstrap(&root, Arc::clone(&thread_storage_host));

        let mut first_root_processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        first_root_processor.set_runtime_bootstrap(bootstrap.clone());
        let started = process_root_or_thread_start_request(
            &mut first_root_processor,
            ClientRequest::ThreadStart {
                request_id: RequestId::Integer(1),
                params: ThreadStartParams {
                    model: Some("gpt-test".to_string()),
                    model_provider: None,
                    service_tier: None,
                    cwd: Some(root.display().to_string()),
                    approval_policy: None,
                    sandbox: None,
                    config: None,
                    service_name: None,
                    base_instructions: None,
                    developer_instructions: None,
                    personality: None,
                    ephemeral: Some(true),
                    dynamic_tools: None,
                    mock_experimental_field: None,
                    experimental_raw_events: false,
                    persist_extended_history: false,
                },
            },
            Some(&bootstrap),
        )
        .await
        .expect("thread/start succeeds");
        let RootRequestResult::LoadedThreadReady(started) = started else {
            panic!("expected loaded thread result");
        };
        let thread_id = started.runtime.record.id.clone();
        let first_state = new_runtime_state();
        install_loaded_thread(&first_state, started).await;

        let first_thread_app_server = loaded_thread_app_server(
            &first_state,
            RequestId::Integer(2),
            &thread_id,
            "turn/start",
        )
        .await
        .expect("started thread is loaded");
        let first_turn = {
            let mut thread_app_server = first_thread_app_server.lock().await;
            process_loaded_thread_request(
                &mut thread_app_server,
                ClientRequest::TurnStart {
                    request_id: RequestId::Integer(2),
                    params: TurnStartParams {
                        thread_id: thread_id.clone(),
                        input: vec![UserInput::Text {
                            text: "first turn".to_string(),
                            text_elements: Vec::new(),
                        }],
                        cwd: None,
                        approval_policy: None,
                        sandbox_policy: None,
                        model: None,
                        service_tier: None,
                        effort: None,
                        summary: None,
                        personality: None,
                        output_schema: None,
                        collaboration_mode: None,
                    },
                },
            )
            .await
            .expect("first turn/start succeeds")
        };
        assert_eq!(first_turn.thread_id, thread_id);

        thread_storage_host
            .save_thread_session(SaveThreadSessionRequest {
                session: StoredThreadSession {
                    metadata: StoredThreadSessionMetadata {
                        thread_id: thread_id.clone(),
                        rollout_id: format!("rollout-2026-03-16T12-00-00-{thread_id}.jsonl"),
                        created_at: 1,
                        updated_at: 2,
                        archived: false,
                        name: Some("Stored Thread".to_string()),
                        preview: "Stored prompt".to_string(),
                        cwd: root.display().to_string(),
                        model_provider: "openai".to_string(),
                    },
                    items: vec![RolloutItem::SessionMeta(SessionMetaLine {
                        meta: SessionMeta {
                            id: codex_protocol::ThreadId::from_string(&thread_id)
                                .expect("thread id"),
                            forked_from_id: None,
                            timestamp: codex_wasm_core::time::now_rfc3339(),
                            cwd: root.clone(),
                            originator: "wasm".to_string(),
                            cli_version: env!("CARGO_PKG_VERSION").to_string(),
                            source: SessionSource::Unknown,
                            agent_nickname: None,
                            agent_role: None,
                            model_provider: Some("openai".to_string()),
                            base_instructions: None,
                            dynamic_tools: None,
                            memory_mode: None,
                        },
                        git: None,
                    })],
                },
            })
            .await
            .expect("seed stored session for resume");

        let mut second_root_processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        second_root_processor.set_runtime_bootstrap(bootstrap.clone());
        let resumed = process_root_or_thread_start_request(
            &mut second_root_processor,
            ClientRequest::ThreadResume {
                request_id: RequestId::Integer(3),
                params: ThreadResumeParams {
                    thread_id: thread_id.clone(),
                    history: None,
                    path: None,
                    model: None,
                    model_provider: None,
                    service_tier: None,
                    cwd: None,
                    approval_policy: None,
                    sandbox: None,
                    config: None,
                    base_instructions: None,
                    developer_instructions: None,
                    personality: None,
                    persist_extended_history: false,
                },
            },
            Some(&bootstrap),
        )
        .await
        .expect("thread/resume succeeds");
        let RootRequestResult::LoadedThreadReady(resumed) = resumed else {
            panic!("expected loaded thread result");
        };

        let second_state = new_runtime_state();
        install_loaded_thread(&second_state, resumed).await;
        let resumed_thread_app_server = loaded_thread_app_server(
            &second_state,
            RequestId::Integer(4),
            &thread_id,
            "turn/start",
        )
        .await
        .expect("resumed thread is loaded");
        let resumed_turn = {
            let mut thread_app_server = resumed_thread_app_server.lock().await;
            process_loaded_thread_request(
                &mut thread_app_server,
                ClientRequest::TurnStart {
                    request_id: RequestId::Integer(4),
                    params: TurnStartParams {
                        thread_id: thread_id.clone(),
                        input: vec![UserInput::Text {
                            text: "second turn".to_string(),
                            text_elements: Vec::new(),
                        }],
                        cwd: None,
                        approval_policy: None,
                        sandbox_policy: None,
                        model: None,
                        service_tier: None,
                        effort: None,
                        summary: None,
                        personality: None,
                        output_schema: None,
                        collaboration_mode: None,
                    },
                },
            )
            .await
            .expect("turn/start after resume succeeds")
        };

        assert_eq!(resumed_turn.thread_id, thread_id);
        assert_eq!(
            resumed_turn.response["turn"]["status"].as_str(),
            Some("inProgress")
        );
    }
}
