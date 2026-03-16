use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ThreadArchiveResponse;
use codex_app_server_protocol::ThreadArchivedNotification;
use codex_app_server_protocol::ThreadNameUpdatedNotification;
use codex_app_server_protocol::ThreadSetNameResponse;
use codex_app_server_protocol::ThreadStartResponse;
use codex_app_server_protocol::ThreadUnarchiveResponse;
use codex_app_server_protocol::ThreadUnarchivedNotification;
use codex_app_server_protocol::TurnInterruptResponse;
use codex_app_server_protocol::TurnStatus;
use codex_app_server_protocol::TurnSteerResponse;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::InitialHistory;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::RolloutItem;
use codex_protocol::protocol::SessionSource;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::AppServerState;
use crate::LoadedThread;
use crate::ThreadRecord;
use crate::ThreadState;
use crate::apply_bespoke_event_handling;
use crate::mapping::build_thread;
use crate::mapping::map_apps_list;
use crate::mapping::map_model_list;
use crate::mapping::thread_list_response;
use crate::mapping::thread_loaded_list_response;
use crate::mapping::thread_read_response;
use crate::mapping::thread_started_notification;
use crate::mapping::turn_start_response;
use crate::outgoing_message::OutgoingMessageSender;
use crate::outgoing_message::ThreadScopedOutgoingMessageSender;
use crate::runtime_bootstrap::RuntimeBootstrap;
use crate::runtime_bootstrap::apply_thread_start_overrides;
use crate::runtime_bootstrap::effective_approval_policy;
use crate::runtime_bootstrap::resolve_model;
use codex_wasm_v2_core::BrowserCodexSpawnArgs;
use codex_wasm_v2_core::HostErrorCode;
use codex_wasm_v2_core::ListThreadSessionsRequest;
use codex_wasm_v2_core::LoadThreadSessionRequest;
use codex_wasm_v2_core::SaveThreadSessionRequest;
use codex_wasm_v2_core::StoredThreadSession;
use codex_wasm_v2_core::StoredThreadSessionMetadata;
use codex_wasm_v2_core::codex::Codex;
use codex_wasm_v2_core::codex::SteerInputError;
use codex_wasm_v2_core::spawn_browser_codex;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ApiVersion {
    #[allow(dead_code)]
    V1,
    #[default]
    V2,
}

pub struct CodexMessageProcessorArgs {
    pub api_version: ApiVersion,
    pub outgoing: Arc<std::sync::Mutex<OutgoingMessageSender>>,
}

/// Mirror-track subset of upstream `app-server::CodexMessageProcessor`.
///
/// The browser variant only keeps the protocol-shaping responsibilities that
/// are transport-independent and wasm-safe.
pub struct CodexMessageProcessor {
    api_version: ApiVersion,
    thread_state: ThreadState,
    app_server_state: AppServerState,
    runtime_bootstrap: Option<RuntimeBootstrap>,
    outgoing: ThreadScopedOutgoingMessageSender,
}

impl CodexMessageProcessor {
    pub fn new(args: CodexMessageProcessorArgs) -> Self {
        Self {
            api_version: args.api_version,
            thread_state: ThreadState::default(),
            app_server_state: AppServerState::default(),
            runtime_bootstrap: None,
            outgoing: ThreadScopedOutgoingMessageSender::new(args.outgoing),
        }
    }

