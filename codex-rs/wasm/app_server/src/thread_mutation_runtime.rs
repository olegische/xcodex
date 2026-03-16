use codex_app_server_protocol::JSONRPCErrorError;

use crate::AppServerState;
use crate::ThreadRecord;

pub fn archive_thread(
    app_server_state: &mut AppServerState,
    thread_id: &str,
) -> Result<(), JSONRPCErrorError> {
    let Some(thread) = app_server_state.threads.get_mut(thread_id) else {
        return Err(invalid_request_error(format!(
            "no rollout found for thread id {thread_id}"
        )));
    };
    thread.archived = true;
    thread.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
    app_server_state.running_threads.remove(thread_id);
    Ok(())
}

pub fn unarchive_thread(
    app_server_state: &mut AppServerState,
    thread_id: &str,
) -> Result<ThreadRecord, JSONRPCErrorError> {
    let Some(thread) = app_server_state.threads.get_mut(thread_id) else {
        return Err(invalid_request_error(format!(
            "no archived rollout found for thread id {thread_id}"
        )));
    };
    if !thread.archived {
        return Err(invalid_request_error(format!(
            "no archived rollout found for thread id {thread_id}"
        )));
    }
    thread.archived = false;
    thread.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
    Ok(thread.clone())
}

pub fn set_thread_name(
    app_server_state: &mut AppServerState,
    thread_id: &str,
    name: String,
) -> Result<String, JSONRPCErrorError> {
    let Some(normalized) = codex_wasm_v2_core::util::normalize_thread_name(&name) else {
        return Err(invalid_request_error(
            "thread name must not be empty".to_string(),
        ));
    };
    let Some(thread) = app_server_state.threads.get_mut(thread_id) else {
        return Err(invalid_request_error(format!(
            "thread not found: {thread_id}"
        )));
    };
    thread.name = Some(normalized.clone());
    thread.updated_at = codex_wasm_v2_core::time::now_unix_seconds();
    Ok(normalized)
}

fn invalid_request_error(message: String) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32600,
        data: None,
        message,
    }
}
