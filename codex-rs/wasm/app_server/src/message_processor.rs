use std::collections::HashSet;
use std::sync::Arc;

use codex_app_server_protocol::ClientNotification;
use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::CommandExecutionRequestApprovalParams;
use codex_app_server_protocol::ConfigWarningNotification;
use codex_app_server_protocol::DynamicToolCallParams;
use codex_app_server_protocol::ExperimentalApi;
use codex_app_server_protocol::InitializeResponse;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::McpServerElicitationRequest;
use codex_app_server_protocol::McpServerElicitationRequestParams;
use codex_app_server_protocol::PermissionsRequestApprovalParams;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::ServerRequestResolvedNotification;
use codex_app_server_protocol::ToolRequestUserInputOption;
use codex_app_server_protocol::ToolRequestUserInputParams;
use codex_app_server_protocol::ToolRequestUserInputQuestion;
use codex_app_server_protocol::experimental_required_message;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_wasm_core::codex::Codex;

use crate::ApiVersion;
use crate::CodexMessageProcessor;
use crate::CodexMessageProcessorArgs;
use crate::PendingServerRequest;
use crate::ResolvedServerRequest;
use crate::ThreadRecord;
use crate::models::initialize_user_agent;
use crate::outgoing_message::OutgoingMessageSender;
use crate::runtime_bootstrap::RuntimeBootstrap;

const INVALID_REQUEST_ERROR_CODE: i64 = -32600;
const INTERNAL_ERROR_CODE: i64 = -32603;

#[derive(Clone, Debug, Default)]
pub struct ConnectionSessionState {
    pub initialized: bool,
    pub experimental_api_enabled: bool,
    pub opted_out_notification_methods: HashSet<String>,
    pub app_server_client_name: Option<String>,
    pub client_version: Option<String>,
}

pub struct MessageProcessorArgs {
    pub api_version: ApiVersion,
    pub config_warnings: Vec<ConfigWarningNotification>,
}

pub struct CoreEventEffect {
    pub notifications: Vec<ServerNotification>,
    pub server_requests: Vec<(RequestId, PendingServerRequest, ServerRequest)>,
    pub waiting_on_approval: bool,
    pub waiting_on_user_input: bool,
}

/// Mirror-track subset of upstream `app-server::MessageProcessor`.
///
/// This browser variant owns the typed request lifecycle, initialize gating,
/// pending request resolution, and delegation into `CodexMessageProcessor`.
pub struct MessageProcessor {
    outgoing: Arc<std::sync::Mutex<OutgoingMessageSender>>,
    codex_message_processor: CodexMessageProcessor,
    config_warnings: Vec<ConfigWarningNotification>,
}

impl MessageProcessor {
    pub fn new(args: MessageProcessorArgs) -> Self {
        let outgoing = Arc::new(std::sync::Mutex::new(OutgoingMessageSender::new()));
        let codex_message_processor = CodexMessageProcessor::new(CodexMessageProcessorArgs {
            api_version: args.api_version,
            outgoing: Arc::clone(&outgoing),
        });

        Self {
            outgoing,
            codex_message_processor,
            config_warnings: args.config_warnings,
        }
    }

    pub async fn process_request(
        &mut self,
        request: ClientRequest,
        session: &mut ConnectionSessionState,
    ) -> Result<serde_json::Value, JSONRPCErrorError> {
        self.process_client_request(request, session).await
    }

    pub async fn process_initialized_request(
        &mut self,
        request: ClientRequest,
    ) -> Result<serde_json::Value, JSONRPCErrorError> {
        self.codex_message_processor.process_request(request).await
    }

    pub async fn process_client_request(
        &mut self,
        request: ClientRequest,
        session: &mut ConnectionSessionState,
    ) -> Result<serde_json::Value, JSONRPCErrorError> {
        match request {
            ClientRequest::Initialize {
                request_id: _,
                params,
            } => {
                if session.initialized {
                    return Err(invalid_request_error("Already initialized"));
                }
                session.initialized = true;
                session.experimental_api_enabled = params
                    .capabilities
                    .as_ref()
                    .is_some_and(|capabilities| capabilities.experimental_api);
                session.opted_out_notification_methods = params
                    .capabilities
                    .and_then(|capabilities| capabilities.opt_out_notification_methods)
                    .unwrap_or_default()
                    .into_iter()
                    .collect();
                session.app_server_client_name = Some(params.client_info.name);
                session.client_version = Some(params.client_info.version);
                serde_json::to_value(InitializeResponse {
                    user_agent: initialize_user_agent(),
                })
                .map_err(internal_error)
            }
            other => {
                if !session.initialized {
                    return Err(invalid_request_error("Not initialized"));
                }
                if let Some(reason) = other.experimental_reason()
                    && !session.experimental_api_enabled
                {
                    return Err(invalid_request_error(&experimental_required_message(
                        reason,
                    )));
                }
                self.codex_message_processor.process_request(other).await
            }
        }
    }

    pub fn process_client_notification(
        &mut self,
        notification: ClientNotification,
        session: &mut ConnectionSessionState,
    ) -> Result<(), JSONRPCErrorError> {
        match notification {
            ClientNotification::Initialized => {
                if !session.initialized {
                    return Err(invalid_request_error("Not initialized"));
                }
                if let Ok(mut outgoing) = self.outgoing.lock() {
                    for notification in self.config_warnings.iter().cloned() {
                        outgoing.send_server_notification(ServerNotification::ConfigWarning(
                            notification,
                        ));
                    }
                }
                Ok(())
            }
        }
    }

    pub fn process_response(
        &mut self,
        request_id: RequestId,
        result: serde_json::Value,
    ) -> Result<ResolvedServerRequest, JSONRPCErrorError> {
        self.resolve_pending_server_request(request_id, Ok(result))
    }

    pub fn process_error(
        &mut self,
        request_id: RequestId,
        error: JSONRPCErrorError,
    ) -> Result<ResolvedServerRequest, JSONRPCErrorError> {
        self.resolve_pending_server_request(request_id, Err(error.message))
    }

    pub fn apply_bespoke_event_handling(
        &mut self,
        thread_id: &str,
        event: &Event,
    ) -> Vec<ServerNotification> {
        self.codex_message_processor
            .apply_bespoke_event_handling(thread_id, event)
    }

    pub fn take_notifications(&mut self) -> Vec<ServerNotification> {
        self.outgoing
            .lock()
            .map_or_else(|_| Vec::new(), |mut outgoing| outgoing.take_notifications())
    }

    pub fn take_server_requests(&mut self) -> Vec<ServerRequest> {
        self.outgoing.lock().map_or_else(
            |_| Vec::new(),
            |mut outgoing| outgoing.take_server_requests(),
        )
    }

