use crate::app_server_events::TurnNotificationEmitter;
use crate::codex::ModelCompletedUiEvent;
use crate::codex::ModelDeltaUiEvent;
use crate::codex::ModelFailedUiEvent;
use crate::codex::ModelOutputItemUiEvent;
use crate::codex::ModelStartedUiEvent;
use crate::codex::RunTurnRequest;
use crate::codex::ThreadLoadedEvent;
use crate::codex::TurnCompletedEvent;
use crate::codex::TurnFailedEvent;
use crate::codex::TurnStartedEvent;
use crate::codex::UiEvent;
use crate::context_manager::build_request_payload;
use crate::context_manager::serialize_response_input_item;
use crate::context_manager::serialize_response_item;
use crate::function_tool::FunctionCallError;
use crate::host::HostCollaboration;
use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::HostFs;
use crate::host::HostInstructionStore;
use crate::host::HostModelTransport;
use crate::host::HostNotificationSink;
use crate::host::HostResult;
use crate::host::HostSessionStore;
use crate::host::HostToolExecutor;
use crate::host::ModelRequest;
use crate::host::ModelTransportEvent;
use crate::instructions::with_default_base_instructions;
use crate::state::ActiveTurn;
use crate::state::SessionState;
use crate::tools::runtime::CollaborationMode;
use crate::tools::runtime::WasmToolRuntime;
use crate::tools::spec::browser_builtin_tool_specs;
use futures::StreamExt;
use serde_json::json;

const MAX_TOOL_ITERATIONS_PER_TURN: usize = 50;

pub(crate) struct RegularTurnTask<'a> {
    pub(crate) fs: &'a dyn HostFs,
    pub(crate) collaboration: &'a dyn HostCollaboration,
    pub(crate) instruction_store: &'a dyn HostInstructionStore,
    pub(crate) model_transport: &'a dyn HostModelTransport,
    pub(crate) notification_sink: &'a dyn HostNotificationSink,
    pub(crate) session_store: &'a dyn HostSessionStore,
    pub(crate) tool_executor: &'a dyn HostToolExecutor,
    pub(crate) collaboration_mode: CollaborationMode,
    pub(crate) default_mode_request_user_input: bool,
}