    pub async fn process_request(
        &mut self,
        request: ClientRequest,
    ) -> Result<serde_json::Value, JSONRPCErrorError> {
        match request {
            ClientRequest::ThreadStart {
                request_id: _,
                params,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .clone()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "thread/start requires runtime bootstrap".to_string(),
                        })?;
                let mut config = bootstrap.config.clone();
                apply_thread_start_overrides(&mut config, &params);
                let model = resolve_model(
                    params.model.clone().or_else(|| config.model.clone()),
                    bootstrap.model_catalog.as_ref(),
                );
                config.model = Some(model.clone());
                let spawn = spawn_browser_codex(BrowserCodexSpawnArgs {
                    config: config.clone(),
                    auth: bootstrap.auth.clone(),
                    model_catalog: bootstrap.model_catalog.clone(),
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
                    browser_fs: Arc::clone(&bootstrap.browser_fs),
                    discoverable_apps_provider: Arc::clone(&bootstrap.discoverable_apps_provider),
                    model_transport_host: Arc::clone(&bootstrap.model_transport_host),
                    config_storage_host: Arc::clone(&bootstrap.config_storage_host),
                    thread_storage_host: Arc::clone(&bootstrap.thread_storage_host),
                })
                .await
                .map_err(internal_error)?;

                let thread_id = spawn.thread_id.to_string();
                let timestamp = codex_wasm_v2_core::time::now_unix_seconds();
                let record = ThreadRecord {
                    id: thread_id,
                    preview: String::new(),
                    ephemeral: params.ephemeral.unwrap_or(config.ephemeral),
                    model_provider: config.model_provider_id.clone(),
                    cwd: config.cwd.clone(),
                    source: SessionSource::Unknown,
                    name: None,
                    created_at: timestamp,
                    updated_at: timestamp,
                    archived: false,
                    turns: Default::default(),
                    active_turn_id: None,
                    waiting_on_approval: false,
                    waiting_on_user_input: false,
                };
                let response = ThreadStartResponse {
                    thread: build_thread(&record, false, record.protocol_status()),
                    model,
                    model_provider: config.model_provider_id.clone(),
                    service_tier: config.service_tier,
                    cwd: config.cwd.clone(),
                    approval_policy: effective_approval_policy(&params, &config),
                    sandbox: config.permissions.sandbox_policy.get().clone().into(),
                    reasoning_effort: config.model_reasoning_effort,
                };
                self.app_server_state.upsert_loaded_thread(LoadedThread {
                    codex: Arc::new(spawn.codex),
                    record: record.clone(),
                });
                self.outgoing
                    .send_server_notification(thread_started_notification(
                        &record,
                        record.protocol_status(),
                    ));
                serde_json::to_value(response).map_err(internal_error)
            }
            ClientRequest::ConfigRead {
                request_id: _,
                params,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .as_ref()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "config/read requires runtime bootstrap".to_string(),
                        })?;
                serde_json::to_value(crate::config_runtime::config_read_response(
                    bootstrap, params,
                )?)
                .map_err(internal_error)
            }
            ClientRequest::ConfigRequirementsRead {
                request_id: _,
                params: _,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .as_ref()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "configRequirements/read requires runtime bootstrap"
                                .to_string(),
                        })?;
                serde_json::to_value(crate::config_runtime::config_requirements_read_response(
                    bootstrap,
                )?)
                .map_err(internal_error)
            }
            ClientRequest::ConfigValueWrite {
                request_id: _,
                params,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .as_mut()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "config/value/write requires runtime bootstrap".to_string(),
                        })?;
                serde_json::to_value(
                    crate::config_runtime::config_value_write(bootstrap, params).await?,
                )
                .map_err(internal_error)
            }
            ClientRequest::ConfigBatchWrite {
                request_id: _,
                params,
            } => {
                let loaded_threads = self
                    .app_server_state
                    .loaded_thread_ids()
                    .into_iter()
                    .filter_map(|thread_id| self.app_server_state.running_thread(&thread_id))
                    .collect();
                let bootstrap =
                    self.runtime_bootstrap
                        .as_mut()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "config/batchWrite requires runtime bootstrap".to_string(),
                        })?;
                serde_json::to_value(
                    crate::config_runtime::config_batch_write(bootstrap, params, loaded_threads)
                        .await?,
                )
                .map_err(internal_error)
            }
            ClientRequest::SkillsList {
                request_id: _,
                params,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .as_ref()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "skills/list requires runtime bootstrap".to_string(),
                        })?;
                serde_json::to_value(
                    crate::skills_runtime::skills_list_response(bootstrap, params).await?,
                )
                .map_err(internal_error)
            }
            ClientRequest::SkillsConfigWrite {
                request_id: _,
                params,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .as_mut()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "skills/config/write requires runtime bootstrap".to_string(),
                        })?;
                serde_json::to_value(
                    crate::skills_runtime::skills_config_write(bootstrap, params).await?,
                )
                .map_err(internal_error)
            }
            ClientRequest::ThreadResume {
                request_id: _,
                params,
            } => serde_json::to_value(
                crate::thread_resume_runtime::resume_thread(
                    &mut self.app_server_state,
                    self.runtime_bootstrap
                        .as_ref()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "thread/resume requires runtime bootstrap".to_string(),
                        })?,
                    params,
                )
                .await?,
            )
            .map_err(internal_error),
            ClientRequest::ThreadRollback {
                request_id: _,
                params,
            } => serde_json::to_value(
                crate::thread_rollback_runtime::rollback_loaded_thread(
                    &mut self.app_server_state,
                    params,
                )
                .await?,
            )
            .map_err(internal_error),
            ClientRequest::ThreadSetName {
                request_id: _,
                params,
            } => {
                let normalized = codex_wasm_v2_core::util::normalize_thread_name(&params.name)
                    .ok_or_else(|| JSONRPCErrorError {
                        code: -32600,
                        data: None,
                        message: "thread name must not be empty".to_string(),
                    })?;
                if let Some(codex) = self.app_server_state.running_thread(&params.thread_id) {
                    codex
                        .submit(Op::SetThreadName {
                            name: normalized.clone(),
                        })
                        .await
                        .map_err(internal_error)?;
                }
                let name = if self.app_server_state.thread(&params.thread_id).is_some() {
                    crate::thread_mutation_runtime::set_thread_name(
                        &mut self.app_server_state,
                        &params.thread_id,
                        normalized.clone(),
                    )?
                } else if update_stored_session_metadata(
                    self.runtime_bootstrap.as_ref(),
                    &params.thread_id,
                    |metadata| metadata.name = Some(normalized.clone()),
                )
                .await?
                .is_some()
                {
                    normalized
                } else {
                    return Err(invalid_request_error(format!(
                        "thread not found: {}",
                        params.thread_id
                    )));
                };
                self.outgoing
                    .send_server_notification(ServerNotification::ThreadNameUpdated(
                        ThreadNameUpdatedNotification {
                            thread_id: params.thread_id,
                            thread_name: Some(name),
                        },
                    ));
                serde_json::to_value(ThreadSetNameResponse {}).map_err(internal_error)
            }
            ClientRequest::ThreadArchive {
                request_id: _,
                params,
            } => {
                let mut found = false;
                if self.app_server_state.thread(&params.thread_id).is_some() {
                    crate::thread_mutation_runtime::archive_thread(
                        &mut self.app_server_state,
                        &params.thread_id,
                    )?;
                    found = true;
                }
                if update_stored_session_metadata(
                    self.runtime_bootstrap.as_ref(),
                    &params.thread_id,
                    |metadata| {
                        metadata.archived = true;
                        metadata.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
                    },
                )
                .await?
                .is_some()
                {
                    found = true;
                }
                if !found {
                    return Err(invalid_request_error(format!(
                        "no rollout found for thread id {}",
                        params.thread_id
                    )));
                }
                self.outgoing
                    .send_server_notification(ServerNotification::ThreadArchived(
                        ThreadArchivedNotification {
                            thread_id: params.thread_id,
                        },
                    ));
                serde_json::to_value(ThreadArchiveResponse {}).map_err(internal_error)
            }
            ClientRequest::ThreadUnarchive {
                request_id: _,
                params,
            } => {
                let thread = if self.app_server_state.thread(&params.thread_id).is_some() {
                    crate::thread_mutation_runtime::unarchive_thread(
                        &mut self.app_server_state,
                        &params.thread_id,
                    )?
                } else if let Some(session) = update_stored_session_metadata(
                    self.runtime_bootstrap.as_ref(),
                    &params.thread_id,
                    |metadata| {
                        metadata.archived = false;
                        metadata.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
                    },
                )
                .await?
                {
                    stored_session_to_thread_record(&session, false)
                } else {
                    return Err(invalid_request_error(format!(
                        "no archived rollout found for thread id {}",
                        params.thread_id
                    )));
                };
                self.outgoing
                    .send_server_notification(ServerNotification::ThreadUnarchived(
                        ThreadUnarchivedNotification {
                            thread_id: params.thread_id,
                        },
                    ));
                serde_json::to_value(ThreadUnarchiveResponse {
                    thread: build_thread(&thread, false, thread.protocol_status()),
                })
                .map_err(internal_error)
            }
            ClientRequest::ThreadRead {
                request_id: _,
                params,
            } => {
                if let Some(thread) = self.app_server_state.thread(&params.thread_id) {
                    serde_json::to_value(thread_read_response(
                        thread,
                        thread.protocol_status(),
                        params.include_turns,
                    ))
                    .map_err(internal_error)
                } else {
                    let bootstrap =
                        self.runtime_bootstrap
                            .as_ref()
                            .ok_or_else(|| JSONRPCErrorError {
                                code: -32603,
                                data: None,
                                message: "thread/read requires runtime bootstrap".to_string(),
                            })?;
                    let stored = bootstrap
                        .thread_storage_host
                        .load_thread_session(LoadThreadSessionRequest {
                            thread_id: params.thread_id.clone(),
                        })
                        .await
                        .map_err(|error| map_storage_error(&params.thread_id, error))?
                        .session;
                    let thread = stored_session_to_thread_record(&stored, params.include_turns);
                    serde_json::to_value(thread_read_response(
                        &thread,
                        thread.protocol_status(),
                        params.include_turns,
                    ))
                    .map_err(internal_error)
                }
            }
            ClientRequest::TurnStart {
                request_id: _,
                params,
            } => {
                let bootstrap =
                    self.runtime_bootstrap
                        .clone()
                        .ok_or_else(|| JSONRPCErrorError {
                            code: -32603,
                            data: None,
                            message: "turn/start requires runtime bootstrap".to_string(),
                        })?;
                let codex = self
                    .app_server_state
                    .running_thread(&params.thread_id)
                    .ok_or_else(|| loaded_thread_error("turn/start"))?;
                let active_model = resolve_model(
                    params
                        .model
                        .clone()
                        .or_else(|| bootstrap.config.model.clone()),
                    bootstrap.model_catalog.as_ref(),
                );
                let preview = params
                    .input
                    .iter()
                    .find_map(|item| match item {
                        codex_app_server_protocol::UserInput::Text { text, .. } => {
                            Some(text.clone())
                        }
                        _ => None,
                    })
                    .unwrap_or_default();
                let turn_id = codex
                    .submit(Op::UserTurn {
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
                            .unwrap_or_else(|| {
                                bootstrap.config.permissions.approval_policy.value()
                            }),
                        sandbox_policy: params
                            .sandbox_policy
                            .clone()
                            .map(|policy| policy.to_core())
                            .unwrap_or_else(|| {
                                bootstrap.config.permissions.sandbox_policy.get().clone()
                            }),
                        model: active_model,
                        effort: params.effort,
                        summary: params.summary,
                        service_tier: params.service_tier,
                        final_output_json_schema: params.output_schema,
                        collaboration_mode: params.collaboration_mode,
                        personality: params.personality,
                    })
                    .await
                    .map_err(internal_error)?;
                let thread = self
                    .app_server_state
                    .threads
                    .get_mut(&params.thread_id)
                    .ok_or_else(|| loaded_thread_error("turn/start"))?;
                thread.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
                thread.active_turn_id = Some(turn_id.clone());
                thread.turns.insert(
                    turn_id.clone(),
                    crate::TurnRecord {
                        id: turn_id.clone(),
                        items: Vec::new(),
                        status: TurnStatus::InProgress,
                        error: None,
                    },
                );
                if thread.preview.is_empty() {
                    thread.preview = preview;
                }
                serde_json::to_value(turn_start_response(turn_id)).map_err(internal_error)
            }
            ClientRequest::TurnSteer {
                request_id: _,
                params,
            } => {
                let codex = self
                    .app_server_state
                    .running_thread(&params.thread_id)
                    .ok_or_else(|| loaded_thread_error("turn/steer"))?;
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
                    .map_err(map_turn_steer_error)?;
                serde_json::to_value(TurnSteerResponse { turn_id }).map_err(internal_error)
            }
            ClientRequest::TurnInterrupt {
                request_id: _,
                params,
            } => {
                let codex = self
                    .app_server_state
                    .running_thread(&params.thread_id)
                    .ok_or_else(|| loaded_thread_error("turn/interrupt"))?;
                let thread = self
                    .app_server_state
                    .thread(&params.thread_id)
                    .ok_or_else(|| loaded_thread_error("turn/interrupt"))?;
                if thread.active_turn_id.as_deref() != Some(params.turn_id.as_str()) {
                    return Err(JSONRPCErrorError {
                        code: -32601,
                        data: None,
                        message: "turn/interrupt expected the currently active turn id".to_string(),
                    });
                }
                codex.submit(Op::Interrupt).await.map_err(internal_error)?;
                serde_json::to_value(TurnInterruptResponse {}).map_err(internal_error)
            }
            ClientRequest::ThreadList {
                request_id: _,
                params,
            } => {
                let mut threads = self
                    .app_server_state
                    .threads
                    .values()
                    .cloned()
                    .collect::<Vec<_>>();
                if let Some(bootstrap) = self.runtime_bootstrap.as_ref() {
                    let stored_metadata = bootstrap
                        .thread_storage_host
                        .list_thread_sessions(ListThreadSessionsRequest {})
                        .await
                        .map_err(|error| internal_error(error.message))?
                        .sessions;
                    for metadata in stored_metadata {
                        if self.app_server_state.thread(&metadata.thread_id).is_none() {
                            threads.push(stored_metadata_to_thread_record(metadata));
                        }
                    }
                }
                let data = threads
                    .into_iter()
                    .filter(|thread| params.archived.unwrap_or(false) == thread.archived)
                    .filter(|thread| {
                        params
                            .cwd
                            .as_deref()
                            .is_none_or(|cwd| thread.cwd.as_path() == std::path::Path::new(cwd))
                    })
                    .filter(|thread| {
                        params.search_term.as_deref().is_none_or(|search_term| {
                            let search = search_term.trim().to_lowercase();
                            search.is_empty()
                                || thread
                                    .name
                                    .as_deref()
                                    .unwrap_or(thread.preview.as_str())
                                    .to_lowercase()
                                    .contains(&search)
                        })
                    })
                    .map(|thread| {
                        crate::mapping::build_thread(&thread, false, thread.protocol_status())
                    })
                    .collect();
                serde_json::to_value(thread_list_response(data)).map_err(internal_error)
            }
            ClientRequest::ThreadLoadedList {
                request_id: _,
                params: _,
            } => serde_json::to_value(thread_loaded_list_response(
                self.app_server_state.loaded_thread_ids(),
            ))
            .map_err(internal_error),
            ClientRequest::ModelList {
                request_id: _,
                params,
            } => serde_json::to_value(map_model_list(
                self.app_server_state.models.clone(),
                params.include_hidden.unwrap_or(false),
            ))
            .map_err(internal_error),
            ClientRequest::AppsList {
                request_id: _,
                params: _,
            } => serde_json::to_value(map_apps_list(self.app_server_state.apps.clone()))
                .map_err(internal_error),
            // The request routing surface will be filled in incrementally as the
            // browser app-server mirror grows toward the upstream processor.
            other => Err(JSONRPCErrorError {
                code: -32601,
                data: None,
                message: format!("unsupported method: {}", other.method()),
            }),
        }
    }

    pub fn apply_bespoke_event_handling(
        &mut self,
        thread_id: &str,
        event: &Event,
    ) -> Vec<ServerNotification> {
        let notifications = match self.api_version {
            ApiVersion::V1 => Vec::new(),
            ApiVersion::V2 => {
                apply_bespoke_event_handling(thread_id, &mut self.thread_state, event)
            }
        };
        for notification in notifications.iter().cloned() {
            self.outgoing.send_server_notification(notification);
        }
        notifications
    }

    pub fn thread_state(&self) -> &ThreadState {
        &self.thread_state
    }

    pub fn register_thread(&mut self, thread: ThreadRecord) {
        self.app_server_state.upsert_thread(thread);
    }

    pub fn register_loaded_thread(&mut self, thread: ThreadRecord, codex: Arc<Codex>) {
        self.app_server_state.upsert_loaded_thread(LoadedThread {
            codex,
            record: thread,
        });
    }

    pub fn thread_record(&self, thread_id: &str) -> Option<ThreadRecord> {
        self.app_server_state.thread(thread_id).cloned()
    }

    pub fn running_thread(&self, thread_id: &str) -> Option<Arc<Codex>> {
        self.app_server_state.running_thread(thread_id)
    }

    pub fn set_models(&mut self, models: Vec<ModelInfo>) {
        self.app_server_state.models = models;
    }

    pub fn set_runtime_bootstrap(&mut self, runtime_bootstrap: RuntimeBootstrap) {
        self.runtime_bootstrap = Some(runtime_bootstrap);
    }

    pub fn set_apps(&mut self, apps: Vec<codex_app_server_protocol::AppInfo>) {
        self.app_server_state.apps = apps;
    }

    pub fn reset_current_turn(&mut self) {
        self.thread_state.reset_current_turn();
    }
}

