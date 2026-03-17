use std::sync::Arc;

use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ServerNotification;
use codex_app_server_protocol::ThreadStartParams;
use codex_wasm_core::codex::Codex;

use crate::ApiVersion;
use crate::MessageProcessor;
use crate::MessageProcessorArgs;
use crate::RuntimeBootstrap;
use crate::ThreadRecord;

pub struct LoadedThreadRuntime {
    pub processor: MessageProcessor,
    pub codex: Arc<Codex>,
    pub record: ThreadRecord,
    pub notifications: Vec<ServerNotification>,
}

pub struct LoadedThreadStartResult {
    pub response: serde_json::Value,
    pub runtime: LoadedThreadRuntime,
}

pub struct LoadedThreadRequestResult {
    pub thread_id: String,
    pub response: serde_json::Value,
    pub updated_record: Option<ThreadRecord>,
}

pub struct LoadedThreadServerResponseResult {
    pub resolved: crate::ResolvedServerRequest,
    pub notifications: Vec<ServerNotification>,
}

pub async fn start_loaded_thread_runtime(
    root_processor: &mut MessageProcessor,
    request_id: RequestId,
    params: ThreadStartParams,
    runtime_bootstrap: RuntimeBootstrap,
) -> Result<LoadedThreadStartResult, JSONRPCErrorError> {
    let response = root_processor
        .process_initialized_request(ClientRequest::ThreadStart { request_id, params })
        .await?;
    let thread_id = response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| internal_error("thread/start response missing thread id"))?;
    let record = root_processor
        .thread_record(thread_id)
        .ok_or_else(|| internal_error("thread/start missing thread state"))?;
    let codex = root_processor
        .running_thread(thread_id)
        .ok_or_else(|| internal_error("thread/start missing loaded codex"))?;
    let notifications = root_processor.take_notifications();
    let processor =
        new_loaded_thread_processor(runtime_bootstrap, record.clone(), Arc::clone(&codex));

    Ok(LoadedThreadStartResult {
        response,
        runtime: LoadedThreadRuntime {
            processor,
            codex,
            record,
            notifications,
        },
    })
}

pub async fn process_loaded_thread_request(
    processor: &mut MessageProcessor,
    request: ClientRequest,
) -> Result<LoadedThreadRequestResult, JSONRPCErrorError> {
    let Some(crate::RequestTarget::LoadedThread {
        thread_id,
        updates_thread_state,
    }) = crate::request_target(&request)
    else {
        return Err(internal_error("loaded thread request missing thread id"));
    };
    let response = processor.process_initialized_request(request).await?;
    let updated_record = if updates_thread_state {
        Some(
            processor
                .thread_record(&thread_id)
                .ok_or_else(|| internal_error("loaded thread request missing thread state"))?,
        )
    } else {
        None
    };
    Ok(LoadedThreadRequestResult {
        thread_id,
        response,
        updated_record,
    })
}

pub fn sync_loaded_thread_record(root_processor: &mut MessageProcessor, thread: ThreadRecord) {
    root_processor.register_thread(thread);
}

pub fn process_loaded_thread_server_response(
    processor: &mut MessageProcessor,
    request_id: RequestId,
    result: Result<serde_json::Value, String>,
) -> Result<LoadedThreadServerResponseResult, JSONRPCErrorError> {
    let resolved = match result {
        Ok(value) => processor.process_response(request_id, value),
        Err(message) => processor.process_error(
            request_id,
            JSONRPCErrorError {
                code: -32603,
                data: None,
                message,
            },
        ),
    }?;
    let notifications = processor.take_notifications();
    Ok(LoadedThreadServerResponseResult {
        resolved,
        notifications,
    })
}

pub fn new_loaded_thread_processor(
    runtime_bootstrap: RuntimeBootstrap,
    thread: ThreadRecord,
    codex: Arc<Codex>,
) -> MessageProcessor {
    let mut processor = MessageProcessor::new(MessageProcessorArgs {
        api_version: ApiVersion::V2,
        config_warnings: Vec::new(),
    });
    processor.set_runtime_bootstrap(runtime_bootstrap);
    processor.register_loaded_thread(thread, codex);
    processor
}

fn internal_error(message: &str) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: message.to_string(),
    }
}
