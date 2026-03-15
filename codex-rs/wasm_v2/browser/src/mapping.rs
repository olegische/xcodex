use std::collections::HashMap;

use codex_app_server_protocol::AgentMessageDeltaNotification;
use codex_app_server_protocol::AppInfo;
use codex_app_server_protocol::AppsListResponse;
use codex_app_server_protocol::CommandExecutionApprovalDecision;
use codex_app_server_protocol::CommandExecutionRequestApprovalParams;
use codex_app_server_protocol::DynamicToolCallOutputContentItem;
use codex_app_server_protocol::DynamicToolCallParams;
use codex_app_server_protocol::FileChangeApprovalDecision;
use codex_app_server_protocol::FileChangeRequestApprovalParams;
use codex_app_server_protocol::ItemCompletedNotification;
use codex_app_server_protocol::ItemStartedNotification;
use codex_app_server_protocol::McpServerElicitationRequest;
use codex_app_server_protocol::McpServerElicitationRequestParams;
use codex_app_server_protocol::Model;
use codex_app_server_protocol::ModelAvailabilityNux;
use codex_app_server_protocol::ModelListResponse;
use codex_app_server_protocol::ModelUpgradeInfo;
use codex_app_server_protocol::NetworkApprovalContext;
use codex_app_server_protocol::NetworkApprovalProtocol;
use codex_app_server_protocol::PermissionsRequestApprovalParams;
use codex_app_server_protocol::PlanDeltaNotification;
use codex_app_server_protocol::ReasoningEffortOption;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::Thread;
use codex_app_server_protocol::ThreadReadResponse;
use codex_app_server_protocol::ThreadStartedNotification;
use codex_app_server_protocol::ThreadStatus;
use codex_app_server_protocol::ToolRequestUserInputOption;
use codex_app_server_protocol::ToolRequestUserInputParams;
use codex_app_server_protocol::ToolRequestUserInputQuestion;
use codex_app_server_protocol::ToolRequestUserInputResponse;
use codex_app_server_protocol::Turn;
use codex_app_server_protocol::TurnCompletedNotification;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStartResponse;
use codex_app_server_protocol::TurnStartedNotification;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::dynamic_tools::DynamicToolResponse;
use codex_protocol::items::TurnItem;
use codex_protocol::models::PermissionProfile;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelPreset;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ReviewDecision;
use codex_protocol::protocol::TurnAbortReason;
use codex_protocol::request_permissions::RequestPermissionsResponse;
use codex_protocol::request_user_input::RequestUserInputAnswer;
use codex_protocol::request_user_input::RequestUserInputResponse;

use crate::state::PendingServerRequest;
use crate::state::ThreadRecord;
use crate::state::TurnRecord;

pub fn initialize_user_agent() -> String {
    format!("codex-wasm-v2-browser/{}", env!("CARGO_PKG_VERSION"))
}

pub fn now_unix_seconds() -> i64 {
    codex_wasm_v2_core::time::now_unix_seconds()
}

pub fn build_thread(record: &ThreadRecord, include_turns: bool, status: ThreadStatus) -> Thread {
    Thread {
        id: record.id.clone(),
        preview: record.preview.clone(),
        ephemeral: record.ephemeral,
        model_provider: record.model_provider.clone(),
        created_at: record.created_at,
        updated_at: record.updated_at,
        status,
        path: None,
        cwd: record.cwd.clone(),
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        source: record.source.clone().into(),
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: record.name.clone(),
        turns: if include_turns {
            record
                .turns
                .values()
                .cloned()
                .map(turn_to_protocol)
                .collect()
        } else {
            Vec::new()
        },
    }
}

pub fn thread_started_notification(
    record: &ThreadRecord,
    status: ThreadStatus,
) -> ServerNotification {
    ServerNotification::ThreadStarted(ThreadStartedNotification {
        thread: build_thread(record, false, status),
    })
}

pub fn turn_started_notification(thread_id: &str, turn_id: &str) -> ServerNotification {
    ServerNotification::TurnStarted(TurnStartedNotification {
        thread_id: thread_id.to_string(),
        turn: Turn {
            id: turn_id.to_string(),
            items: Vec::new(),
            status: TurnStatus::InProgress,
            error: None,
        },
    })
}