    pub fn pending_server_requests(&self) -> Vec<ServerRequest> {
        self.outgoing.lock().map_or_else(
            |_| Vec::new(),
            |outgoing| outgoing.pending_server_requests(),
        )
    }

    pub fn reset_current_turn(&mut self) {
        self.codex_message_processor.reset_current_turn();
    }

    pub fn register_thread(&mut self, thread: ThreadRecord) {
        self.codex_message_processor.register_thread(thread);
    }

    pub fn register_loaded_thread(&mut self, thread: ThreadRecord, codex: Arc<Codex>) {
        self.codex_message_processor
            .register_loaded_thread(thread, codex);
    }

    pub fn thread_record(&self, thread_id: &str) -> Option<ThreadRecord> {
        self.codex_message_processor.thread_record(thread_id)
    }

    pub fn sync_thread_state_from_record(&mut self, thread: &ThreadRecord) {
        self.codex_message_processor
            .sync_thread_state_from_record(thread);
    }

    pub fn running_thread(&self, thread_id: &str) -> Option<Arc<Codex>> {
        self.codex_message_processor.running_thread(thread_id)
    }

    pub fn set_models(&mut self, models: Vec<ModelInfo>) {
        self.codex_message_processor.set_models(models);
    }

    pub fn set_runtime_bootstrap(&mut self, runtime_bootstrap: RuntimeBootstrap) {
        self.codex_message_processor
            .set_runtime_bootstrap(runtime_bootstrap);
    }

    pub fn set_apps(&mut self, apps: Vec<codex_app_server_protocol::AppInfo>) {
        self.codex_message_processor.set_apps(apps);
    }

    pub fn process_core_event(
        &mut self,
        thread_id: &str,
        next_request_id: Option<RequestId>,
        event: &Event,
    ) -> CoreEventEffect {
        let notifications = self
            .codex_message_processor
            .apply_bespoke_event_handling(thread_id, event);
        let mut server_requests = Vec::new();
        let waiting_on_approval = matches!(
            &event.msg,
            EventMsg::ExecApprovalRequest(_)
                | EventMsg::ApplyPatchApprovalRequest(_)
                | EventMsg::RequestPermissions(_)
        );
        let waiting_on_user_input = matches!(&event.msg, EventMsg::RequestUserInput(_));
        if let Some(request_id) = next_request_id
            && let Some((pending, request)) =
                map_server_request(thread_id, request_id.clone(), &event.msg)
        {
            if let Ok(mut outgoing) = self.outgoing.lock() {
                outgoing.send_server_request(pending.clone(), request.clone());
            }
            server_requests.push((request_id, pending, request));
        }
        CoreEventEffect {
            notifications,
            server_requests,
            waiting_on_approval,
            waiting_on_user_input,
        }
    }

    fn resolve_pending_server_request(
        &mut self,
        request_id: RequestId,
        result: Result<serde_json::Value, String>,
    ) -> Result<ResolvedServerRequest, JSONRPCErrorError> {
        let record = self
            .outgoing
            .lock()
            .map_err(|_| internal_error("failed to lock outgoing state"))?
            .resolve_pending_server_request(&request_id)
            .ok_or_else(|| invalid_request_error("Unknown server request"))?;
        let resolved =
            crate::resolve_server_request(record.pending, result).map_err(internal_error)?;
        if let Ok(mut outgoing) = self.outgoing.lock() {
            outgoing.send_server_notification(ServerNotification::ServerRequestResolved(
                ServerRequestResolvedNotification {
                    thread_id: resolved.thread_id.clone(),
                    request_id,
                },
            ));
        }
        Ok(resolved)
    }
}

fn map_server_request(
    thread_id: &str,
    request_id: RequestId,
    event: &EventMsg,
) -> Option<(PendingServerRequest, ServerRequest)> {
    match event {
        EventMsg::ExecApprovalRequest(event) => {
            let params = CommandExecutionRequestApprovalParams {
                thread_id: thread_id.to_string(),
                turn_id: event.turn_id.clone(),
                item_id: event.call_id.clone(),
                approval_id: event.approval_id.clone(),
                reason: event.reason.clone(),
                network_approval_context: event.network_approval_context.as_ref().map(|context| {
                    codex_app_server_protocol::NetworkApprovalContext {
                        host: context.host.clone(),
                        protocol: match context.protocol {
                            codex_protocol::approvals::NetworkApprovalProtocol::Http => {
                                codex_app_server_protocol::NetworkApprovalProtocol::Http
                            }
                            codex_protocol::approvals::NetworkApprovalProtocol::Https => {
                                codex_app_server_protocol::NetworkApprovalProtocol::Https
                            }
                            codex_protocol::approvals::NetworkApprovalProtocol::Socks5Tcp => {
                                codex_app_server_protocol::NetworkApprovalProtocol::Socks5Tcp
                            }
                            codex_protocol::approvals::NetworkApprovalProtocol::Socks5Udp => {
                                codex_app_server_protocol::NetworkApprovalProtocol::Socks5Udp
                            }
                        },
                    }
                }),
                command: Some(event.command.join(" ")),
                cwd: Some(event.cwd.clone()),
                command_actions: None,
                additional_permissions: event.additional_permissions.clone().map(Into::into),
                skill_metadata: event.skill_metadata.as_ref().map(|metadata| {
                    codex_app_server_protocol::CommandExecutionRequestApprovalSkillMetadata {
                        path_to_skills_md: metadata.path_to_skills_md.clone(),
                    }
                }),
                proposed_execpolicy_amendment: event
                    .proposed_execpolicy_amendment
                    .clone()
                    .map(Into::into),
                proposed_network_policy_amendments: event
                    .proposed_network_policy_amendments
                    .clone()
                    .map(|amendments| amendments.into_iter().map(Into::into).collect()),
                available_decisions: Some(
                    event
                        .effective_available_decisions()
                        .into_iter()
                        .map(codex_app_server_protocol::CommandExecutionApprovalDecision::from)
                        .collect(),
                ),
            };
            Some((
                PendingServerRequest::ExecApproval {
                    thread_id: thread_id.to_string(),
                    id: event.effective_approval_id(),
                    turn_id: event.turn_id.clone(),
                },
                ServerRequest::CommandExecutionRequestApproval { request_id, params },
            ))
        }
        EventMsg::ApplyPatchApprovalRequest(event) => Some((
            PendingServerRequest::PatchApproval {
                thread_id: thread_id.to_string(),
                id: event.call_id.clone(),
            },
            ServerRequest::FileChangeRequestApproval {
                request_id,
                params: codex_app_server_protocol::FileChangeRequestApprovalParams {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    item_id: event.call_id.clone(),
                    reason: event.reason.clone(),
                    grant_root: event.grant_root.clone(),
                },
            },
        )),
        EventMsg::RequestPermissions(event) => Some((
            PendingServerRequest::RequestPermissions {
                thread_id: thread_id.to_string(),
                id: event.call_id.clone(),
            },
            ServerRequest::PermissionsRequestApproval {
                request_id,
                params: PermissionsRequestApprovalParams {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    item_id: event.call_id.clone(),
                    reason: event.reason.clone(),
                    permissions: event.permissions.clone().into(),
                },
            },
        )),
        EventMsg::RequestUserInput(event) => Some((
            PendingServerRequest::UserInput {
                thread_id: thread_id.to_string(),
                id: event.call_id.clone(),
            },
            ServerRequest::ToolRequestUserInput {
                request_id,
                params: ToolRequestUserInputParams {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    item_id: event.call_id.clone(),
                    questions: event
                        .questions
                        .iter()
                        .map(|question| ToolRequestUserInputQuestion {
                            id: question.id.clone(),
                            header: question.header.clone(),
                            question: question.question.clone(),
                            is_other: question.is_other,
                            is_secret: question.is_secret,
                            options: question.options.as_ref().map(|options| {
                                options
                                    .iter()
                                    .map(|option| ToolRequestUserInputOption {
                                        label: option.label.clone(),
                                        description: option.description.clone(),
                                    })
                                    .collect()
                            }),
                        })
                        .collect(),
                },
            },
        )),
        EventMsg::ElicitationRequest(event) => {
            let request = McpServerElicitationRequest::try_from(event.request.clone()).ok()?;
            Some((
                PendingServerRequest::Elicitation {
                    thread_id: thread_id.to_string(),
                    request_id: event.id.clone(),
                    server_name: event.server_name.clone(),
                },
                ServerRequest::McpServerElicitationRequest {
                    request_id,
                    params: McpServerElicitationRequestParams {
                        thread_id: thread_id.to_string(),
                        turn_id: event.turn_id.clone(),
                        server_name: event.server_name.clone(),
                        request,
                    },
                },
            ))
        }
        EventMsg::DynamicToolCallRequest(event) => Some((
            PendingServerRequest::DynamicTool {
                thread_id: thread_id.to_string(),
                id: event.call_id.clone(),
            },
            ServerRequest::DynamicToolCall {
                request_id,
                params: DynamicToolCallParams {
                    thread_id: thread_id.to_string(),
                    turn_id: event.turn_id.clone(),
                    call_id: event.call_id.clone(),
                    tool: event.tool.clone(),
                    arguments: event.arguments.clone(),
                },
            },
        )),
        _ => None,
    }
}

