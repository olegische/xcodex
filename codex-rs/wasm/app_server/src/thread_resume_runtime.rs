use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::ThreadResumeParams;
use codex_app_server_protocol::ThreadResumeResponse;
use codex_protocol::protocol::InitialHistory;
use codex_protocol::protocol::ResumedHistory;
use codex_protocol::protocol::RolloutItem;
use codex_protocol::protocol::SessionSource;
use codex_wasm_core::BrowserCodexSpawnArgs;
use codex_wasm_core::LoadThreadSessionRequest;
use codex_wasm_core::StoredThreadSession;
use codex_wasm_core::codex::Codex;
use codex_wasm_core::spawn_browser_codex;

use crate::AppServerState;
use crate::LoadedThread;
use crate::RuntimeBootstrap;
use crate::ThreadRecord;
use crate::TurnRecord;
use crate::models::build_thread;
use crate::runtime_bootstrap::resolve_model;

pub async fn resume_thread(
    app_server_state: &mut AppServerState,
    runtime_bootstrap: &RuntimeBootstrap,
    params: ThreadResumeParams,
) -> Result<ThreadResumeResponse, JSONRPCErrorError> {
    if let Some(response) = resume_running_thread(app_server_state, &params).await? {
        return Ok(response);
    }

    if params.history.is_some() {
        return Err(invalid_request_error(
            "thread/resume history override is not supported in wasm app-server yet".to_string(),
        ));
    }

    let stored = runtime_bootstrap
        .thread_storage_host
        .load_thread_session(LoadThreadSessionRequest {
            thread_id: params.thread_id.clone(),
        })
        .await
        .map_err(map_load_error(&params.thread_id))?
        .session;
    validate_requested_path(&params, &stored)?;

    let codex = Arc::new(spawn_resumed_thread(runtime_bootstrap, &stored, &params).await?);
    let snapshot = codex.thread_config_snapshot().await;
    let thread = build_thread_record(
        &stored,
        Arc::clone(&codex),
        snapshot.model_provider_id.clone(),
    );
    let response = ThreadResumeResponse {
        thread: build_thread(&thread.record, true, thread.record.protocol_status()),
        model: snapshot.model,
        model_provider: snapshot.model_provider_id,
        service_tier: snapshot.service_tier,
        cwd: snapshot.cwd,
        approval_policy: snapshot.approval_policy.into(),
        sandbox: snapshot.sandbox_policy.into(),
        reasoning_effort: snapshot.reasoning_effort,
    };
    app_server_state.upsert_loaded_thread(thread);
    Ok(response)
}

async fn resume_running_thread(
    app_server_state: &AppServerState,
    params: &ThreadResumeParams,
) -> Result<Option<ThreadResumeResponse>, JSONRPCErrorError> {
    let Some(codex) = app_server_state.running_thread(&params.thread_id) else {
        return Ok(None);
    };
    if params.history.is_some() {
        return Err(invalid_request_error(format!(
            "cannot resume thread {} with history while it is already running",
            params.thread_id
        )));
    }
    if params.path.is_some() {
        return Err(invalid_request_error(
            "thread/resume path override is not supported for running wasm threads".to_string(),
        ));
    }

    let thread = app_server_state.thread(&params.thread_id).ok_or_else(|| {
        invalid_request_error(format!(
            "no rollout found for thread id {}",
            params.thread_id
        ))
    })?;
    let snapshot = codex.thread_config_snapshot().await;

    Ok(Some(ThreadResumeResponse {
        thread: build_thread(thread, true, thread.protocol_status()),
        model: snapshot.model,
        model_provider: snapshot.model_provider_id,
        service_tier: snapshot.service_tier,
        cwd: snapshot.cwd,
        approval_policy: snapshot.approval_policy.into(),
        sandbox: snapshot.sandbox_policy.into(),
        reasoning_effort: snapshot.reasoning_effort,
    }))
}