fn internal_error(error: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: error.to_string(),
    }
}

fn loaded_thread_error(method: &str) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32601,
        data: None,
        message: format!("{method} requires a loaded thread"),
    }
}

fn map_turn_steer_error(error: SteerInputError) -> JSONRPCErrorError {
    let (code, message) = match error {
        SteerInputError::NoActiveTurn(_) => (-32600, "no active turn to steer".to_string()),
        SteerInputError::ExpectedTurnMismatch { expected, actual } => (
            -32600,
            format!("expected active turn id `{expected}` but found `{actual}`"),
        ),
        SteerInputError::EmptyInput => (-32600, "input must not be empty".to_string()),
    };
    JSONRPCErrorError {
        code,
        data: None,
        message,
    }
}

async fn update_stored_session_metadata<F>(
    runtime_bootstrap: Option<&RuntimeBootstrap>,
    thread_id: &str,
    update: F,
) -> Result<Option<StoredThreadSession>, JSONRPCErrorError>
where
    F: FnOnce(&mut StoredThreadSessionMetadata),
{
    let Some(runtime_bootstrap) = runtime_bootstrap else {
        return Ok(None);
    };
    let session = match runtime_bootstrap
        .thread_storage_host
        .load_thread_session(LoadThreadSessionRequest {
            thread_id: thread_id.to_string(),
        })
        .await
    {
        Ok(response) => response.session,
        Err(error) if error.code == HostErrorCode::NotFound => return Ok(None),
        Err(error) => return Err(map_storage_error(thread_id, error)),
    };
    let mut session = session;
    update(&mut session.metadata);
    runtime_bootstrap
        .thread_storage_host
        .save_thread_session(SaveThreadSessionRequest {
            session: session.clone(),
        })
        .await
        .map_err(|error| internal_error(error.message))?;
    Ok(Some(session))
}

