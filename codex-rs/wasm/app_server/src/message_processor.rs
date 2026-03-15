use std::collections::HashSet;
use std::sync::Arc;

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::CommandExecutionRequestApprovalParams;
use codex_app_server_protocol::ConfigWarningNotification;
use codex_app_server_protocol::DynamicToolCallParams;
use codex_app_server_protocol::McpServerElicitationRequest;
use codex_app_server_protocol::McpServerElicitationRequestParams;
use codex_app_server_protocol::PermissionsRequestApprovalParams;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::ToolRequestUserInputOption;
use codex_app_server_protocol::ToolRequestUserInputParams;
use codex_app_server_protocol::ToolRequestUserInputQuestion;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;

use crate::ApiVersion;
use crate::CodexMessageProcessor;
use crate::CodexMessageProcessorArgs;
use crate::PendingServerRequest;
use crate::outgoing_message::OutgoingMessageSender;

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
    pub server_requests: Vec<(
        codex_app_server_protocol::RequestId,
        PendingServerRequest,
        ServerRequest,
    )>,
    pub waiting_on_approval: bool,
    pub waiting_on_user_input: bool,
}

/// Mirror-track subset of upstream `app-server::MessageProcessor`.
///
/// This browser variant intentionally keeps only the request routing shell and
/// delegates turn/event shaping to `CodexMessageProcessor`.
pub struct MessageProcessor {
    outgoing: Arc<std::sync::Mutex<OutgoingMessageSender>>,
    codex_message_processor: CodexMessageProcessor,
    #[allow(dead_code)]
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

    pub fn process_request(
        &mut self,
        request: ClientRequest,
        _session: &mut ConnectionSessionState,
    ) {
        self.codex_message_processor.process_request(request);
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

    pub fn reset_current_turn(&mut self) {
        self.codex_message_processor.reset_current_turn();
    }

    pub fn process_core_event(
        &mut self,
        thread_id: &str,
        next_request_id: Option<codex_app_server_protocol::RequestId>,
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
            server_requests.push((request_id, pending, request));
        }
        CoreEventEffect {
            notifications,
            server_requests,
            waiting_on_approval,
            waiting_on_user_input,
        }
    }
}

fn map_server_request(
    thread_id: &str,
    request_id: codex_app_server_protocol::RequestId,
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
