use std::sync::Arc;

use codex_app_server_protocol::JSONRPCError;
use codex_app_server_protocol::RequestId;
use codex_wasm_v2_app_server::LoadedThreadStartResult;
use codex_wasm_v2_app_server::MessageProcessor;
use codex_wasm_v2_core::codex::Codex;
use tokio::sync::Mutex;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::spawn_local;

use crate::event_bridge::process_core_event;
use crate::rpc::internal_error;
use crate::rpc::method_error;
use crate::state::LoadedThread;
use crate::state::RuntimeState;

pub(crate) async fn install_started_thread(
    state: &Arc<Mutex<RuntimeState>>,
    started: Box<LoadedThreadStartResult>,
) {
    let thread_id = started.runtime.record.id.clone();
    let app_server = Arc::new(Mutex::new(started.runtime.processor));
    {
        let mut state = state.lock().await;
        state.threads.insert(
            thread_id.clone(),
            LoadedThread {
                app_server,
                codex: Arc::clone(&started.runtime.codex),
                record: started.runtime.record.clone(),
            },
        );
    }
    spawn_event_pump(state, thread_id, started.runtime.codex);
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
    updated_record: codex_wasm_v2_app_server::ThreadRecord,
) -> Result<(), JSONRPCError> {
    let synced_record = {
        let mut state = state.lock().await;
        let loaded = state.threads.get_mut(thread_id).ok_or_else(|| {
            internal_error(id.clone(), format!("{thread_id} missing thread after sync"))
        })?;
        loaded.record = updated_record;
        loaded.record.clone()
    };
    codex_wasm_v2_app_server::sync_loaded_thread_record(
        &mut *root_app_server.lock().await,
        synced_record,
    );
    Ok(())
}

fn spawn_event_pump(state: &Arc<Mutex<RuntimeState>>, thread_id: String, codex: Arc<Codex>) {
    let state = Arc::clone(state);
    spawn_local(async move {
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