pub fn turn_completed_notification(thread_id: &str, turn: &TurnRecord) -> ServerNotification {
    ServerNotification::TurnCompleted(TurnCompletedNotification {
        thread_id: thread_id.to_string(),
        turn: Turn {
            id: turn.id.clone(),
            items: Vec::new(),
            status: turn.status.clone(),
            error: turn.error.clone(),
        },
    })
}

pub fn item_started_notification(
    thread_id: &str,
    turn_id: &str,
    item: TurnItem,
) -> ServerNotification {
    ServerNotification::ItemStarted(ItemStartedNotification {
        thread_id: thread_id.to_string(),
        turn_id: turn_id.to_string(),
        item: item.into(),
    })
}

pub fn item_completed_notification(
    thread_id: &str,
    turn_id: &str,
    item: TurnItem,
) -> ServerNotification {
    ServerNotification::ItemCompleted(ItemCompletedNotification {
        thread_id: thread_id.to_string(),
        turn_id: turn_id.to_string(),
        item: item.into(),
    })
}

pub fn delta_notification(event: &EventMsg) -> Option<ServerNotification> {
    match event {
        EventMsg::AgentMessageContentDelta(event) => Some(ServerNotification::AgentMessageDelta(
            AgentMessageDeltaNotification {
                thread_id: event.thread_id.clone(),
                turn_id: event.turn_id.clone(),
                item_id: event.item_id.clone(),
                delta: event.delta.clone(),
            },
        )),
        EventMsg::PlanDelta(event) => Some(ServerNotification::PlanDelta(PlanDeltaNotification {
            thread_id: event.thread_id.clone(),
            turn_id: event.turn_id.clone(),
            item_id: event.item_id.clone(),
            delta: event.delta.clone(),
        })),
        _ => None,
    }
}

