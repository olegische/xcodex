use std::sync::Arc;

use codex_app_server_protocol::JSONRPCMessage;
use codex_app_server_protocol::ServerRequest;
use codex_protocol::protocol::Event;
use codex_protocol::protocol::EventMsg;
use tokio::sync::Mutex;
use wasm_bindgen::JsValue;

use crate::jsonrpc_bridge::server_notification_to_jsonrpc;
use crate::jsonrpc_bridge::server_request_to_jsonrpc;
use crate::state::RuntimeState;

pub(crate) async fn process_core_event(
    state: &Arc<Mutex<RuntimeState>>,
    thread_id: &str,
    event: Event,
) -> Result<(), JsValue> {
    browser_log(&format!(
        "[wasm_v2/browser] process_core_event type={}",
        event_name(&event.msg)
    ));
    let mut outgoing_notifications = Vec::new();
    let mut outgoing_requests = Vec::new();
    let (app_server, root_app_server, next_request_id, thread_record) = {
        let mut state = state.lock().await;
        let next_request_id = if matches!(
            &event.msg,
            EventMsg::ExecApprovalRequest(_)
                | EventMsg::ApplyPatchApprovalRequest(_)
                | EventMsg::RequestPermissions(_)
                | EventMsg::RequestUserInput(_)
                | EventMsg::ElicitationRequest(_)
                | EventMsg::DynamicToolCallRequest(_)
        ) {
            Some(state.next_request_id())
        } else {
            None
        };
        let loaded = match state.threads.get(thread_id) {
            Some(loaded) => loaded,
            None => return Ok(()),
        };
        (
            Arc::clone(&loaded.app_server),
            Arc::clone(&state.app_server),
            next_request_id,
            loaded.record.clone(),
        )
    };
    let effect = {
        let mut app_server = app_server.lock().await;
        codex_wasm_v2_app_server::process_loaded_thread_event(
            &mut app_server,
            thread_id,
            &thread_record,
            next_request_id,
            &event,
        )
    };
    let updated_record = {
        let mut state = state.lock().await;
        let updated_record = {
            let loaded = match state.threads.get_mut(thread_id) {
                Some(loaded) => loaded,
                None => return Ok(()),
            };
            loaded.record = effect.updated_record.clone();
            loaded.record.clone()
        };
        outgoing_notifications.extend(effect.notifications);
        for request in effect.server_requests {
            state
                .pending_server_request_threads
                .insert(request.id().clone(), thread_id.to_string());
            outgoing_requests.push(request);
        }
        updated_record
    };
    {
        let mut app_server = app_server.lock().await;
        app_server.register_thread(updated_record.clone());
    }
    {
        let mut app_server = root_app_server.lock().await;
        app_server.register_thread(updated_record);
    }

    for notification in outgoing_notifications {
        enqueue_server_notification(state, notification).await;
    }
    for request in outgoing_requests {
        enqueue_server_request(state, request).await;
    }
    Ok(())
}

pub(crate) async fn enqueue_server_notification(
    state: &Arc<Mutex<RuntimeState>>,
    notification: codex_app_server_protocol::ServerNotification,
) {
    let tx = {
        let mut state = state.lock().await;
        if !state.should_enqueue_notification(&notification) {
            browser_log(&format!(
                "[wasm_v2/browser] suppressed duplicate server notification {notification}"
            ));
            return;
        }
        state.outgoing_tx.clone()
    };
    browser_log(&format!(
        "[wasm_v2/browser] enqueue_server_notification {notification}"
    ));
    let message = JSONRPCMessage::Notification(server_notification_to_jsonrpc(notification));
    let _ = tx.send(message).await;
}

pub(crate) async fn enqueue_server_request(
    state: &Arc<Mutex<RuntimeState>>,
    request: ServerRequest,
) {
    let jsonrpc = server_request_to_jsonrpc(request);
    let tx = {
        let state = state.lock().await;
        state.outgoing_tx.clone()
    };
    let _ = tx.send(JSONRPCMessage::Request(jsonrpc)).await;
}

fn event_name(event: &EventMsg) -> &'static str {
    match event {
        EventMsg::TurnStarted(_) => "TurnStarted",
        EventMsg::TurnComplete(_) => "TurnComplete",
        EventMsg::TurnAborted(_) => "TurnAborted",
        EventMsg::Error(_) => "Error",
        EventMsg::RawResponseItem(_) => "RawResponseItem",
        EventMsg::ItemStarted(_) => "ItemStarted",
        EventMsg::ItemCompleted(_) => "ItemCompleted",
        EventMsg::AgentMessageContentDelta(_) => "AgentMessageContentDelta",
        EventMsg::PlanDelta(_) => "PlanDelta",
        EventMsg::ExecApprovalRequest(_) => "ExecApprovalRequest",
        EventMsg::ApplyPatchApprovalRequest(_) => "ApplyPatchApprovalRequest",
        EventMsg::RequestPermissions(_) => "RequestPermissions",
        EventMsg::RequestUserInput(_) => "RequestUserInput",
        EventMsg::ElicitationRequest(_) => "ElicitationRequest",
        EventMsg::DynamicToolCallRequest(_) => "DynamicToolCallRequest",
        EventMsg::TokenCount(_) => "TokenCount",
        EventMsg::BackgroundEvent(_) => "BackgroundEvent",
        EventMsg::ExecCommandBegin(_) => "ExecCommandBegin",
        EventMsg::ExecCommandEnd(_) => "ExecCommandEnd",
        EventMsg::PatchApplyBegin(_) => "PatchApplyBegin",
        EventMsg::PatchApplyEnd(_) => "PatchApplyEnd",
        EventMsg::McpToolCallBegin(_) => "McpToolCallBegin",
        EventMsg::McpToolCallEnd(_) => "McpToolCallEnd",
        EventMsg::WebSearchBegin(_) => "WebSearchBegin",
        EventMsg::WebSearchEnd(_) => "WebSearchEnd",
        EventMsg::ImageGenerationBegin(_) => "ImageGenerationBegin",
        EventMsg::ImageGenerationEnd(_) => "ImageGenerationEnd",
        EventMsg::AgentReasoningDelta(_) => "AgentReasoningDelta",
        EventMsg::AgentReasoningRawContentDelta(_) => "AgentReasoningRawContentDelta",
        EventMsg::AgentMessageDelta(_) => "AgentMessageDelta",
        EventMsg::DynamicToolCallResponse(_) => "DynamicToolCallResponse",
        EventMsg::TurnDiff(_) => "TurnDiff",
        _ => "Other",
    }
}

#[cfg(target_arch = "wasm32")]
fn browser_log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}

#[cfg(not(target_arch = "wasm32"))]
fn browser_log(_message: &str) {}
