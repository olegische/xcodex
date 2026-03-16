use super::*;

use crate::codex::Session;
use crate::codex::SessionSettingsUpdate;
use crate::codex::SteerInputError;
use crate::codex::spawn_review_thread;
use crate::config::Config;
use crate::context_manager::is_user_turn_boundary;
use crate::mcp::auth::compute_auth_statuses;
use crate::mcp::collect_mcp_snapshot_from_manager;
use crate::review_prompts::resolve_review_request;
use crate::rollout::session_index;
use crate::tasks::CompactTask;
use crate::tasks::UndoTask;
use crate::tasks::UserShellCommandMode;
use crate::tasks::UserShellCommandTask;
use crate::tasks::execute_user_shell_command;
use codex_protocol::config_types::CollaborationMode;
use codex_protocol::config_types::ModeKind;
use codex_protocol::config_types::Settings;
use codex_protocol::custom_prompts::CustomPrompt;
use codex_protocol::dynamic_tools::DynamicToolResponse;
use codex_protocol::mcp::RequestId as ProtocolRequestId;
use codex_protocol::protocol::CodexErrorInfo;
use codex_protocol::protocol::ErrorEvent;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ListCustomPromptsResponseEvent;
use codex_protocol::protocol::ListRemoteSkillsResponseEvent;
use codex_protocol::protocol::ListSkillsResponseEvent;
use codex_protocol::protocol::McpServerRefreshConfig;
use codex_protocol::protocol::Op;
use codex_protocol::protocol::RemoteSkillDownloadedEvent;
use codex_protocol::protocol::RemoteSkillHazelnutScope;
use codex_protocol::protocol::RemoteSkillProductSurface;
use codex_protocol::protocol::RemoteSkillSummary;
use codex_protocol::protocol::ReviewDecision;
use codex_protocol::protocol::ReviewRequest;
use codex_protocol::protocol::RolloutItem;
use codex_protocol::protocol::SkillsListEntry;
use codex_protocol::protocol::ThreadNameUpdatedEvent;
use codex_protocol::protocol::ThreadRolledBackEvent;
use codex_protocol::protocol::TurnAbortReason;
use codex_protocol::protocol::WarningEvent;
use codex_protocol::request_permissions::RequestPermissionsResponse;
use codex_protocol::request_user_input::RequestUserInputResponse;
use codex_protocol::user_input::UserInput;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;
use tracing::warn;

use crate::compat::rmcp::ElicitationAction;
use crate::compat::rmcp::ElicitationResponse;
use crate::compat::rmcp::NumberOrString;
use crate::compat::task;
pub async fn interrupt(sess: &Arc<Session>) {
    sess.interrupt_task().await;
}

pub async fn clean_background_terminals(sess: &Arc<Session>) {
    sess.close_unified_exec_processes().await;
}

pub async fn override_turn_context(sess: &Session, sub_id: String, updates: SessionSettingsUpdate) {
    if let Err(err) = sess.update_settings(updates).await {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: err.to_string(),
                codex_error_info: Some(CodexErrorInfo::BadRequest),
            }),
        })
        .await;
    }
}

pub async fn user_input_or_turn(sess: &Arc<Session>, sub_id: String, op: Op) {
    let (items, updates) = match op {
        Op::UserTurn {
            cwd,
            approval_policy,
            sandbox_policy,
            model,
            effort,
            summary,
            service_tier,
            final_output_json_schema,
            items,
            collaboration_mode,
            personality,
        } => {
            let collaboration_mode = collaboration_mode.or_else(|| {
                Some(CollaborationMode {
                    mode: ModeKind::Default,
                    settings: Settings {
                        model: model.clone(),
                        reasoning_effort: effort,
                        developer_instructions: None,
                    },
                })
            });
            (
                items,
                SessionSettingsUpdate {
                    cwd: Some(cwd),
                    approval_policy: Some(approval_policy),
                    sandbox_policy: Some(sandbox_policy),
                    windows_sandbox_level: None,
                    collaboration_mode,
                    reasoning_summary: summary,
                    service_tier,
                    final_output_json_schema: Some(final_output_json_schema),
                    personality,
                    app_server_client_name: None,
                },
            )
        }
        Op::UserInput {
            items,
            final_output_json_schema,
        } => (
            items,
            SessionSettingsUpdate {
                final_output_json_schema: Some(final_output_json_schema),
                ..Default::default()
            },
        ),
        _ => unreachable!(),
    };

    let Ok(current_context) = sess.new_turn_with_sub_id(sub_id, updates).await else {
        return;
    };
    sess.maybe_emit_unknown_model_warning_for_turn(current_context.as_ref())
        .await;
    current_context.session_telemetry.user_prompt(&items);

    if let Err(SteerInputError::NoActiveTurn(items)) = sess.steer_input(items, None).await {
        sess.refresh_mcp_servers_if_requested(&current_context)
            .await;
        let regular_task = sess.take_startup_regular_task().await.unwrap_or_default();
        sess.spawn_task(Arc::clone(&current_context), items, regular_task)
            .await;
    }
}

