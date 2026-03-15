use codex_app_server_protocol::CommandExecutionApprovalDecision;
use codex_app_server_protocol::DynamicToolCallOutputContentItem;
use codex_app_server_protocol::FileChangeApprovalDecision;
use codex_app_server_protocol::McpServerElicitationAction;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ServerRequest;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::dynamic_tools::DynamicToolResponse;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::ReviewDecision;
use codex_protocol::request_permissions::PermissionGrantScope;
use codex_protocol::request_permissions::RequestPermissionsResponse;
use codex_protocol::request_user_input::RequestUserInputAnswer;
use codex_protocol::request_user_input::RequestUserInputResponse;
use std::collections::HashMap;

use crate::MessageProcessor;

#[derive(Clone, Debug, PartialEq)]
pub struct InProcessTurnRecord {
    pub id: String,
    pub items: Vec<codex_app_server_protocol::ThreadItem>,
    pub status: TurnStatus,
    pub error: Option<TurnError>,
}

impl Default for InProcessTurnRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            items: Vec::new(),
            status: TurnStatus::InProgress,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct InProcessThreadHandle {
    pub active_turn_id: Option<String>,
    pub waiting_on_approval: bool,
    pub waiting_on_user_input: bool,
    pub turns: std::collections::BTreeMap<String, InProcessTurnRecord>,
}

pub enum PendingServerRequest {
    ExecApproval {
        thread_id: String,
        id: String,
        turn_id: String,
    },
    PatchApproval {
        thread_id: String,
        id: String,
    },
    UserInput {
        thread_id: String,
        id: String,
    },
    RequestPermissions {
        thread_id: String,
        id: String,
    },
    DynamicTool {
        thread_id: String,
        id: String,
    },
    Elicitation {
        thread_id: String,
        request_id: codex_protocol::mcp::RequestId,
        server_name: String,
    },
}

pub struct ResolvedServerRequest {
    pub thread_id: String,
    pub op: Op,
}

pub struct InProcessCoreEventEffect {
    pub notifications: Vec<ServerNotification>,
    pub server_requests: Vec<(RequestId, PendingServerRequest, ServerRequest)>,
}

pub fn apply_server_notification_to_thread(
    thread: &mut InProcessThreadHandle,
    notification: &ServerNotification,
) {
    match notification {
        ServerNotification::TurnStarted(payload) => {
            thread.active_turn_id = Some(payload.turn.id.clone());
            thread.turns.insert(
                payload.turn.id.clone(),
                InProcessTurnRecord {
                    id: payload.turn.id.clone(),
                    items: payload.turn.items.clone(),
                    status: payload.turn.status.clone(),
                    error: payload.turn.error.clone(),
                },
            );
        }
        ServerNotification::TurnCompleted(payload) => {
            if let Some(turn) = thread.turns.get_mut(&payload.turn.id) {
                turn.items = payload.turn.items.clone();
                turn.status = payload.turn.status.clone();
                turn.error = payload.turn.error.clone();
            } else {
                thread.turns.insert(
                    payload.turn.id.clone(),
                    InProcessTurnRecord {
                        id: payload.turn.id.clone(),
                        items: payload.turn.items.clone(),
                        status: payload.turn.status.clone(),
                        error: payload.turn.error.clone(),
                    },
                );
            }
            thread.active_turn_id = None;
            thread.waiting_on_approval = false;
            thread.waiting_on_user_input = false;
        }
        ServerNotification::ItemStarted(payload) => {
            if let Some(turn) = thread.turns.get_mut(&payload.turn_id)
                && turn
                    .items
                    .iter()
                    .all(|entry| entry.id() != payload.item.id())
            {
                turn.items.push(payload.item.clone());
            }
        }
        ServerNotification::ItemCompleted(payload) => {
            if let Some(turn) = thread.turns.get_mut(&payload.turn_id) {
                if let Some(existing) = turn
                    .items
                    .iter_mut()
                    .find(|entry| entry.id() == payload.item.id())
                {
                    *existing = payload.item.clone();
                } else {
                    turn.items.push(payload.item.clone());
                }
            }
        }
        _ => {}
    }
}