fn stored_metadata_to_thread_record(metadata: StoredThreadSessionMetadata) -> ThreadRecord {
    ThreadRecord {
        id: metadata.thread_id,
        preview: metadata.preview,
        ephemeral: false,
        model_provider: metadata.model_provider,
        cwd: PathBuf::from(metadata.cwd),
        source: SessionSource::Unknown,
        name: metadata.name,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
        archived: metadata.archived,
        turns: BTreeMap::new(),
        active_turn_id: None,
        waiting_on_approval: false,
        waiting_on_user_input: false,
    }
}

fn stored_session_to_thread_record(
    stored: &StoredThreadSession,
    include_turns: bool,
) -> ThreadRecord {
    let turns: BTreeMap<String, crate::TurnRecord> = if include_turns {
        {
            codex_app_server_protocol::build_turns_from_rollout_items(&stored.items)
                .into_iter()
                .map(|turn| {
                    (
                        turn.id.clone(),
                        crate::TurnRecord {
                            id: turn.id,
                            items: turn.items,
                            status: turn.status,
                            error: turn.error,
                        },
                    )
                })
                .collect()
        }
    } else {
        Default::default()
    };
    let active_turn_id = turns.iter().find_map(|(turn_id, turn)| {
        (turn.status == TurnStatus::InProgress).then(|| turn_id.clone())
    });
    ThreadRecord {
        id: stored.metadata.thread_id.clone(),
        preview: stored.metadata.preview.clone(),
        ephemeral: false,
        model_provider: stored.metadata.model_provider.clone(),
        cwd: PathBuf::from(stored.metadata.cwd.as_str()),
        source: session_source_from_items(&stored.items),
        name: stored.metadata.name.clone(),
        created_at: stored.metadata.created_at,
        updated_at: stored.metadata.updated_at,
        archived: stored.metadata.archived,
        turns,
        active_turn_id,
        waiting_on_approval: false,
        waiting_on_user_input: false,
    }
}