pub async fn run_user_shell_command(sess: &Arc<Session>, sub_id: String, command: String) {
    if let Some((turn_context, cancellation_token)) =
        sess.active_turn_context_and_cancellation_token().await
    {
        let session = Arc::clone(sess);
        task::spawn_detached(async move {
            execute_user_shell_command(
                session,
                turn_context,
                command,
                cancellation_token,
                UserShellCommandMode::ActiveTurnAuxiliary,
            )
            .await;
        });
        return;
    }

    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;
    sess.spawn_task(
        Arc::clone(&turn_context),
        Vec::new(),
        UserShellCommandTask::new(command),
    )
    .await;
}

pub async fn resolve_elicitation(
    sess: &Arc<Session>,
    server_name: String,
    request_id: ProtocolRequestId,
    decision: codex_protocol::approvals::ElicitationAction,
    content: Option<Value>,
    meta: Option<Value>,
) {
    let action = match decision {
        codex_protocol::approvals::ElicitationAction::Accept => ElicitationAction::Accept,
        codex_protocol::approvals::ElicitationAction::Decline => ElicitationAction::Decline,
        codex_protocol::approvals::ElicitationAction::Cancel => ElicitationAction::Cancel,
    };
    let content = match action {
        ElicitationAction::Accept => Some(content.unwrap_or_else(|| serde_json::json!({}))),
        ElicitationAction::Decline | ElicitationAction::Cancel => None,
    };
    let response = ElicitationResponse {
        action,
        content,
        meta,
    };
    let request_id = match request_id {
        ProtocolRequestId::String(value) => NumberOrString::String(value.into()),
        ProtocolRequestId::Integer(value) => NumberOrString::Number(value),
    };
    if let Err(err) = sess
        .resolve_elicitation(server_name, request_id, response)
        .await
    {
        warn!(
            error = %err,
            "failed to resolve elicitation request in session"
        );
    }
}

pub async fn exec_approval(
    sess: &Arc<Session>,
    approval_id: String,
    turn_id: Option<String>,
    decision: ReviewDecision,
) {
    let event_turn_id = turn_id.unwrap_or_else(|| approval_id.clone());
    if let ReviewDecision::ApprovedExecpolicyAmendment {
        proposed_execpolicy_amendment,
    } = &decision
    {
        match sess
            .persist_execpolicy_amendment(proposed_execpolicy_amendment)
            .await
        {
            Ok(()) => {
                sess.record_execpolicy_amendment_message(
                    &event_turn_id,
                    proposed_execpolicy_amendment,
                )
                .await;
            }
            Err(err) => {
                let message = format!("Failed to apply execpolicy amendment: {err}");
                tracing::warn!("{message}");
                let warning = EventMsg::Warning(WarningEvent { message });
                sess.send_event_raw(Event {
                    id: event_turn_id.clone(),
                    msg: warning,
                })
                .await;
            }
        }
    }
    match decision {
        ReviewDecision::Abort => {
            sess.interrupt_task().await;
        }
        other => sess.notify_approval(&approval_id, other).await,
    }
}