pub fn process_core_event(
    message_processor: &mut MessageProcessor,
    thread_id: &str,
    thread: &mut InProcessThreadHandle,
    next_request_id: Option<RequestId>,
    event: &Event,
) -> InProcessCoreEventEffect {
    let effect = message_processor.process_core_event(thread_id, next_request_id, event);
    for notification in &effect.notifications {
        apply_server_notification_to_thread(thread, notification);
    }
    if effect.waiting_on_approval {
        thread.waiting_on_approval = true;
    }
    if effect.waiting_on_user_input {
        thread.waiting_on_user_input = true;
    }
    InProcessCoreEventEffect {
        notifications: effect.notifications,
        server_requests: effect.server_requests,
    }
}

pub fn resolve_server_request(
    pending: PendingServerRequest,
    result: Result<serde_json::Value, String>,
) -> Result<ResolvedServerRequest, serde_json::Error> {
    match pending {
        PendingServerRequest::ExecApproval {
            thread_id,
            id,
            turn_id,
        } => {
            let decision = match result {
                Ok(value) => {
                    let response: codex_app_server_protocol::CommandExecutionRequestApprovalResponse =
                        serde_json::from_value(value)?;
                    exec_decision_to_core(response.decision)
                }
                Err(_) => ReviewDecision::Abort,
            };
            Ok(ResolvedServerRequest {
                thread_id,
                op: Op::ExecApproval {
                    id,
                    turn_id: Some(turn_id),
                    decision,
                },
            })
        }
        PendingServerRequest::PatchApproval { thread_id, id } => {
            let decision = match result {
                Ok(value) => {
                    let response: codex_app_server_protocol::FileChangeRequestApprovalResponse =
                        serde_json::from_value(value)?;
                    file_change_decision_to_core(response.decision)
                }
                Err(_) => ReviewDecision::Abort,
            };
            Ok(ResolvedServerRequest {
                thread_id,
                op: Op::PatchApproval { id, decision },
            })
        }
        PendingServerRequest::UserInput { thread_id, id } => {
            let response = match result {
                Ok(value) => {
                    let response: codex_app_server_protocol::ToolRequestUserInputResponse =
                        serde_json::from_value(value)?;
                    tool_request_user_input_response_to_core(response)
                }
                Err(_) => fallback_user_input_response(),
            };
            Ok(ResolvedServerRequest {
                thread_id,
                op: Op::UserInputAnswer { id, response },
            })
        }
        PendingServerRequest::RequestPermissions { thread_id, id } => {
            let response = match result {
                Ok(value) => {
                    let response: codex_app_server_protocol::PermissionsRequestApprovalResponse =
                        serde_json::from_value(value)?;
                    permissions_request_args_from_response(response)
                }
                Err(_) => fallback_request_permissions_response(),
            };
            Ok(ResolvedServerRequest {
                thread_id,
                op: Op::RequestPermissionsResponse { id, response },
            })
        }
        PendingServerRequest::DynamicTool { thread_id, id } => {
            let response = match result {
                Ok(value) => {
                    let response: codex_app_server_protocol::DynamicToolCallResponse =
                        serde_json::from_value(value)?;
                    dynamic_tool_response_to_core(response)
                }
                Err(_) => fallback_dynamic_tool_response(),
            };
            Ok(ResolvedServerRequest {
                thread_id,
                op: Op::DynamicToolResponse { id, response },
            })
        }
        PendingServerRequest::Elicitation {
            thread_id,
            request_id,
            server_name,
        } => {
            let response = match result {
                Ok(value) => serde_json::from_value::<
                    codex_app_server_protocol::McpServerElicitationRequestResponse,
                >(value)?,
                Err(_) => codex_app_server_protocol::McpServerElicitationRequestResponse {
                    action: McpServerElicitationAction::Cancel,
                    content: None,
                    meta: None,
                },
            };
            Ok(ResolvedServerRequest {
                thread_id,
                op: Op::ResolveElicitation {
                    server_name,
                    request_id,
                    decision: response.action.to_core(),
                    content: response.content,
                    meta: response.meta,
                },
            })
        }
    }
}