impl<'a> RegularTurnTask<'a> {
    pub(crate) async fn run(
        &self,
        mut session: SessionState,
        request: RunTurnRequest,
    ) -> HostResult<(SessionState, Vec<UiEvent>)> {
        let instruction_snapshot = self
            .instruction_store
            .load_instructions(request.thread_id.clone())
            .await?;

        session.push_item(json!({
            "type": "userInput",
            "turnId": request.turn_id,
            "input": request.input,
        }));
        self.session_store
            .save_thread(session.snapshot().clone())
            .await?;

        let mut events = vec![
            UiEvent::ThreadLoaded(ThreadLoadedEvent {
                thread_id: session.thread_id().to_string(),
                item_count: session.item_count(),
            }),
            UiEvent::TurnStarted(TurnStartedEvent {
                thread_id: session.thread_id().to_string(),
                turn_id: request.turn_id.clone(),
            }),
        ];
        let mut notification_emitter =
            TurnNotificationEmitter::new(session.thread_id().to_string(), request.turn_id.clone());
        for event in &events {
            for notification in notification_emitter.push_ui_event(event) {
                self.notification_sink
                    .emit_notification(notification)
                    .await?;
            }
        }
        let model_payload = with_default_base_instructions(request.model_payload);
        let model_payload = if let Some(snapshot) = instruction_snapshot.as_ref() {
            snapshot.append_to_model_payload(model_payload)
        } else {
            model_payload
        };

        let mut active_turn = ActiveTurn::new(&request.input);

        loop {
            let request_id = active_turn.next_request_id(&request.turn_id);
            let request_payload = build_request_payload(
                model_payload.clone(),
                active_turn.response_input_items(),
                browser_builtin_tool_specs(),
                self.tool_executor.list_tools().await?,
            )?;
            let mut stream = self
                .model_transport
                .start_stream(ModelRequest {
                    request_id: request_id.clone(),
                    payload: request_payload,
                })
                .await?;
            let tool_runtime = WasmToolRuntime::new(
                self.fs,
                self.collaboration,
                self.tool_executor,
                self.collaboration_mode,
                self.default_mode_request_user_input,
            );
            let mut should_continue = false;

            while let Some(event) = stream.next().await {
                match event {
                    ModelTransportEvent::Started { request_id } => {
                        let event = UiEvent::ModelStarted(ModelStartedUiEvent {
                            thread_id: session.thread_id().to_string(),
                            turn_id: request.turn_id.clone(),
                            request_id,
                        });
                        for notification in notification_emitter.push_ui_event(&event) {
                            self.notification_sink
                                .emit_notification(notification)
                                .await?;
                        }
                        events.push(event);
                    }
                    ModelTransportEvent::Delta {
                        request_id,
                        payload,
                    } => {
                        session.push_item(json!({
                            "type": "modelDelta",
                            "turnId": request.turn_id,
                            "requestId": request_id,
                            "payload": payload,
                        }));
                        let event = UiEvent::ModelDelta(ModelDeltaUiEvent {
                            thread_id: session.thread_id().to_string(),
                            turn_id: request.turn_id.clone(),
                            request_id,
                            payload,
                        });
                        for notification in notification_emitter.push_ui_event(&event) {
                            self.notification_sink
                                .emit_notification(notification)
                                .await?;
                        }
                        events.push(event);
                    }
                    ModelTransportEvent::OutputItemDone { request_id, item } => {
                        active_turn.push_response_input(serialize_response_item(&item)?);
                        session.push_item(json!({
                            "type": "modelOutputItem",
                            "turnId": request.turn_id,
                            "requestId": request_id,
                            "item": item,
                        }));
                        let event = UiEvent::ModelOutputItem(ModelOutputItemUiEvent {
                            thread_id: session.thread_id().to_string(),
                            turn_id: request.turn_id.clone(),
                            request_id: request_id.clone(),
                            item: item.clone(),
                        });
                        for notification in notification_emitter.push_ui_event(&event) {
                            self.notification_sink
                                .emit_notification(notification)
                                .await?;
                        }
                        events.push(event);

                        let output = tool_runtime
                            .handle_output_item_done(item)
                            .await
                            .map_err(function_call_error_to_host_error)?;
                        if let Some(tool_output) = output.tool_output {
                            should_continue = true;
                            active_turn
                                .push_response_input(serialize_response_input_item(&tool_output)?);
                            session.push_item(json!({
                                "type": "toolOutputItem",
                                "turnId": request.turn_id,
                                "requestId": request_id,
                                "item": tool_output,
                            }));
                            for notification in
                                notification_emitter.push_tool_output_item(&tool_output)
                            {
                                self.notification_sink
                                    .emit_notification(notification)
                                    .await?;
                            }
                        }
                    }
                    ModelTransportEvent::Completed { request_id } => {
                        session.push_item(json!({
                            "type": "modelCompleted",
                            "turnId": request.turn_id,
                            "requestId": request_id,
                        }));
                        let event = UiEvent::ModelCompleted(ModelCompletedUiEvent {
                            thread_id: session.thread_id().to_string(),
                            turn_id: request.turn_id.clone(),
                            request_id,
                        });
                        for notification in notification_emitter.push_ui_event(&event) {
                            self.notification_sink
                                .emit_notification(notification)
                                .await?;
                        }
                        events.push(event);
                    }
                    ModelTransportEvent::Failed { request_id, error } => {
                        session.push_item(json!({
                            "type": "modelFailed",
                            "turnId": request.turn_id,
                            "requestId": request_id,
                            "error": error,
                        }));
                        let model_failed_event = UiEvent::ModelFailed(ModelFailedUiEvent {
                            thread_id: session.thread_id().to_string(),
                            turn_id: request.turn_id.clone(),
                            request_id,
                            error: error.clone(),
                        });
                        for notification in notification_emitter.push_ui_event(&model_failed_event)
                        {
                            self.notification_sink
                                .emit_notification(notification)
                                .await?;
                        }
                        events.push(model_failed_event);
                        let turn_failed_event = UiEvent::TurnFailed(TurnFailedEvent {
                            thread_id: session.thread_id().to_string(),
                            turn_id: request.turn_id.clone(),
                            error,
                        });
                        for notification in notification_emitter.push_ui_event(&turn_failed_event) {
                            self.notification_sink
                                .emit_notification(notification)
                                .await?;
                        }
                        events.push(turn_failed_event);
                    }
                }
            }

            active_turn.advance();
            if !should_continue {
                break;
            }
            if active_turn.request_index() > MAX_TOOL_ITERATIONS_PER_TURN {
                let error = HostError {
                    code: HostErrorCode::Conflict,
                    message: format!(
                        "model exceeded max tool iterations for turn: {MAX_TOOL_ITERATIONS_PER_TURN}"
                    ),
                    retryable: false,
                    data: None,
                };
                session.push_item(json!({
                    "type": "turnFailed",
                    "turnId": request.turn_id,
                    "error": error,
                }));
                let event = UiEvent::TurnFailed(TurnFailedEvent {
                    thread_id: session.thread_id().to_string(),
                    turn_id: request.turn_id.clone(),
                    error,
                });
                for notification in notification_emitter.push_ui_event(&event) {
                    self.notification_sink
                        .emit_notification(notification)
                        .await?;
                }
                events.push(event);
                break;
            }
        }

        let event = UiEvent::TurnCompleted(TurnCompletedEvent {
            thread_id: session.thread_id().to_string(),
            turn_id: request.turn_id,
        });
        for notification in notification_emitter.push_ui_event(&event) {
            self.notification_sink
                .emit_notification(notification)
                .await?;
        }
        events.push(event);

        self.session_store
            .save_thread(session.snapshot().clone())
            .await?;

        Ok((session, events))
    }
}

fn function_call_error_to_host_error(error: FunctionCallError) -> HostError {
    match error {
        FunctionCallError::RespondToModel(message) => HostError {
            code: HostErrorCode::InvalidInput,
            message,
            retryable: false,
            data: None,
        },
        FunctionCallError::MissingLocalShellCallId => HostError {
            code: HostErrorCode::InvalidInput,
            message: "LocalShellCall without call_id or id".to_string(),
            retryable: false,
            data: None,
        },
        FunctionCallError::Fatal(message) => HostError {
            code: HostErrorCode::Internal,
            message,
            retryable: false,
            data: None,
        },
    }
}