pub fn map_server_request(
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
                    NetworkApprovalContext {
                        host: context.host.clone(),
                        protocol: match context.protocol {
                            codex_protocol::approvals::NetworkApprovalProtocol::Http => {
                                NetworkApprovalProtocol::Http
                            }
                            codex_protocol::approvals::NetworkApprovalProtocol::Https => {
                                NetworkApprovalProtocol::Https
                            }
                            codex_protocol::approvals::NetworkApprovalProtocol::Socks5Tcp => {
                                NetworkApprovalProtocol::Socks5Tcp
                            }
                            codex_protocol::approvals::NetworkApprovalProtocol::Socks5Udp => {
                                NetworkApprovalProtocol::Socks5Udp
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
                        .map(CommandExecutionApprovalDecision::from)
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
                params: FileChangeRequestApprovalParams {
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

pub fn request_resolved_notification(
    thread_id: String,
    request_id: codex_app_server_protocol::RequestId,
) -> ServerNotification {
    ServerNotification::ServerRequestResolved(
        codex_app_server_protocol::ServerRequestResolvedNotification {
            thread_id,
            request_id,
        },
    )
}

pub fn map_model_list(models: Vec<ModelInfo>, include_hidden: bool) -> ModelListResponse {
    let mut presets = models
        .into_iter()
        .map(ModelPreset::from)
        .collect::<Vec<_>>();
    ModelPreset::mark_default_by_picker_visibility(&mut presets);
    let data = presets
        .into_iter()
        .filter(|preset| include_hidden || preset.show_in_picker)
        .map(|preset| Model {
            id: preset.id.clone(),
            model: preset.model.clone(),
            upgrade: preset.upgrade.as_ref().map(|upgrade| upgrade.id.clone()),
            upgrade_info: preset.upgrade.map(|upgrade| ModelUpgradeInfo {
                model: upgrade.id,
                upgrade_copy: upgrade.upgrade_copy,
                model_link: upgrade.model_link,
                migration_markdown: upgrade.migration_markdown,
            }),
            availability_nux: preset.availability_nux.map(|nux| ModelAvailabilityNux {
                message: nux.message,
            }),
            display_name: preset.display_name,
            description: preset.description,
            hidden: !preset.show_in_picker,
            supported_reasoning_efforts: preset
                .supported_reasoning_efforts
                .into_iter()
                .map(|effort| ReasoningEffortOption {
                    reasoning_effort: effort.effort,
                    description: effort.description,
                })
                .collect(),
            default_reasoning_effort: preset.default_reasoning_effort,
            input_modalities: preset.input_modalities,
            supports_personality: preset.supports_personality,
            is_default: preset.is_default,
        })
        .collect();
    ModelListResponse {
        data,
        next_cursor: None,
    }
}

pub fn map_apps_list(apps: Vec<AppInfo>) -> AppsListResponse {
    AppsListResponse {
        data: apps,
        next_cursor: None,
    }
}

pub fn turn_start_response(turn_id: String) -> TurnStartResponse {
    TurnStartResponse {
        turn: Turn {
            id: turn_id,
            items: Vec::new(),
            status: TurnStatus::InProgress,
            error: None,
        },
    }
}

pub fn thread_read_response(
    record: &ThreadRecord,
    status: ThreadStatus,
    include_turns: bool,
) -> ThreadReadResponse {
    ThreadReadResponse {
        thread: build_thread(record, include_turns, status),
    }
}

pub fn turn_to_protocol(turn: TurnRecord) -> Turn {
    Turn {
        id: turn.id,
        items: turn.items,
        status: turn.status,
        error: turn.error,
    }
}

pub fn update_item_with_delta(turn: &mut TurnRecord, item_id: &str, delta: &str, is_plan: bool) {
    if let Some(item) = turn.items.iter_mut().find(|item| item.id() == item_id) {
        match item {
            codex_app_server_protocol::ThreadItem::AgentMessage { text, .. } if !is_plan => {
                text.push_str(delta);
            }
            codex_app_server_protocol::ThreadItem::Plan { text, .. } if is_plan => {
                text.push_str(delta);
            }
            _ => {}
        }
    }
}

pub fn apply_item_started(turn: &mut TurnRecord, item: TurnItem) {
    let thread_item: codex_app_server_protocol::ThreadItem = item.into();
    if turn
        .items
        .iter()
        .all(|entry| entry.id() != thread_item.id())
    {
        turn.items.push(thread_item);
    }
}

pub fn apply_item_completed(turn: &mut TurnRecord, item: TurnItem) {
    let thread_item: codex_app_server_protocol::ThreadItem = item.into();
    if let Some(existing) = turn
        .items
        .iter_mut()
        .find(|entry| entry.id() == thread_item.id())
    {
        *existing = thread_item;
    } else {
        turn.items.push(thread_item);
    }
}

pub fn abort_reason_to_turn_status(reason: &TurnAbortReason) -> TurnStatus {
    match reason {
        TurnAbortReason::Interrupted | TurnAbortReason::Replaced | TurnAbortReason::ReviewEnded => {
            TurnStatus::Interrupted
        }
    }
}

pub fn default_turn_error(message: String) -> TurnError {
    TurnError {
        message,
        codex_error_info: None,
        additional_details: None,
    }
}

pub fn exec_decision_to_core(decision: CommandExecutionApprovalDecision) -> ReviewDecision {
    match decision {
        CommandExecutionApprovalDecision::Accept => ReviewDecision::Approved,
        CommandExecutionApprovalDecision::AcceptForSession => ReviewDecision::ApprovedForSession,
        CommandExecutionApprovalDecision::AcceptWithExecpolicyAmendment {
            execpolicy_amendment,
        } => ReviewDecision::ApprovedExecpolicyAmendment {
            proposed_execpolicy_amendment: execpolicy_amendment.into_core(),
        },
        CommandExecutionApprovalDecision::ApplyNetworkPolicyAmendment {
            network_policy_amendment,
        } => ReviewDecision::NetworkPolicyAmendment {
            network_policy_amendment: network_policy_amendment.into_core(),
        },
        CommandExecutionApprovalDecision::Decline => ReviewDecision::Denied,
        CommandExecutionApprovalDecision::Cancel => ReviewDecision::Abort,
    }
}

pub fn file_change_decision_to_core(decision: FileChangeApprovalDecision) -> ReviewDecision {
    match decision {
        FileChangeApprovalDecision::Accept => ReviewDecision::Approved,
        FileChangeApprovalDecision::AcceptForSession => ReviewDecision::ApprovedForSession,
        FileChangeApprovalDecision::Decline => ReviewDecision::Denied,
        FileChangeApprovalDecision::Cancel => ReviewDecision::Abort,
    }
}

pub fn fallback_request_permissions_response() -> RequestPermissionsResponse {
    RequestPermissionsResponse {
        permissions: PermissionProfile::default(),
        scope: codex_protocol::request_permissions::PermissionGrantScope::Turn,
    }
}

pub fn fallback_user_input_response() -> RequestUserInputResponse {
    RequestUserInputResponse {
        answers: HashMap::new(),
    }
}

pub fn fallback_dynamic_tool_response() -> DynamicToolResponse {
    DynamicToolResponse {
        content_items: Vec::new(),
        success: false,
    }
}

pub fn tool_request_user_input_response_to_core(
    response: ToolRequestUserInputResponse,
) -> RequestUserInputResponse {
    RequestUserInputResponse {
        answers: response
            .answers
            .into_iter()
            .map(|(id, answer)| {
                (
                    id,
                    RequestUserInputAnswer {
                        answers: answer.answers,
                    },
                )
            })
            .collect(),
    }
}

pub fn permissions_request_args_from_response(
    response: codex_app_server_protocol::PermissionsRequestApprovalResponse,
) -> RequestPermissionsResponse {
    RequestPermissionsResponse {
        permissions: response.permissions.into(),
        scope: response.scope.to_core(),
    }
}

pub fn dynamic_tool_response_to_core(
    response: codex_app_server_protocol::DynamicToolCallResponse,
) -> DynamicToolResponse {
    DynamicToolResponse {
        content_items: response
            .content_items
            .into_iter()
            .map(|item| match item {
                DynamicToolCallOutputContentItem::InputText { text } => {
                    codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputText {
                        text,
                    }
                }
                DynamicToolCallOutputContentItem::InputImage { image_url } => {
                    codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputImage {
                        image_url,
                    }
                }
            })
            .collect(),
        success: response.success,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::collections::HashMap;
    use std::path::PathBuf;

    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::ThreadStatus;
    use codex_protocol::protocol::SessionSource;
    use pretty_assertions::assert_eq;

    use super::build_thread;
    use super::request_resolved_notification;
    use super::tool_request_user_input_response_to_core;
    use crate::state::ThreadRecord;

    #[test]
    fn tool_request_user_input_response_maps_to_core_shape() {
        let response = codex_app_server_protocol::ToolRequestUserInputResponse {
            answers: HashMap::from([(
                "api_key".to_string(),
                codex_app_server_protocol::ToolRequestUserInputAnswer {
                    answers: vec!["secret".to_string()],
                },
            )]),
        };

        let actual = tool_request_user_input_response_to_core(response);
        let expected = codex_protocol::request_user_input::RequestUserInputResponse {
            answers: HashMap::from([(
                "api_key".to_string(),
                codex_protocol::request_user_input::RequestUserInputAnswer {
                    answers: vec!["secret".to_string()],
                },
            )]),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn build_thread_converts_core_session_source() {
        let thread = build_thread(
            &ThreadRecord {
                id: "thread-1".to_string(),
                preview: "hello".to_string(),
                ephemeral: false,
                model_provider: "openai".to_string(),
                cwd: PathBuf::from("/workspace"),
                source: SessionSource::Unknown,
                name: None,
                created_at: 10,
                updated_at: 11,
                turns: BTreeMap::new(),
                active_turn_id: None,
                waiting_on_approval: false,
                waiting_on_user_input: false,
            },
            false,
            ThreadStatus::Idle,
        );

        assert_eq!(
            thread.source,
            codex_app_server_protocol::SessionSource::Unknown
        );
    }

    #[test]
    fn request_resolved_notification_preserves_request_id() {
        let notification =
            request_resolved_notification("thread-1".to_string(), RequestId::Integer(7));

        match notification {
            codex_app_server_protocol::ServerNotification::ServerRequestResolved(payload) => {
                assert_eq!(
                    payload,
                    codex_app_server_protocol::ServerRequestResolvedNotification {
                        thread_id: "thread-1".to_string(),
                        request_id: RequestId::Integer(7),
                    }
                );
            }
            other => panic!("unexpected notification: {other:?}"),
        }
    }
}