fn session_source_from_items(items: &[RolloutItem]) -> SessionSource {
    items
        .iter()
        .find_map(|item| match item {
            RolloutItem::SessionMeta(session_meta) => Some(session_meta.meta.source.clone()),
            _ => None,
        })
        .unwrap_or(SessionSource::Unknown)
}

fn map_storage_error(thread_id: &str, error: codex_wasm_v2_core::HostError) -> JSONRPCErrorError {
    let code = if error.code == HostErrorCode::NotFound {
        -32600
    } else {
        -32603
    };
    let message = if error.code == HostErrorCode::NotFound {
        format!("no rollout found for thread id {thread_id}")
    } else {
        error.message
    };
    JSONRPCErrorError {
        code,
        data: None,
        message,
    }
}

fn invalid_request_error(message: String) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32600,
        data: None,
        message,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use codex_app_server_protocol::ServerNotification;
    use codex_protocol::config_types::ModeKind;
    use codex_protocol::models::ResponseItem;
    use codex_protocol::protocol::Event;
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::protocol::RawResponseItemEvent;
    use codex_protocol::protocol::TurnStartedEvent;

    use super::ApiVersion;
    use super::CodexMessageProcessor;
    use super::CodexMessageProcessorArgs;
    use crate::OutgoingMessageSender;

    #[test]
    fn v2_processor_emits_notifications_for_builtin_tool_items() {
        let mut processor = CodexMessageProcessor::new(CodexMessageProcessorArgs {
            api_version: ApiVersion::V2,
            outgoing: Arc::new(std::sync::Mutex::new(OutgoingMessageSender::new())),
        });

        let notifications = processor.apply_bespoke_event_handling(
            "thread-1",
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::TurnStarted(TurnStartedEvent {
                    turn_id: "turn-1".to_string(),
                    model_context_window: None,
                    collaboration_mode_kind: ModeKind::default(),
                }),
            },
        );

        processor.apply_bespoke_event_handling(
            "thread-1",
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::RawResponseItem(RawResponseItemEvent {
                    item: ResponseItem::FunctionCall {
                        id: None,
                        name: "list_dir".to_string(),
                        namespace: None,
                        arguments: r#"{ "dir_path": "/workspace" }"#.to_string(),
                        call_id: "call-1".to_string(),
                    },
                }),
            },
        );

        assert_eq!(notifications.len(), 1);
        assert!(matches!(
            &notifications[0],
            ServerNotification::TurnStarted(_)
        ));
    }
}