pub async fn patch_approval(sess: &Arc<Session>, id: String, decision: ReviewDecision) {
    match decision {
        ReviewDecision::Abort => {
            sess.interrupt_task().await;
        }
        other => sess.notify_approval(&id, other).await,
    }
}

pub async fn request_user_input_response(
    sess: &Arc<Session>,
    id: String,
    response: RequestUserInputResponse,
) {
    sess.notify_user_input_response(&id, response).await;
}

pub async fn request_permissions_response(
    sess: &Arc<Session>,
    id: String,
    response: RequestPermissionsResponse,
) {
    sess.notify_request_permissions_response(&id, response)
        .await;
}

pub async fn dynamic_tool_response(sess: &Arc<Session>, id: String, response: DynamicToolResponse) {
    sess.notify_dynamic_tool_response(&id, response).await;
}

pub async fn add_to_history(sess: &Arc<Session>, config: &Arc<Config>, text: String) {
    let id = sess.conversation_id;
    let config = Arc::clone(config);
    task::spawn_detached(async move {
        if let Err(e) = crate::message_history::append_entry(&text, &id, &config).await {
            warn!("failed to append to message history: {e}");
        }
    });
}

pub async fn get_history_entry_request(
    sess: &Arc<Session>,
    config: &Arc<Config>,
    sub_id: String,
    offset: usize,
    log_id: u64,
) {
    let config = Arc::clone(config);
    let sess_clone = Arc::clone(sess);

    task::spawn_detached(async move {
        let entries = crate::message_history::lookup(&log_id.to_string(), offset as i64, &config)
            .await
            .unwrap_or_default();
        let entry_opt = entries.into_iter().next();

        let event = Event {
            id: sub_id,
            msg: EventMsg::GetHistoryEntryResponse(crate::protocol::GetHistoryEntryResponseEvent {
                offset,
                log_id,
                entry: entry_opt,
            }),
        };

        sess_clone.send_event_raw(event).await;
    });
}

pub async fn refresh_mcp_servers(sess: &Arc<Session>, refresh_config: McpServerRefreshConfig) {
    let mut guard = sess.pending_mcp_server_refresh_config.lock().await;
    *guard = Some(refresh_config);
}

pub async fn reload_user_config(sess: &Arc<Session>) {
    sess.reload_user_config_layer().await;
}

pub async fn list_mcp_tools(sess: &Session, config: &Arc<Config>, sub_id: String) {
    let mcp_connection_manager = sess.services.mcp_connection_manager.read().await;
    let auth = sess.services.auth_manager.auth().await;
    let mcp_servers = sess
        .services
        .mcp_manager
        .effective_servers(config, auth.as_ref());
    let snapshot = collect_mcp_snapshot_from_manager(
        &mcp_connection_manager,
        compute_auth_statuses(mcp_servers.iter(), config.mcp_oauth_credentials_store_mode).await,
    )
    .await;
    let event = Event {
        id: sub_id,
        msg: EventMsg::McpListToolsResponse(snapshot),
    };
    sess.send_event_raw(event).await;
}

pub async fn list_custom_prompts(sess: &Session, sub_id: String) {
    let custom_prompts: Vec<CustomPrompt> =
        if let Some(dir) = crate::custom_prompts::default_prompts_dir() {
            crate::custom_prompts::discover_prompts_in(&dir).await
        } else {
            Vec::new()
        };

    let event = Event {
        id: sub_id,
        msg: EventMsg::ListCustomPromptsResponse(ListCustomPromptsResponseEvent { custom_prompts }),
    };
    sess.send_event_raw(event).await;
}

pub async fn list_skills(sess: &Session, sub_id: String, cwds: Vec<PathBuf>, force_reload: bool) {
    let cwds = if cwds.is_empty() {
        let state = sess.state.lock().await;
        vec![state.session_configuration.cwd.clone()]
    } else {
        cwds
    };

    let skills_manager = &sess.services.skills_manager;
    let mut skills = Vec::new();
    for cwd in cwds {
        let outcome = skills_manager.skills_for_cwd(&cwd, force_reload).await;
        let errors = super::errors_to_info(&outcome.errors);
        let skills_metadata = super::skills_to_info(&outcome.skills, &outcome.disabled_paths);
        skills.push(SkillsListEntry {
            cwd,
            skills: skills_metadata,
            errors,
        });
    }

    let event = Event {
        id: sub_id,
        msg: EventMsg::ListSkillsResponse(ListSkillsResponseEvent { skills }),
    };
    sess.send_event_raw(event).await;
}