fn invalid_request_error(message: &str) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: INVALID_REQUEST_ERROR_CODE,
        data: None,
        message: message.to_string(),
    }
}

fn internal_error(error: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: INTERNAL_ERROR_CODE,
        data: None,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::Mutex as StdMutex;

    use async_trait::async_trait;
    use pretty_assertions::assert_eq;

    use super::ConnectionSessionState;
    use super::MessageProcessor;
    use super::MessageProcessorArgs;
    use crate::ApiVersion;
    use crate::InProcessThreadHandle;
    use crate::models::initialize_user_agent;
    use codex_app_server_protocol::ClientInfo;
    use codex_app_server_protocol::ClientNotification;
    use codex_app_server_protocol::ClientRequest;
    use codex_app_server_protocol::ConfigReadParams;
    use codex_app_server_protocol::ConfigWarningNotification;
    use codex_app_server_protocol::InitializeCapabilities;
    use codex_app_server_protocol::InitializeParams;
    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::ServerNotification;
    use codex_app_server_protocol::SkillsListExtraRootsForCwd;
    use codex_app_server_protocol::SkillsListParams;
    use codex_app_server_protocol::ThreadArchiveParams;
    use codex_app_server_protocol::ThreadListParams;
    use codex_app_server_protocol::ThreadReadParams;
    use codex_app_server_protocol::ThreadResumeParams;
    use codex_app_server_protocol::ThreadRollbackParams;
    use codex_app_server_protocol::ThreadSetNameParams;
    use codex_app_server_protocol::ThreadUnarchiveParams;
    use codex_app_server_protocol::TurnInterruptParams;
    use codex_app_server_protocol::TurnStartParams;
    use codex_app_server_protocol::UserInput;
    use codex_protocol::config_types::ReasoningSummary;
    use codex_protocol::openai_models::ConfigShellToolType;
    use codex_protocol::openai_models::InputModality;
    use codex_protocol::openai_models::ModelInfo;
    use codex_protocol::openai_models::ModelVisibility;
    use codex_protocol::openai_models::TruncationPolicyConfig;
    use codex_protocol::openai_models::WebSearchToolType;
    use codex_protocol::protocol::Event;
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::protocol::SessionSource;
    use codex_protocol::request_user_input::RequestUserInputEvent;
    use codex_protocol::request_user_input::RequestUserInputQuestion;
    use codex_wasm_core::ConfigStorageHost;
    use codex_wasm_core::DeleteThreadSessionRequest;
    use codex_wasm_core::HostError;
    use codex_wasm_core::HostErrorCode;
    use codex_wasm_core::HostResult;
    use codex_wasm_core::ListThreadSessionsRequest;
    use codex_wasm_core::ListThreadSessionsResponse;
    use codex_wasm_core::LoadThreadSessionRequest;
    use codex_wasm_core::LoadThreadSessionResponse;
    use codex_wasm_core::LoadUserConfigRequest;
    use codex_wasm_core::LoadUserConfigResponse;
    use codex_wasm_core::SaveThreadSessionRequest;
    use codex_wasm_core::SaveUserConfigRequest;
    use codex_wasm_core::SaveUserConfigResponse;
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
    use codex_wasm_core::config::Constrained;
    use codex_wasm_core::config::types::McpServerConfig;
    use codex_wasm_core::config::types::McpServerTransportConfig;
    use std::collections::BTreeMap;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[derive(Default)]
    struct InMemoryThreadStorageHost {
        sessions: StdMutex<std::collections::HashMap<String, StoredThreadSession>>,
    }

    #[derive(Default)]
    struct InMemoryConfigStorageHost {
        content: StdMutex<Option<LoadUserConfigResponse>>,
    }

    #[async_trait]
    impl ConfigStorageHost for InMemoryConfigStorageHost {
        async fn load_user_config(
            &self,
            _request: LoadUserConfigRequest,
        ) -> Result<LoadUserConfigResponse, HostError> {
            self.content
                .lock()
                .expect("config storage lock")
                .clone()
                .ok_or_else(|| HostError {
                    code: HostErrorCode::NotFound,
                    message: "config not found".to_string(),
                    retryable: false,
                    data: None,
                })
        }

        async fn save_user_config(
            &self,
            request: SaveUserConfigRequest,
        ) -> Result<SaveUserConfigResponse, HostError> {
            let file_path = request
                .file_path
                .clone()
                .unwrap_or_else(|| "config.toml".to_string());
            let response = LoadUserConfigResponse {
                file_path: file_path.clone(),
                version: "v1".to_string(),
                content: request.content,
            };
            let mut guard = self.content.lock().expect("config storage lock");
            *guard = Some(response);
            Ok(SaveUserConfigResponse {
                file_path,
                version: "v1".to_string(),
            })
        }
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
    async fn initialize_requires_single_handshake_and_emits_config_warnings_after_initialized() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: vec![ConfigWarningNotification {
                summary: "warning".to_string(),
                details: None,
                path: None,
                range: None,
            }],
        });
        let mut session = ConnectionSessionState::default();

        let response = processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: Some(vec!["thread/started".to_string()]),
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        assert_eq!(
            response
                .get("userAgent")
                .and_then(serde_json::Value::as_str)
                .expect("user agent"),
            initialize_user_agent()
        );
        assert!(session.initialized);
        assert!(session.experimental_api_enabled);
        assert_eq!(
            session.opted_out_notification_methods,
            HashSet::from(["thread/started".to_string()])
        );

        processor
            .process_client_notification(ClientNotification::Initialized, &mut session)
            .expect("initialized notification succeeds");
        assert_eq!(processor.take_server_requests(), Vec::new());
        assert_eq!(processor.take_notifications().len(), 1);

        let error = processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(2),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.1".to_string(),
                        },
                        capabilities: None,
                    },
                },
                &mut session,
            )
            .await
            .expect_err("double initialize should fail");
        assert_eq!(error.message, "Already initialized");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolving_pending_server_request_emits_resolved_notification() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut thread = InProcessThreadHandle::default();

        crate::process_core_event(
            &mut processor,
            "thread-1",
            &mut thread,
            Some(RequestId::Integer(7)),
            &Event {
                id: "turn-1".to_string(),
                msg: EventMsg::RequestUserInput(RequestUserInputEvent {
                    call_id: "item-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    questions: vec![RequestUserInputQuestion {
                        id: "q1".to_string(),
                        header: "Question".to_string(),
                        question: "Proceed?".to_string(),
                        is_other: false,
                        is_secret: false,
                        options: None,
                    }],
                }),
            },
        );

        assert_eq!(processor.pending_server_requests().len(), 1);
        assert_eq!(processor.take_server_requests().len(), 1);

        let resolved = processor
            .process_response(
                RequestId::Integer(7),
                serde_json::json!({
                    "answers": {
                        "q1": { "answers": ["yes"] }
                    }
                }),
            )
            .expect("pending request resolves");

        assert_eq!(resolved.thread_id, "thread-1".to_string());
        assert_eq!(processor.pending_server_requests(), Vec::new());
        let notifications = processor.take_notifications();
        assert_eq!(notifications.len(), 1);
        assert!(matches!(
            notifications.first(),
            Some(ServerNotification::ServerRequestResolved(
                codex_app_server_protocol::ServerRequestResolvedNotification {
                    thread_id,
                    request_id: RequestId::Integer(7),
                }
            )) if thread_id == "thread-1"
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn routed_requests_support_thread_read_thread_list_and_model_list() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        processor.register_thread(test_thread_record("thread-1", "/workspace/one", false));
        processor.register_thread(test_thread_record("thread-2", "/workspace/two", true));
        processor.set_models(vec![test_model_info()]);
        processor.set_apps(vec![codex_app_server_protocol::AppInfo {
            id: "app-1".to_string(),
            name: "App One".to_string(),
            description: Some("desc".to_string()),
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

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let thread_read = processor
            .process_client_request(
                ClientRequest::ThreadRead {
                    request_id: RequestId::Integer(2),
                    params: ThreadReadParams {
                        thread_id: "thread-1".to_string(),
                        include_turns: true,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/read succeeds");
        assert_eq!(
            thread_read
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(serde_json::Value::as_str),
            Some("thread-1")
        );

        let thread_list = processor
            .process_client_request(
                ClientRequest::ThreadList {
                    request_id: RequestId::Integer(3),
                    params: ThreadListParams {
                        cursor: None,
                        limit: None,
                        sort_key: None,
                        model_providers: None,
                        source_kinds: None,
                        archived: Some(false),
                        cwd: None,
                        search_term: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/list succeeds");
        assert_eq!(
            thread_list
                .get("data")
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );

        let model_list = processor
            .process_client_request(
                ClientRequest::ModelList {
                    request_id: RequestId::Integer(4),
                    params: codex_app_server_protocol::ModelListParams {
                        cursor: None,
                        limit: None,
                        include_hidden: Some(false),
                    },
                },
                &mut session,
            )
            .await
            .expect("model/list succeeds");
        assert_eq!(
            model_list
                .get("data")
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );

        let apps_list = processor
            .process_client_request(
                ClientRequest::AppsList {
                    request_id: RequestId::Integer(5),
                    params: codex_app_server_protocol::AppsListParams {
                        cursor: None,
                        limit: None,
                        thread_id: None,
                        force_refetch: false,
                    },
                },
                &mut session,
            )
            .await
            .expect("app/list succeeds");
        assert_eq!(
            apps_list
                .get("data")
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn config_read_returns_bootstrap_backed_protocol_config() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-config-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let mut config = Config {
            codex_home: root.clone(),
            cwd: root.clone(),
            model: Some("gpt-test".to_string()),
            model_provider_id: "openai".to_string(),
            base_instructions: Some("base".to_string()),
            developer_instructions: Some("dev".to_string()),
            compact_prompt: Some("compact".to_string()),
            model_reasoning_effort: Some(codex_protocol::openai_models::ReasoningEffort::High),
            ..Config::default()
        };
        let _ = config
            .permissions
            .approval_policy
            .set(codex_protocol::protocol::AskForApproval::OnRequest);
        let _ = config
            .permissions
            .sandbox_policy
            .set(codex_protocol::protocol::SandboxPolicy::new_workspace_write_policy());
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config,
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let config_read = processor
            .process_client_request(
                ClientRequest::ConfigRead {
                    request_id: RequestId::Integer(2),
                    params: ConfigReadParams {
                        include_layers: true,
                        cwd: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/read succeeds");

        assert_eq!(
            config_read
                .get("config")
                .and_then(|config| config.get("model"))
                .and_then(serde_json::Value::as_str),
            Some("gpt-test")
        );
        assert_eq!(
            config_read
                .get("config")
                .and_then(|config| config.get("model_reasoning_effort"))
                .and_then(serde_json::Value::as_str),
            Some("high")
        );
        assert_eq!(
            config_read
                .get("origins")
                .and_then(|origins| origins.get("model"))
                .and_then(|origin| origin.get("name"))
                .and_then(|name| name.get("type"))
                .and_then(serde_json::Value::as_str),
            Some("sessionFlags")
        );
        assert_eq!(
            config_read
                .get("layers")
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn config_write_persists_user_config_and_updates_effective_read() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-config-write-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let config_storage_host = Arc::new(InMemoryConfigStorageHost::default());
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
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
            config_storage_host: config_storage_host.clone(),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let written = processor
            .process_client_request(
                ClientRequest::ConfigValueWrite {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ConfigValueWriteParams {
                        key_path: "model".to_string(),
                        value: serde_json::json!("gpt-5"),
                        merge_strategy: codex_app_server_protocol::MergeStrategy::Replace,
                        file_path: None,
                        expected_version: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/value/write succeeds");
        assert_eq!(
            written.get("status").and_then(serde_json::Value::as_str),
            Some("ok")
        );

        processor
            .process_client_request(
                ClientRequest::ConfigBatchWrite {
                    request_id: RequestId::Integer(3),
                    params: codex_app_server_protocol::ConfigBatchWriteParams {
                        edits: vec![codex_app_server_protocol::ConfigEdit {
                            key_path: "developer_instructions".to_string(),
                            value: serde_json::json!("browser instructions"),
                            merge_strategy: codex_app_server_protocol::MergeStrategy::Replace,
                        }],
                        file_path: None,
                        expected_version: Some("v1".to_string()),
                        reload_user_config: false,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/batchWrite succeeds");

        let config_read = processor
            .process_client_request(
                ClientRequest::ConfigRead {
                    request_id: RequestId::Integer(4),
                    params: ConfigReadParams {
                        include_layers: true,
                        cwd: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/read succeeds");
        assert_eq!(config_read["config"]["model"].as_str(), Some("gpt-5"));
        assert_eq!(
            config_read["config"]["developer_instructions"].as_str(),
            Some("browser instructions")
        );

        let saved = config_storage_host
            .load_user_config(LoadUserConfigRequest {})
            .await
            .expect("config saved");
        assert!(saved.content.contains("model = \"gpt-5\""));
        assert!(
            saved
                .content
                .contains("developer_instructions = \"browser instructions\"")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn config_write_updates_effective_mcp_servers_for_status_and_read() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-mcp-write-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root,
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(InMemoryConfigStorageHost::default()),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        processor
            .process_client_request(
                ClientRequest::ConfigValueWrite {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ConfigValueWriteParams {
                        key_path: "mcp_servers".to_string(),
                        value: serde_json::json!({
                            "mcp_notion_com_mcp": {
                                "url": "https://mcp.notion.com/mcp"
                            }
                        }),
                        merge_strategy: codex_app_server_protocol::MergeStrategy::Replace,
                        file_path: None,
                        expected_version: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/value/write succeeds");

        let config_read = processor
            .process_client_request(
                ClientRequest::ConfigRead {
                    request_id: RequestId::Integer(3),
                    params: ConfigReadParams {
                        include_layers: false,
                        cwd: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/read succeeds");
        assert_eq!(
            config_read["config"]["mcp_servers"]["mcp_notion_com_mcp"]["url"].as_str(),
            Some("https://mcp.notion.com/mcp")
        );

        let mcp_status = processor
            .process_client_request(
                ClientRequest::McpServerStatusList {
                    request_id: RequestId::Integer(4),
                    params: codex_app_server_protocol::ListMcpServerStatusParams {
                        cursor: None,
                        limit: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("mcpServerStatus/list succeeds");
        assert_eq!(
            mcp_status["data"][0]["name"].as_str(),
            Some("mcp_notion_com_mcp")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn config_read_exposes_remote_mcp_servers_and_status_list() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-mcp-config-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root,
                mcp_servers: Constrained::allow_any(HashMap::from([(
                    "docs".to_string(),
                    McpServerConfig {
                        transport: McpServerTransportConfig::StreamableHttp {
                            url: "https://example.com/mcp".to_string(),
                            bearer_token_env_var: None,
                            http_headers: None,
                            env_http_headers: None,
                        },
                        ..McpServerConfig::default()
                    },
                )])),
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(InMemoryConfigStorageHost::default()),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let config_read = processor
            .process_client_request(
                ClientRequest::ConfigRead {
                    request_id: RequestId::Integer(2),
                    params: ConfigReadParams {
                        include_layers: false,
                        cwd: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("config/read succeeds");
        assert_eq!(
            config_read["config"]["mcp_servers"]["docs"]["url"].as_str(),
            Some("https://example.com/mcp")
        );

        let mcp_status = processor
            .process_client_request(
                ClientRequest::McpServerStatusList {
                    request_id: RequestId::Integer(3),
                    params: codex_app_server_protocol::ListMcpServerStatusParams {
                        cursor: None,
                        limit: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("mcpServerStatus/list succeeds");
        assert_eq!(mcp_status["data"][0]["name"].as_str(), Some("docs"));
        assert_eq!(
            mcp_status["data"][0]["authStatus"].as_str(),
            Some("unsupported")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn config_requirements_read_returns_null_when_no_requirements_exist() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-config-requirements-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root,
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(InMemoryConfigStorageHost::default()),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let response = processor
            .process_client_request(
                ClientRequest::ConfigRequirementsRead {
                    request_id: RequestId::Integer(2),
                    params: None,
                },
                &mut session,
            )
            .await
            .expect("configRequirements/read succeeds");
        assert_eq!(response["requirements"], serde_json::Value::Null);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn skills_config_write_persists_to_browser_config_storage() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-skills-config-write-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let config_storage_host = Arc::new(InMemoryConfigStorageHost::default());
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root,
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: config_storage_host.clone(),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let response = processor
            .process_client_request(
                ClientRequest::SkillsConfigWrite {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::SkillsConfigWriteParams {
                        path: std::path::PathBuf::from("/tmp/skills/demo"),
                        enabled: false,
                    },
                },
                &mut session,
            )
            .await
            .expect("skills/config/write succeeds");
        assert_eq!(response["effectiveEnabled"], serde_json::json!(false));

        let saved = config_storage_host
            .load_user_config(LoadUserConfigRequest {})
            .await
            .expect("config saved");
        assert!(saved.content.contains("[[skills.config]]"));
        assert!(saved.content.contains("path = \"/tmp/skills/demo\""));
        assert!(saved.content.contains("enabled = false"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn skills_list_returns_repo_home_and_extra_root_skills() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-skills-test-{}",
            std::process::id()
        ));
        let project_root = root.join("project");
        let codex_home = root.join("home");
        let extra_root = root.join("extra");
        std::fs::create_dir_all(&project_root).expect("create project root");
        std::fs::create_dir_all(&codex_home).expect("create codex home");
        std::fs::create_dir_all(&extra_root).expect("create extra root");
        write_skill(
            &project_root.join("skills/repo-skill/SKILL.md"),
            "repo-skill",
            "repo description",
        );
        write_skill(
            &codex_home.join("skills/user-skill/SKILL.md"),
            "user-skill",
            "user description",
        );
        write_skill(
            &extra_root.join("extra-skill/SKILL.md"),
            "extra-skill",
            "extra description",
        );
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: codex_home.clone(),
                cwd: project_root.clone(),
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let skills_list = processor
            .process_client_request(
                ClientRequest::SkillsList {
                    request_id: RequestId::Integer(2),
                    params: SkillsListParams {
                        cwds: vec![project_root.clone()],
                        force_reload: false,
                        per_cwd_extra_user_roots: Some(vec![SkillsListExtraRootsForCwd {
                            cwd: project_root.clone(),
                            extra_user_roots: vec![extra_root.clone()],
                        }]),
                    },
                },
                &mut session,
            )
            .await
            .expect("skills/list succeeds");

        assert_eq!(
            skills_list
                .get("data")
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );
        assert_eq!(
            skills_list["data"][0]["cwd"].as_str(),
            Some(project_root.to_string_lossy().as_ref())
        );
        assert_eq!(
            skills_list["data"][0]["errors"].as_array(),
            Some(&Vec::new())
        );
        assert_eq!(
            skills_list["data"][0]["skills"]
                .as_array()
                .expect("skills array")
                .iter()
                .filter_map(|skill| skill.get("name").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>(),
            vec!["extra-skill", "repo-skill", "user-skill"]
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_name_set_archive_and_unarchive_update_protocol_state() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        processor.register_thread(test_thread_record("thread-1", "/workspace/one", false));

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let rename = processor
            .process_client_request(
                ClientRequest::ThreadSetName {
                    request_id: RequestId::Integer(2),
                    params: ThreadSetNameParams {
                        thread_id: "thread-1".to_string(),
                        name: "  Renamed Thread  ".to_string(),
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/name/set succeeds");
        assert_eq!(rename, serde_json::json!({}));
        assert!(matches!(
            processor.take_notifications().first(),
            Some(ServerNotification::ThreadNameUpdated(
                codex_app_server_protocol::ThreadNameUpdatedNotification {
                    thread_id,
                    thread_name: Some(thread_name),
                }
            )) if thread_id == "thread-1" && thread_name == "Renamed Thread"
        ));

        let archived = processor
            .process_client_request(
                ClientRequest::ThreadArchive {
                    request_id: RequestId::Integer(3),
                    params: ThreadArchiveParams {
                        thread_id: "thread-1".to_string(),
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/archive succeeds");
        assert_eq!(archived, serde_json::json!({}));
        assert!(matches!(
            processor.take_notifications().first(),
            Some(ServerNotification::ThreadArchived(
                codex_app_server_protocol::ThreadArchivedNotification { thread_id }
            )) if thread_id == "thread-1"
        ));

        let active_list = processor
            .process_client_request(
                ClientRequest::ThreadList {
                    request_id: RequestId::Integer(4),
                    params: ThreadListParams {
                        cursor: None,
                        limit: None,
                        sort_key: None,
                        model_providers: None,
                        source_kinds: None,
                        archived: Some(false),
                        cwd: None,
                        search_term: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/list active succeeds");
        assert_eq!(
            active_list
                .get("data")
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(0)
        );

        let unarchived = processor
            .process_client_request(
                ClientRequest::ThreadUnarchive {
                    request_id: RequestId::Integer(5),
                    params: ThreadUnarchiveParams {
                        thread_id: "thread-1".to_string(),
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/unarchive succeeds");
        assert_eq!(
            unarchived
                .get("thread")
                .and_then(|thread| thread.get("name"))
                .and_then(serde_json::Value::as_str),
            Some("Renamed Thread")
        );
        assert!(matches!(
            processor.take_notifications().first(),
            Some(ServerNotification::ThreadUnarchived(
                codex_app_server_protocol::ThreadUnarchivedNotification { thread_id }
            )) if thread_id == "thread-1"
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_resume_returns_loaded_thread_protocol_snapshot() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-resume-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let mut config = Config {
            codex_home: root.clone(),
            cwd: root.clone(),
            model: Some("gpt-test".to_string()),
            model_provider_id: "openai".to_string(),
            ..Config::default()
        };
        let _ = config
            .permissions
            .approval_policy
            .set(codex_protocol::protocol::AskForApproval::OnRequest);
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config,
            auth: None,
            model_catalog: Some(codex_protocol::openai_models::ModelsResponse {
                models: vec![test_model_info()],
            }),
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let thread_start = processor
            .process_client_request(
                ClientRequest::ThreadStart {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ThreadStartParams {
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
                &mut session,
            )
            .await
            .expect("thread/start succeeds");
        let thread_id = thread_start["thread"]["id"]
            .as_str()
            .expect("thread id")
            .to_string();

        let resumed = processor
            .process_client_request(
                ClientRequest::ThreadResume {
                    request_id: RequestId::Integer(3),
                    params: ThreadResumeParams {
                        thread_id,
                        history: None,
                        path: None,
                        model: Some("ignored".to_string()),
                        model_provider: Some("ignored".to_string()),
                        service_tier: None,
                        cwd: Some("/ignored".to_string()),
                        approval_policy: None,
                        sandbox: None,
                        config: None,
                        base_instructions: None,
                        developer_instructions: None,
                        personality: None,
                        persist_extended_history: false,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/resume succeeds");

        assert_eq!(
            resumed.get("model").and_then(serde_json::Value::as_str),
            Some("gpt-test")
        );
        assert_eq!(
            resumed
                .get("modelProvider")
                .and_then(serde_json::Value::as_str),
            Some("openai")
        );
        assert_eq!(
            resumed["thread"]["id"].as_str(),
            thread_start["thread"]["id"].as_str()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_resume_loads_unloaded_thread_from_storage_host() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-unloaded-resume-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let thread_storage_host = Arc::new(InMemoryThreadStorageHost::default());
        thread_storage_host
            .save_thread_session(SaveThreadSessionRequest {
                session: StoredThreadSession {
                    metadata: StoredThreadSessionMetadata {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abc".to_string(),
                        rollout_id:
                            "rollout-2026-03-16T12-00-00-0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abc.jsonl"
                                .to_string(),
                        created_at: 1,
                        updated_at: 2,
                        archived: false,
                        name: Some("Stored Thread".to_string()),
                        preview: "Stored prompt".to_string(),
                        cwd: root.display().to_string(),
                        model_provider: "openai".to_string(),
                    },
                    items: vec![codex_protocol::protocol::RolloutItem::SessionMeta(
                        codex_protocol::protocol::SessionMetaLine {
                            meta: codex_protocol::protocol::SessionMeta {
                                id: codex_protocol::ThreadId::from_string(
                                    "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abc",
                                )
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
                        },
                    )],
                },
            })
            .await
            .expect("seed stored session");
        let config = Config {
            codex_home: root.clone(),
            cwd: root.clone(),
            model: Some("gpt-test".to_string()),
            model_provider_id: "openai".to_string(),
            ..Config::default()
        };
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config,
            auth: None,
            model_catalog: Some(codex_protocol::openai_models::ModelsResponse {
                models: vec![test_model_info()],
            }),
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host,
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let resumed = processor
            .process_client_request(
                ClientRequest::ThreadResume {
                    request_id: RequestId::Integer(2),
                    params: ThreadResumeParams {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abc".to_string(),
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
                &mut session,
            )
            .await
            .expect("thread/resume succeeds");

        assert_eq!(
            resumed["thread"]["id"].as_str(),
            Some("0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abc")
        );
        assert_eq!(resumed["thread"]["name"].as_str(), Some("Stored Thread"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_list_includes_unloaded_threads_from_storage_host() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-thread-list-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let thread_storage_host = Arc::new(InMemoryThreadStorageHost::default());
        thread_storage_host
            .save_thread_session(SaveThreadSessionRequest {
                session: StoredThreadSession {
                    metadata: StoredThreadSessionMetadata {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abd".to_string(),
                        rollout_id:
                            "rollout-2026-03-16T12-00-00-0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abd.jsonl"
                                .to_string(),
                        created_at: 1,
                        updated_at: 2,
                        archived: false,
                        name: Some("Stored Thread".to_string()),
                        preview: "Stored prompt".to_string(),
                        cwd: root.display().to_string(),
                        model_provider: "openai".to_string(),
                    },
                    items: Vec::new(),
                },
            })
            .await
            .expect("seed stored session");
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root.clone(),
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
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let listed = processor
            .process_client_request(
                ClientRequest::ThreadList {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ThreadListParams {
                        cursor: None,
                        limit: None,
                        search_term: None,
                        archived: Some(false),
                        cwd: Some(root.display().to_string()),
                        model_providers: None,
                        source_kinds: None,
                        sort_key: None,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/list succeeds");

        assert_eq!(
            listed["data"][0]["id"].as_str(),
            Some("0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abd")
        );
        assert_eq!(listed["data"][0]["name"].as_str(), Some("Stored Thread"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_read_loads_unloaded_thread_from_storage_host() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-thread-read-test-{}",
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
                    items: vec![codex_protocol::protocol::RolloutItem::SessionMeta(
                        codex_protocol::protocol::SessionMetaLine {
                            meta: codex_protocol::protocol::SessionMeta {
                                id: codex_protocol::ThreadId::from_string(
                                    "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe",
                                )
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
                        },
                    )],
                },
            })
            .await
            .expect("seed stored session");
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root.clone(),
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
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let read = processor
            .process_client_request(
                ClientRequest::ThreadRead {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ThreadReadParams {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe".to_string(),
                        include_turns: true,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/read succeeds");

        assert_eq!(
            read["thread"]["id"].as_str(),
            Some("0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abe")
        );
        assert_eq!(read["thread"]["name"].as_str(), Some("Stored Thread"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_set_name_updates_stored_thread_metadata() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-thread-name-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let thread_storage_host = Arc::new(InMemoryThreadStorageHost::default());
        thread_storage_host
            .save_thread_session(SaveThreadSessionRequest {
                session: StoredThreadSession {
                    metadata: StoredThreadSessionMetadata {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abf".to_string(),
                        rollout_id:
                            "rollout-2026-03-16T12-00-00-0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abf.jsonl"
                                .to_string(),
                        created_at: 1,
                        updated_at: 2,
                        archived: false,
                        name: Some("Old Name".to_string()),
                        preview: "Stored prompt".to_string(),
                        cwd: root.display().to_string(),
                        model_provider: "openai".to_string(),
                    },
                    items: Vec::new(),
                },
            })
            .await
            .expect("seed stored session");
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config: Config {
                codex_home: root.clone(),
                cwd: root.clone(),
                ..Config::default()
            },
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: thread_storage_host.clone(),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        processor
            .process_client_request(
                ClientRequest::ThreadSetName {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ThreadSetNameParams {
                        thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abf".to_string(),
                        name: "Renamed".to_string(),
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/name/set succeeds");

        let stored = thread_storage_host
            .load_thread_session(LoadThreadSessionRequest {
                thread_id: "0194c6f0-4d4c-7eb2-a1d2-137d8d7c0abf".to_string(),
            })
            .await
            .expect("stored session exists")
            .session;
        assert_eq!(stored.metadata.name.as_deref(), Some("Renamed"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_rollback_returns_protocol_thread_response() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-rollback-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let config = Config {
            codex_home: root.clone(),
            cwd: root.clone(),
            model: Some("gpt-test".to_string()),
            model_provider_id: "openai".to_string(),
            ..Config::default()
        };
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config,
            auth: None,
            model_catalog: Some(codex_protocol::openai_models::ModelsResponse {
                models: vec![test_model_info()],
            }),
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let thread_start = processor
            .process_client_request(
                ClientRequest::ThreadStart {
                    request_id: RequestId::Integer(2),
                    params: codex_app_server_protocol::ThreadStartParams {
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
                        ephemeral: Some(false),
                        dynamic_tools: None,
                        mock_experimental_field: None,
                        experimental_raw_events: false,
                        persist_extended_history: false,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/start succeeds");
        let thread_id = thread_start["thread"]["id"]
            .as_str()
            .expect("thread id")
            .to_string();

        let rolled_back = processor
            .process_client_request(
                ClientRequest::ThreadRollback {
                    request_id: RequestId::Integer(3),
                    params: ThreadRollbackParams {
                        thread_id,
                        num_turns: 1,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/rollback succeeds");

        assert_eq!(
            rolled_back["thread"]["id"].as_str(),
            thread_start["thread"]["id"].as_str()
        );
        assert_eq!(rolled_back["thread"]["turns"].as_array(), Some(&Vec::new()));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn thread_start_uses_runtime_bootstrap_and_registers_loaded_thread() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root =
            std::env::temp_dir().join(format!("codex-wasm-app-server-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create temp root");
        let mut config = Config {
            codex_home: root.clone(),
            cwd: root.clone(),
            model: Some("gpt-test".to_string()),
            model_provider_id: "openai".to_string(),
            ..Config::default()
        };
        let _ = config
            .permissions
            .approval_policy
            .set(codex_protocol::protocol::AskForApproval::OnRequest);
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config,
            auth: None,
            model_catalog: Some(codex_protocol::openai_models::ModelsResponse {
                models: vec![test_model_info()],
            }),
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let response = processor
            .process_client_request(
                ClientRequest::ThreadStart {
                    request_id: RequestId::Integer(10),
                    params: codex_app_server_protocol::ThreadStartParams {
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
                &mut session,
            )
            .await
            .expect("thread/start succeeds");

        assert_eq!(
            response
                .get("thread")
                .and_then(|thread| thread.get("status"))
                .and_then(|status| status.get("type"))
                .and_then(serde_json::Value::as_str),
            Some("idle")
        );
        let notifications = processor.take_notifications();
        assert!(
            notifications
                .iter()
                .any(|notification| matches!(notification, ServerNotification::ThreadStarted(_))),
            "expected thread/started notification"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn turn_start_updates_loaded_thread_state_and_interrupt_checks_active_turn() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let mut session = ConnectionSessionState::default();
        let root = std::env::temp_dir().join(format!(
            "codex-wasm-app-server-turn-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        let mut config = Config {
            codex_home: root.clone(),
            cwd: root.clone(),
            model: Some("gpt-test".to_string()),
            model_provider_id: "openai".to_string(),
            ..Config::default()
        };
        let _ = config
            .permissions
            .approval_policy
            .set(codex_protocol::protocol::AskForApproval::OnRequest);
        processor.set_runtime_bootstrap(crate::RuntimeBootstrap {
            config,
            auth: None,
            model_catalog: Some(codex_protocol::openai_models::ModelsResponse {
                models: vec![test_model_info()],
            }),
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        });

        processor
            .process_client_request(
                ClientRequest::Initialize {
                    request_id: RequestId::Integer(1),
                    params: InitializeParams {
                        client_info: ClientInfo {
                            name: "web".to_string(),
                            title: None,
                            version: "1.0.0".to_string(),
                        },
                        capabilities: Some(InitializeCapabilities {
                            experimental_api: true,
                            opt_out_notification_methods: None,
                        }),
                    },
                },
                &mut session,
            )
            .await
            .expect("initialize succeeds");

        let thread_start = processor
            .process_client_request(
                ClientRequest::ThreadStart {
                    request_id: RequestId::Integer(10),
                    params: codex_app_server_protocol::ThreadStartParams {
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
                &mut session,
            )
            .await
            .expect("thread/start succeeds");
        let thread_id = thread_start
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(serde_json::Value::as_str)
            .expect("thread id")
            .to_string();

        let turn_start = processor
            .process_client_request(
                ClientRequest::TurnStart {
                    request_id: RequestId::Integer(11),
                    params: TurnStartParams {
                        thread_id: thread_id.clone(),
                        input: vec![UserInput::Text {
                            text: "hello from browser".to_string(),
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
                &mut session,
            )
            .await
            .expect("turn/start succeeds");
        let turn_id = turn_start
            .get("turn")
            .and_then(|turn| turn.get("id"))
            .and_then(serde_json::Value::as_str)
            .expect("turn id")
            .to_string();
        assert_eq!(
            turn_start
                .get("turn")
                .and_then(|turn| turn.get("status"))
                .and_then(serde_json::Value::as_str),
            Some("inProgress")
        );

        let thread_read = processor
            .process_client_request(
                ClientRequest::ThreadRead {
                    request_id: RequestId::Integer(12),
                    params: ThreadReadParams {
                        thread_id: thread_id.clone(),
                        include_turns: true,
                    },
                },
                &mut session,
            )
            .await
            .expect("thread/read succeeds");
        assert_eq!(
            thread_read
                .get("thread")
                .and_then(|thread| thread.get("status"))
                .and_then(|status| status.get("type"))
                .and_then(serde_json::Value::as_str),
            Some("active")
        );
        assert_eq!(
            thread_read
                .get("thread")
                .and_then(|thread| thread.get("preview"))
                .and_then(serde_json::Value::as_str),
            Some("hello from browser")
        );
        assert_eq!(
            thread_read
                .get("thread")
                .and_then(|thread| thread.get("turns"))
                .and_then(serde_json::Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );

        let interrupt_mismatch = processor
            .process_client_request(
                ClientRequest::TurnInterrupt {
                    request_id: RequestId::Integer(13),
                    params: TurnInterruptParams {
                        thread_id,
                        turn_id: "different-turn".to_string(),
                    },
                },
                &mut session,
            )
            .await
            .expect_err("turn/interrupt should reject mismatched active turn");
        assert_eq!(
            interrupt_mismatch.message,
            "turn/interrupt expected the currently active turn id"
        );

        let interrupt = processor
            .process_client_request(
                ClientRequest::TurnInterrupt {
                    request_id: RequestId::Integer(14),
                    params: TurnInterruptParams {
                        thread_id: thread_read
                            .get("thread")
                            .and_then(|thread| thread.get("id"))
                            .and_then(serde_json::Value::as_str)
                            .expect("thread id")
                            .to_string(),
                        turn_id,
                    },
                },
                &mut session,
            )
            .await
            .expect("turn/interrupt succeeds");
        assert_eq!(interrupt, serde_json::json!({}));
    }

    fn test_thread_record(thread_id: &str, cwd: &str, archived: bool) -> crate::ThreadRecord {
        crate::ThreadRecord {
            id: thread_id.to_string(),
            preview: format!("preview {thread_id}"),
            ephemeral: false,
            model_provider: "openai".to_string(),
            cwd: PathBuf::from(cwd),
            source: SessionSource::Unknown,
            name: Some(format!("Thread {thread_id}")),
            created_at: 10,
            updated_at: 20,
            archived,
            turns: BTreeMap::new(),
            active_turn_id: None,
            waiting_on_approval: false,
            waiting_on_user_input: false,
        }
    }

    fn test_model_info() -> ModelInfo {
        ModelInfo {
            slug: "gpt-test".to_string(),
            display_name: "GPT Test".to_string(),
            description: Some("Test model".to_string()),
            default_reasoning_level: None,
            supported_reasoning_levels: vec![],
            shell_type: ConfigShellToolType::ShellCommand,
            visibility: ModelVisibility::List,
            supported_in_api: true,
            priority: 1,
            availability_nux: None,
            upgrade: None,
            base_instructions: "base".to_string(),
            model_messages: None,
            supports_reasoning_summaries: false,
            default_reasoning_summary: ReasoningSummary::Auto,
            support_verbosity: false,
            default_verbosity: None,
            apply_patch_tool_type: None,
            web_search_tool_type: WebSearchToolType::Text,
            truncation_policy: TruncationPolicyConfig::bytes(10_000),
            supports_parallel_tool_calls: false,
            supports_image_detail_original: false,
            context_window: None,
            auto_compact_token_limit: None,
            effective_context_window_percent: 95,
            experimental_supported_tools: vec![],
            input_modalities: vec![InputModality::Text],
            prefer_websockets: false,
            used_fallback_model_metadata: false,
        }
    }

    fn write_skill(path: &PathBuf, name: &str, description: &str) {
        let parent = path.parent().expect("skill parent");
        std::fs::create_dir_all(parent).expect("create skill dir");
        std::fs::write(
            path,
            format!("---\nname: {name}\ndescription: {description}\n---\n# {name}\n"),
        )
        .expect("write skill");
    }
}