fn exec_decision_to_core(decision: CommandExecutionApprovalDecision) -> ReviewDecision {
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

fn file_change_decision_to_core(decision: FileChangeApprovalDecision) -> ReviewDecision {
    match decision {
        FileChangeApprovalDecision::Accept => ReviewDecision::Approved,
        FileChangeApprovalDecision::AcceptForSession => ReviewDecision::ApprovedForSession,
        FileChangeApprovalDecision::Decline => ReviewDecision::Denied,
        FileChangeApprovalDecision::Cancel => ReviewDecision::Abort,
    }
}

fn fallback_request_permissions_response() -> RequestPermissionsResponse {
    RequestPermissionsResponse {
        permissions: codex_protocol::models::PermissionProfile::default(),
        scope: PermissionGrantScope::Turn,
    }
}

fn fallback_user_input_response() -> RequestUserInputResponse {
    RequestUserInputResponse {
        answers: HashMap::new(),
    }
}

fn fallback_dynamic_tool_response() -> DynamicToolResponse {
    DynamicToolResponse {
        content_items: Vec::new(),
        success: false,
    }
}

fn tool_request_user_input_response_to_core(
    response: codex_app_server_protocol::ToolRequestUserInputResponse,
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

fn permissions_request_args_from_response(
    response: codex_app_server_protocol::PermissionsRequestApprovalResponse,
) -> RequestPermissionsResponse {
    RequestPermissionsResponse {
        permissions: response.permissions.into(),
        scope: response.scope.to_core(),
    }
}

fn dynamic_tool_response_to_core(
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
    use codex_app_server_protocol::ServerNotification;
    use codex_app_server_protocol::ThreadItem;
    use codex_app_server_protocol::Turn;
    use codex_app_server_protocol::TurnCompletedNotification;
    use codex_app_server_protocol::TurnStartedNotification;
    use codex_app_server_protocol::TurnStatus;
    use pretty_assertions::assert_eq;

    use super::InProcessThreadHandle;
    use super::InProcessTurnRecord;
    use super::apply_server_notification_to_thread;

    #[test]
    fn turn_started_creates_active_turn() {
        let mut thread = InProcessThreadHandle::default();

        apply_server_notification_to_thread(
            &mut thread,
            &ServerNotification::TurnStarted(TurnStartedNotification {
                thread_id: "thread-1".to_string(),
                turn: Turn {
                    id: "turn-1".to_string(),
                    items: Vec::new(),
                    error: None,
                    status: TurnStatus::InProgress,
                },
            }),
        );

        assert_eq!(thread.active_turn_id.as_deref(), Some("turn-1"));
        assert_eq!(
            thread.turns.get("turn-1"),
            Some(&InProcessTurnRecord {
                id: "turn-1".to_string(),
                items: Vec::new(),
                status: TurnStatus::InProgress,
                error: None,
            })
        );
    }

    #[test]
    fn turn_completed_replaces_turn_state() {
        let mut thread = InProcessThreadHandle {
            active_turn_id: Some("turn-1".to_string()),
            ..Default::default()
        };
        thread.turns.insert(
            "turn-1".to_string(),
            InProcessTurnRecord {
                id: "turn-1".to_string(),
                items: Vec::new(),
                status: TurnStatus::InProgress,
                error: None,
            },
        );

        apply_server_notification_to_thread(
            &mut thread,
            &ServerNotification::TurnCompleted(TurnCompletedNotification {
                thread_id: "thread-1".to_string(),
                turn: Turn {
                    id: "turn-1".to_string(),
                    items: vec![ThreadItem::Plan {
                        id: "plan-1".to_string(),
                        text: "done".to_string(),
                    }],
                    error: None,
                    status: TurnStatus::Completed,
                },
            }),
        );

        assert_eq!(thread.active_turn_id, None);
        assert_eq!(
            thread.turns.get("turn-1"),
            Some(&InProcessTurnRecord {
                id: "turn-1".to_string(),
                items: vec![ThreadItem::Plan {
                    id: "plan-1".to_string(),
                    text: "done".to_string(),
                }],
                status: TurnStatus::Completed,
                error: None,
            })
        );
    }
}