pub async fn list_remote_skills(
    sess: &Session,
    config: &Arc<Config>,
    sub_id: String,
    hazelnut_scope: RemoteSkillHazelnutScope,
    product_surface: RemoteSkillProductSurface,
    enabled: Option<bool>,
) {
    let auth = sess.services.auth_manager.auth().await;
    let response = crate::skills::remote::list_remote_skills(
        config,
        auth.as_ref(),
        hazelnut_scope,
        product_surface,
        enabled,
    )
    .await
    .map(|skills| {
        skills
            .into_iter()
            .map(|skill| RemoteSkillSummary {
                id: skill.id,
                name: skill.name,
                description: skill.description,
            })
            .collect::<Vec<_>>()
    });

    match response {
        Ok(skills) => {
            let event = Event {
                id: sub_id,
                msg: EventMsg::ListRemoteSkillsResponse(ListRemoteSkillsResponseEvent { skills }),
            };
            sess.send_event_raw(event).await;
        }
        Err(err) => {
            let event = Event {
                id: sub_id,
                msg: EventMsg::Error(ErrorEvent {
                    message: format!("failed to list remote skills: {err}"),
                    codex_error_info: Some(CodexErrorInfo::Other),
                }),
            };
            sess.send_event_raw(event).await;
        }
    }
}

pub async fn export_remote_skill(
    sess: &Session,
    config: &Arc<Config>,
    sub_id: String,
    hazelnut_id: String,
) {
    let auth = sess.services.auth_manager.auth().await;
    match crate::skills::remote::export_remote_skill(config, auth.as_ref(), hazelnut_id.as_str())
        .await
    {
        Ok(result) => {
            let id = result.id;
            let event = Event {
                id: sub_id,
                msg: EventMsg::RemoteSkillDownloaded(RemoteSkillDownloadedEvent {
                    id: id.clone(),
                    name: id,
                    path: result.path,
                }),
            };
            sess.send_event_raw(event).await;
        }
        Err(err) => {
            let event = Event {
                id: sub_id,
                msg: EventMsg::Error(ErrorEvent {
                    message: format!("failed to export remote skill {hazelnut_id}: {err}"),
                    codex_error_info: Some(CodexErrorInfo::Other),
                }),
            };
            sess.send_event_raw(event).await;
        }
    }
}

pub async fn undo(sess: &Arc<Session>, sub_id: String) {
    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;
    sess.spawn_task(turn_context, Vec::new(), UndoTask::new())
        .await;
}

pub async fn compact(sess: &Arc<Session>, sub_id: String) {
    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;

    sess.spawn_task(
        Arc::clone(&turn_context),
        vec![UserInput::Text {
            text: turn_context.compact_prompt().to_string(),
            text_elements: Vec::new(),
        }],
        CompactTask,
    )
    .await;
}

pub async fn drop_memories(sess: &Arc<Session>, config: &Arc<Config>, sub_id: String) {
    let mut errors = Vec::new();

    if let Some(state_db) = sess.services.state_db.as_ref() {
        if let Err(err) = state_db.clear_memory_data().await {
            errors.push(format!("failed clearing memory rows from state db: {err}"));
        }
    } else {
        errors.push("state db unavailable; memory rows were not cleared".to_string());
    }

    let memory_root = crate::memories::memory_root(&config.codex_home);
    if let Err(err) = crate::memories::clear_memory_root_contents(&memory_root).await {
        errors.push(format!(
            "failed clearing memory directory {}: {err}",
            memory_root.display()
        ));
    }

    if errors.is_empty() {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Warning(WarningEvent {
                message: format!(
                    "Dropped memories at {} and cleared memory rows from state db.",
                    memory_root.display()
                ),
            }),
        })
        .await;
        return;
    }

    sess.send_event_raw(Event {
        id: sub_id,
        msg: EventMsg::Error(ErrorEvent {
            message: format!("Memory drop completed with errors: {}", errors.join("; ")),
            codex_error_info: Some(CodexErrorInfo::Other),
        }),
    })
    .await;
}