async fn spawn_resumed_thread(
    runtime_bootstrap: &RuntimeBootstrap,
    stored: &StoredThreadSession,
    params: &ThreadResumeParams,
) -> Result<Codex, JSONRPCErrorError> {
    let mut config = runtime_bootstrap.config.clone();
    if let Some(model) = params.model.clone() {
        config.model = Some(model);
    }
    if let Some(model_provider) = params.model_provider.clone() {
        config.model_provider_id = model_provider;
    }
    if let Some(service_tier) = params.service_tier {
        config.service_tier = service_tier;
    }
    if let Some(cwd) = params.cwd.clone() {
        config.cwd = PathBuf::from(cwd);
    }
    if let Some(base_instructions) = params.base_instructions.clone() {
        config.base_instructions = Some(base_instructions);
    }
    if let Some(developer_instructions) = params.developer_instructions.clone() {
        config.developer_instructions = Some(developer_instructions);
    }
    if let Some(personality) = params.personality {
        config.personality = Some(personality);
    }
    if let Some(approval_policy) = params.approval_policy {
        let _ = config
            .permissions
            .approval_policy
            .set(approval_policy.to_core());
    }
    if let Some(sandbox) = params.sandbox {
        let _ = config
            .permissions
            .sandbox_policy
            .set(sandbox_policy_from_mode(sandbox.to_core()));
    }
    config.model = Some(resolve_model(
        params.model.clone().or_else(|| config.model.clone()),
        runtime_bootstrap.model_catalog.as_ref(),
    ));

    spawn_browser_codex(BrowserCodexSpawnArgs {
        config,
        auth: runtime_bootstrap.auth.clone(),
        model_catalog: runtime_bootstrap.model_catalog.clone(),
        conversation_history: InitialHistory::Resumed(ResumedHistory {
            conversation_id: parse_thread_id(&stored.metadata.thread_id)?,
            history: stored.items.clone(),
            rollout_path: synthetic_rollout_path(runtime_bootstrap, stored),
        }),
        session_source: session_source_from_items(&stored.items),
        dynamic_tools: Vec::new(),
        persist_extended_history: params.persist_extended_history,
        metrics_service_name: None,
        inherited_shell_snapshot: None,
        parent_trace: None,
        browser_fs: Arc::clone(&runtime_bootstrap.browser_fs),
        discoverable_apps_provider: Arc::clone(&runtime_bootstrap.discoverable_apps_provider),
        model_transport_host: Arc::clone(&runtime_bootstrap.model_transport_host),
        config_storage_host: Arc::clone(&runtime_bootstrap.config_storage_host),
        thread_storage_host: Arc::clone(&runtime_bootstrap.thread_storage_host),
        mcp_oauth_host: Arc::clone(&runtime_bootstrap.mcp_oauth_host),
    })
    .await
    .map(|spawn| spawn.codex)
    .map_err(internal_error)
}

fn build_thread_record(
    stored: &StoredThreadSession,
    codex: Arc<Codex>,
    fallback_model_provider: String,
) -> LoadedThread {
    let turns = codex_app_server_protocol::build_turns_from_rollout_items(&stored.items)
        .into_iter()
        .map(|turn| {
            (
                turn.id.clone(),
                TurnRecord {
                    id: turn.id,
                    items: turn.items,
                    status: turn.status,
                    error: turn.error,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let active_turn_id = turns.iter().find_map(|(turn_id, turn)| {
        (turn.status == codex_app_server_protocol::TurnStatus::InProgress).then(|| turn_id.clone())
    });
    LoadedThread {
        codex,
        record: ThreadRecord {
            id: stored.metadata.thread_id.clone(),
            preview: stored.metadata.preview.clone(),
            ephemeral: false,
            model_provider: if stored.metadata.model_provider.is_empty() {
                fallback_model_provider
            } else {
                stored.metadata.model_provider.clone()
            },
            cwd: PathBuf::from(stored.metadata.cwd.clone()),
            source: session_source_from_items(&stored.items),
            name: stored.metadata.name.clone(),
            created_at: stored.metadata.created_at,
            updated_at: stored.metadata.updated_at,
            archived: stored.metadata.archived,
            turns,
            active_turn_id,
            waiting_on_approval: false,
            waiting_on_user_input: false,
        },
    }
}

fn validate_requested_path(
    params: &ThreadResumeParams,
    stored: &StoredThreadSession,
) -> Result<(), JSONRPCErrorError> {
    let Some(requested_path) = params.path.as_ref() else {
        return Ok(());
    };
    let requested_file_name = requested_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string());
    if requested_file_name.as_deref() == Some(stored.metadata.rollout_id.as_str()) {
        return Ok(());
    }
    Err(invalid_request_error(format!(
        "requested rollout path `{}` does not match stored thread {}",
        requested_path.display(),
        stored.metadata.thread_id
    )))
}

fn synthetic_rollout_path(
    runtime_bootstrap: &RuntimeBootstrap,
    stored: &StoredThreadSession,
) -> PathBuf {
    runtime_bootstrap
        .config
        .codex_home
        .join("sessions")
        .join(stored.metadata.rollout_id.as_str())
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

fn parse_thread_id(thread_id: &str) -> Result<codex_protocol::ThreadId, JSONRPCErrorError> {
    codex_protocol::ThreadId::from_string(thread_id)
        .map_err(|error| invalid_request_error(format!("invalid thread id: {error}")))
}

fn map_load_error(
    thread_id: &str,
) -> impl FnOnce(codex_wasm_core::HostError) -> JSONRPCErrorError + '_ {
    move |error| {
        invalid_request_error(format!(
            "no rollout found for thread id {thread_id}: {}",
            error.message
        ))
    }
}

fn invalid_request_error(message: String) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32600,
        data: None,
        message,
    }
}

fn internal_error(error: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: error.to_string(),
    }
}

fn sandbox_policy_from_mode(
    mode: codex_protocol::config_types::SandboxMode,
) -> codex_protocol::protocol::SandboxPolicy {
    match mode {
        codex_protocol::config_types::SandboxMode::ReadOnly => {
            codex_protocol::protocol::SandboxPolicy::new_read_only_policy()
        }
        codex_protocol::config_types::SandboxMode::WorkspaceWrite => {
            codex_protocol::protocol::SandboxPolicy::new_workspace_write_policy()
        }
        codex_protocol::config_types::SandboxMode::DangerFullAccess => {
            codex_protocol::protocol::SandboxPolicy::DangerFullAccess
        }
    }
}
