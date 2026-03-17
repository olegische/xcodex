use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::JSONRPCErrorError;

use crate::LoadedThreadStartResult;
use crate::MessageProcessor;
use crate::RequestTarget;
use crate::RuntimeBootstrap;
use crate::request_target;
use crate::resume_loaded_thread_runtime;
use crate::start_loaded_thread_runtime;

pub enum RootRequestResult {
    Response(serde_json::Value),
    LoadedThreadReady(Box<LoadedThreadStartResult>),
}

pub async fn process_root_or_thread_start_request(
    processor: &mut MessageProcessor,
    request: ClientRequest,
    runtime_bootstrap: Option<&RuntimeBootstrap>,
) -> Result<RootRequestResult, JSONRPCErrorError> {
    match request_target(&request) {
        Some(RequestTarget::Root) if matches!(request, ClientRequest::ThreadResume { .. }) => {
            let bootstrap = runtime_bootstrap
                .cloned()
                .ok_or_else(|| internal_error("thread/resume requires runtime bootstrap"))?;
            let ClientRequest::ThreadResume { request_id, params } = request else {
                unreachable!("request target classified as thread resume");
            };
            resume_loaded_thread_runtime(processor, request_id, params, bootstrap)
                .await
                .map(Box::new)
                .map(RootRequestResult::LoadedThreadReady)
        }
        Some(RequestTarget::Root) => {
            if matches!(request, ClientRequest::AppsList { .. }) {
                let bootstrap = runtime_bootstrap
                    .ok_or_else(|| internal_error("app/list requires runtime bootstrap"))?;
                let apps = bootstrap
                    .discoverable_apps_provider
                    .list_discoverable_apps()
                    .await
                    .map_err(internal_error)?;
                processor.set_apps(apps);
            }

            processor
                .process_initialized_request(request)
                .await
                .map(RootRequestResult::Response)
        }
        Some(RequestTarget::ThreadStart) => {
            let bootstrap = runtime_bootstrap
                .cloned()
                .ok_or_else(|| internal_error("thread/start requires runtime bootstrap"))?;
            let ClientRequest::ThreadStart { request_id, params } = request else {
                unreachable!("request target classified as thread start");
            };
            start_loaded_thread_runtime(processor, request_id, params, bootstrap)
                .await
                .map(Box::new)
                .map(RootRequestResult::LoadedThreadReady)
        }
        _ => Err(internal_error(
            "root, thread/start, or thread/resume request expected",
        )),
    }
}

fn internal_error(message: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    use async_trait::async_trait;
    use codex_app_server_protocol::AppsListParams;
    use codex_app_server_protocol::ClientRequest;
    use codex_app_server_protocol::ModelListParams;
    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::ThreadResumeParams;
    use codex_protocol::protocol::RolloutItem;
    use codex_protocol::protocol::SessionMeta;
    use codex_protocol::protocol::SessionMetaLine;
    use codex_protocol::protocol::SessionSource;
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
    use codex_wasm_core::UnavailableThreadStorageHost;
    use codex_wasm_core::config::Config;
    use pretty_assertions::assert_eq;

    use super::RootRequestResult;
    use super::process_root_or_thread_start_request;
    use crate::ApiVersion;
    use crate::MessageProcessor;
    use crate::MessageProcessorArgs;
    use crate::RuntimeBootstrap;

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

    #[tokio::test(flavor = "current_thread")]
    async fn apps_list_uses_runtime_bootstrap_provider() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        processor.set_apps(vec![codex_app_server_protocol::AppInfo {
            id: "stale-app".to_string(),
            name: "Stale App".to_string(),
            description: None,
            logo_url: None,
            logo_url_dark: None,
            distribution_channel: None,
            branding: None,
            app_metadata: None,
            labels: None,
            install_url: None,
            is_accessible: true,
            is_enabled: true,
            plugin_display_names: Vec::new(),
        }]);
        let bootstrap = RuntimeBootstrap {
            config: Config::default(),
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        };

        let response = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::AppsList {
                request_id: RequestId::Integer(1),
                params: AppsListParams {
                    cursor: None,
                    limit: None,
                    thread_id: None,
                    force_refetch: false,
                },
            },
            Some(&bootstrap),
        )
        .await
        .expect("app/list succeeds");
        let RootRequestResult::Response(response) = response else {
            panic!("expected root response");
        };

        assert_eq!(
            response.get("data").and_then(serde_json::Value::as_array),
            Some(&Vec::new())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn apps_list_requires_runtime_bootstrap() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });

        let error = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::AppsList {
                request_id: RequestId::Integer(1),
                params: AppsListParams {
                    cursor: None,
                    limit: None,
                    thread_id: None,
                    force_refetch: false,
                },
            },
            None,
        )
        .await;
        let Err(error) = error else {
            panic!("app/list without bootstrap fails");
        };

        assert_eq!(
            error.message,
            "app/list requires runtime bootstrap".to_string()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn model_list_does_not_require_runtime_bootstrap() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let bootstrap = RuntimeBootstrap {
            config: Config::default(),
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        };
        processor.set_runtime_bootstrap(bootstrap);

        let response = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::ModelList {
                request_id: RequestId::Integer(1),
                params: ModelListParams {
                    cursor: None,
                    limit: None,
                    include_hidden: None,
                },
            },
            None,
        )
        .await
        .expect("model/list succeeds");
        let RootRequestResult::Response(response) = response else {
            panic!("expected root response");
        };

        assert_eq!(
            response.get("data").and_then(serde_json::Value::as_array),
            Some(&Vec::new())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_resume_returns_loaded_thread_ready_result() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-root-resume-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let thread_storage_host = Arc::new(InMemoryThreadStorageHost::default());
        thread_storage_host
            .save_thread_session(SaveThreadSessionRequest {
                session: StoredThreadSession {
                    metadata: StoredThreadSessionMetadata {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe".to_string(),
                        rollout_id:
                            "rollout-2026-03-16T12-00-00-0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe.jsonl"
                                .to_string(),
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
                            id: codex_protocol::ThreadId::from_string(
                                "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe",
                            )
                            .expect("thread id"),
                            forked_from_id: None,
                            timestamp: codex_wasm_core::time::now_rfc3339(),
                            cwd: PathBuf::from(&root),
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
            .expect("seed stored session");
        let bootstrap = RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root.clone(),
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
        };
        processor.set_runtime_bootstrap(bootstrap.clone());

        let response = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::ThreadResume {
                request_id: RequestId::Integer(2),
                params: ThreadResumeParams {
                    thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe".to_string(),
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
        let RootRequestResult::LoadedThreadReady(response) = response else {
            panic!("expected loaded thread result");
        };

        assert_eq!(
            response.response["thread"]["id"].as_str(),
            Some("0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe")
        );
        assert_eq!(
            response.runtime.record.id,
            "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe"
        );
        assert!(response.runtime.notifications.is_empty());
    }
}