pub async fn update_memories(sess: &Arc<Session>, config: &Arc<Config>, sub_id: String) {
    let session_source = {
        let state = sess.state.lock().await;
        state.session_configuration.session_source.clone()
    };

    crate::memories::start_memories_startup_task(sess, Arc::clone(config), &session_source);

    sess.send_event_raw(Event {
        id: sub_id.clone(),
        msg: EventMsg::Warning(WarningEvent {
            message: "Memory update triggered.".to_string(),
        }),
    })
    .await;
}

pub async fn thread_rollback(sess: &Arc<Session>, sub_id: String, num_turns: u32) {
    if num_turns == 0 {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "num_turns must be >= 1".to_string(),
                codex_error_info: Some(CodexErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    let has_active_turn = { sess.active_turn.lock().await.is_some() };
    if has_active_turn {
        sess.send_event_raw(Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "Cannot rollback while a turn is in progress.".to_string(),
                codex_error_info: Some(CodexErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    let turn_context = sess.new_default_turn_with_sub_id(sub_id).await;
    let recorder = {
        let guard = sess.services.rollout.lock().await;
        guard.clone()
    };
    let Some(recorder) = recorder else {
        sess.send_event_raw(Event {
            id: turn_context.sub_id.clone(),
            msg: EventMsg::Error(ErrorEvent {
                message: "thread rollback requires a persisted rollout path".to_string(),
                codex_error_info: Some(CodexErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    };
    let rollout_path = {
        let Some(path) = Some(recorder.rollout_path().to_path_buf()) else {
            sess.send_event_raw(Event {
                id: turn_context.sub_id.clone(),
                msg: EventMsg::Error(ErrorEvent {
                    message: "thread rollback requires a persisted rollout path".to_string(),
                    codex_error_info: Some(CodexErrorInfo::ThreadRollbackFailed),
                }),
            })
            .await;
            return;
        };
        path
    };
    if let Err(err) = recorder.flush().await {
        sess.send_event_raw(Event {
            id: turn_context.sub_id.clone(),
            msg: EventMsg::Error(ErrorEvent {
                message: format!(
                    "failed to flush rollout `{}` for rollback replay: {err}",
                    rollout_path.display()
                ),
                codex_error_info: Some(CodexErrorInfo::ThreadRollbackFailed),
            }),
        })
        .await;
        return;
    }

    let initial_history = match recorder.load_history().await {
        Ok(history) => history,
        Err(err) => {
            sess.send_event_raw(Event {
                id: turn_context.sub_id.clone(),
                msg: EventMsg::Error(ErrorEvent {
                    message: format!(
                        "failed to load rollout `{}` for rollback replay: {err}",
                        rollout_path.display()
                    ),
                    codex_error_info: Some(CodexErrorInfo::ThreadRollbackFailed),
                }),
            })
            .await;
            return;
        }
    };

    let rollback_event = ThreadRolledBackEvent { num_turns };
    let replay_items = initial_history
        .get_rollout_items()
        .into_iter()
        .chain(std::iter::once(RolloutItem::EventMsg(
            EventMsg::ThreadRolledBack(rollback_event.clone()),
        )))
        .collect::<Vec<_>>();

    let reconstructed = sess
        .reconstruct_history_from_rollout(turn_context.as_ref(), replay_items.as_slice())
        .await;
    sess.replace_history(
        reconstructed.history,
        reconstructed.reference_context_item.clone(),
    )
    .await;
    sess.set_previous_turn_settings(reconstructed.previous_turn_settings)
        .await;
    sess.recompute_token_usage(turn_context.as_ref()).await;

    sess.send_event_raw_flushed(Event {
        id: turn_context.sub_id.clone(),
        msg: EventMsg::ThreadRolledBack(rollback_event),
    })
    .await;
}

pub async fn set_thread_name(sess: &Arc<Session>, sub_id: String, name: String) {
    let Some(name) = crate::util::normalize_thread_name(&name) else {
        let event = Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "Thread name cannot be empty.".to_string(),
                codex_error_info: Some(CodexErrorInfo::BadRequest),
            }),
        };
        sess.send_event_raw(event).await;
        return;
    };

    let persistence_enabled = {
        let rollout = sess.services.rollout.lock().await;
        rollout.is_some()
    };
    if !persistence_enabled {
        let event = Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: "Session persistence is disabled; cannot rename thread.".to_string(),
                codex_error_info: Some(CodexErrorInfo::Other),
            }),
        };
        sess.send_event_raw(event).await;
        return;
    };

    let codex_home = sess.codex_home().await;
    if let Err(e) =
        session_index::append_thread_name(&codex_home, sess.conversation_id, &name).await
    {
        let event = Event {
            id: sub_id,
            msg: EventMsg::Error(ErrorEvent {
                message: format!("Failed to set thread name: {e}"),
                codex_error_info: Some(CodexErrorInfo::Other),
            }),
        };
        sess.send_event_raw(event).await;
        return;
    }

    {
        let mut state = sess.state.lock().await;
        state.session_configuration.thread_name = Some(name.clone());
    }

    let rollout = {
        let services = &sess.services;
        services.rollout.lock().await.clone()
    };
    if let Some(rollout) = rollout {
        rollout.set_thread_name(Some(name.clone())).await;
    }

    sess.send_event_raw(Event {
        id: sub_id,
        msg: EventMsg::ThreadNameUpdated(ThreadNameUpdatedEvent {
            thread_id: sess.conversation_id,
            thread_name: Some(name),
        }),
    })
    .await;
}

pub async fn shutdown(sess: &Arc<Session>, sub_id: String) -> bool {
    sess.abort_all_tasks(TurnAbortReason::Interrupted).await;
    let _ = sess.conversation.shutdown().await;
    sess.services
        .unified_exec_manager
        .terminate_all_processes()
        .await;
    info!("Shutting down Codex instance");
    let history = sess.clone_history().await;
    let turn_count = history
        .raw_items()
        .iter()
        .filter(|item| is_user_turn_boundary(item))
        .count();
    sess.services.session_telemetry.counter(
        "codex.conversation.turn.count",
        i64::try_from(turn_count).unwrap_or(0),
        &[],
    );

    let recorder_opt = {
        let mut guard = sess.services.rollout.lock().await;
        guard.take()
    };
    if let Some(rec) = recorder_opt
        && let Err(e) = rec.shutdown().await
    {
        warn!("failed to shutdown rollout recorder: {e}");
        let event = Event {
            id: sub_id.clone(),
            msg: EventMsg::Error(ErrorEvent {
                message: "Failed to shutdown rollout recorder".to_string(),
                codex_error_info: Some(CodexErrorInfo::Other),
            }),
        };
        sess.send_event_raw(event).await;
    }

    let event = Event {
        id: sub_id,
        msg: EventMsg::ShutdownComplete,
    };
    sess.send_event_raw(event).await;
    true
}

pub async fn review(
    sess: &Arc<Session>,
    config: &Arc<Config>,
    sub_id: String,
    review_request: ReviewRequest,
) {
    let turn_context = sess.new_default_turn_with_sub_id(sub_id.clone()).await;
    sess.maybe_emit_unknown_model_warning_for_turn(turn_context.as_ref())
        .await;
    sess.refresh_mcp_servers_if_requested(&turn_context).await;
    match resolve_review_request(review_request, turn_context.cwd.as_path()) {
        Ok(resolved) => {
            spawn_review_thread(
                Arc::clone(sess),
                Arc::clone(config),
                turn_context.clone(),
                sub_id,
                resolved,
            )
            .await;
        }
        Err(err) => {
            let event = Event {
                id: sub_id,
                msg: EventMsg::Error(ErrorEvent {
                    message: err.to_string(),
                    codex_error_info: Some(CodexErrorInfo::Other),
                }),
            };
            sess.send_event(&turn_context, event.msg).await;
        }
    }
}
