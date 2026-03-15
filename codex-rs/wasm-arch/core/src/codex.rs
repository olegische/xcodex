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
use crate::host::SessionSnapshot;
use crate::state::SessionState;
use crate::tasks::RegularTurnTask;
use crate::tools::runtime::CollaborationMode;
use codex_protocol::models::ResponseItem;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", content = "payload", rename_all = "camelCase")]
pub enum UiEvent {
    ThreadStarted(ThreadStartedEvent),
    ThreadLoaded(ThreadLoadedEvent),
    TurnStarted(TurnStartedEvent),
    ModelStarted(ModelStartedUiEvent),
    ModelDelta(ModelDeltaUiEvent),
    ModelOutputItem(ModelOutputItemUiEvent),
    ModelCompleted(ModelCompletedUiEvent),
    ModelFailed(ModelFailedUiEvent),
    TurnCompleted(TurnCompletedEvent),
    TurnFailed(TurnFailedEvent),
    SessionSaved(SessionSavedEvent),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartedEvent {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadLoadedEvent {
    pub thread_id: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartedEvent {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStartedUiEvent {
    pub thread_id: String,
    pub turn_id: String,
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDeltaUiEvent {
    pub thread_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOutputItemUiEvent {
    pub thread_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub item: ResponseItem,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCompletedUiEvent {
    pub thread_id: String,
    pub turn_id: String,
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFailedUiEvent {
    pub thread_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub error: HostError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompletedEvent {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFailedEvent {
    pub thread_id: String,
    pub turn_id: String,
    pub error: HostError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSavedEvent {
    pub thread_id: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartThreadRequest {
    pub thread_id: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeThreadRequest {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTurnRequest {
    pub thread_id: String,
    pub turn_id: String,
    pub input: Value,
    pub model_payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDispatch<T> {
    pub value: T,
    pub events: Vec<UiEvent>,
}

pub struct BrowserRuntime<'a> {
    fs: &'a dyn HostFs,
    collaboration: &'a dyn HostCollaboration,
    instruction_store: &'a dyn HostInstructionStore,
    model_transport: &'a dyn HostModelTransport,
    notification_sink: &'a dyn HostNotificationSink,
    session_store: &'a dyn HostSessionStore,
    tool_executor: &'a dyn HostToolExecutor,
    collaboration_mode: CollaborationMode,
    default_mode_request_user_input: bool,
}

impl<'a> BrowserRuntime<'a> {
    pub fn new(
        fs: &'a dyn HostFs,
        collaboration: &'a dyn HostCollaboration,
        instruction_store: &'a dyn HostInstructionStore,
        model_transport: &'a dyn HostModelTransport,
        notification_sink: &'a dyn HostNotificationSink,
        session_store: &'a dyn HostSessionStore,
        tool_executor: &'a dyn HostToolExecutor,
    ) -> Self {
        Self {
            fs,
            collaboration,
            instruction_store,
            model_transport,
            notification_sink,
            session_store,
            tool_executor,
            collaboration_mode: CollaborationMode::Default,
            default_mode_request_user_input: false,
        }
    }

    pub fn with_collaboration_mode(mut self, collaboration_mode: CollaborationMode) -> Self {
        self.collaboration_mode = collaboration_mode;
        self
    }

    pub fn with_default_mode_request_user_input(
        mut self,
        default_mode_request_user_input: bool,
    ) -> Self {
        self.default_mode_request_user_input = default_mode_request_user_input;
        self
    }

    pub async fn start_thread(
        &self,
        request: StartThreadRequest,
    ) -> HostResult<RuntimeDispatch<SessionSnapshot>> {
        let snapshot = SessionSnapshot {
            thread_id: request.thread_id.clone(),
            metadata: request.metadata,
            items: Vec::new(),
        };
        self.session_store.save_thread(snapshot.clone()).await?;

        Ok(RuntimeDispatch {
            value: snapshot.clone(),
            events: vec![
                UiEvent::ThreadStarted(ThreadStartedEvent {
                    thread_id: snapshot.thread_id.clone(),
                }),
                UiEvent::SessionSaved(SessionSavedEvent {
                    thread_id: snapshot.thread_id,
                    item_count: snapshot.items.len(),
                }),
            ],
        })
    }

    pub async fn resume_thread(
        &self,
        request: ResumeThreadRequest,
    ) -> HostResult<RuntimeDispatch<SessionSnapshot>> {
        let snapshot = self
            .session_store
            .load_thread(request.thread_id.clone())
            .await?
            .ok_or_else(|| missing_thread_error(&request.thread_id))?;

        Ok(RuntimeDispatch {
            value: snapshot.clone(),
            events: vec![UiEvent::ThreadLoaded(ThreadLoadedEvent {
                thread_id: snapshot.thread_id,
                item_count: snapshot.items.len(),
            })],
        })
    }

    pub async fn run_turn(
        &self,
        request: RunTurnRequest,
    ) -> HostResult<RuntimeDispatch<SessionSnapshot>> {
        let snapshot = self
            .session_store
            .load_thread(request.thread_id.clone())
            .await?
            .ok_or_else(|| missing_thread_error(&request.thread_id))?;
        let task = RegularTurnTask {
            fs: self.fs,
            collaboration: self.collaboration,
            instruction_store: self.instruction_store,
            model_transport: self.model_transport,
            notification_sink: self.notification_sink,
            session_store: self.session_store,
            tool_executor: self.tool_executor,
            collaboration_mode: self.collaboration_mode,
            default_mode_request_user_input: self.default_mode_request_user_input,
        };
        let (session, mut events) = task.run(SessionState::new(snapshot), request).await?;
        events.push(UiEvent::SessionSaved(SessionSavedEvent {
            thread_id: session.thread_id().to_string(),
            item_count: session.item_count(),
        }));
        let snapshot = session.into_snapshot();

        Ok(RuntimeDispatch {
            value: snapshot,
            events,
        })
    }
}

fn missing_thread_error(thread_id: &str) -> HostError {
    HostError {
        code: HostErrorCode::NotFound,
        message: format!("thread `{thread_id}` is not available in the wasm session store"),
        retryable: false,
        data: Some(serde_json::json!({
            "threadId": thread_id,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context_manager::updates::transport_tools_from_host_specs;
    use crate::host::ApplyPatchRequest;
    use crate::host::ApplyPatchResponse;
    use crate::host::HostCollaboration;
    use crate::host::HostFileEntry;
    use crate::host::HostFs;
    use crate::host::HostNotificationSink;
    use crate::host::HostSessionStore;
    use crate::host::ListDirRequest;
    use crate::host::ListDirResponse;
    use crate::host::ModelEventStream;
    use crate::host::ModelRequest;
    use crate::host::ModelTransportEvent;
    use crate::host::ReadFileRequest;
    use crate::host::ReadFileResponse;
    use crate::host::RequestUserInputAnswer;
    use crate::host::RequestUserInputRequest;
    use crate::host::RequestUserInputResponse;
    use crate::host::SearchRequest;
    use crate::host::SearchResponse;
    use crate::host::ToolInvokeRequest;
    use crate::host::ToolInvokeResponse;
    use crate::host::UpdatePlanRequest;
    use crate::host::WriteFileRequest;
    use crate::host::WriteFileResponse;
    use crate::instructions::DEFAULT_BASE_INSTRUCTIONS;
    use crate::instructions::InstructionSnapshot;
    use crate::instructions::SkillInstructions;
    use crate::instructions::UserInstructions;
    use crate::tools::spec::browser_builtin_tool_specs;
    use async_trait::async_trait;
    use codex_app_server_protocol::ServerNotification;
    use codex_protocol::models::FunctionCallOutputBody;
    use codex_protocol::models::FunctionCallOutputPayload;
    use codex_protocol::models::ResponseInputItem;
    use futures::stream;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use std::sync::Mutex;

    struct MockModelTransport {
        event_sequences: Mutex<Vec<Vec<ModelTransportEvent>>>,
        requests: Mutex<Vec<ModelRequest>>,
    }

    struct MockSessionStore {
        snapshot: Mutex<Option<SessionSnapshot>>,
        saves: Mutex<Vec<SessionSnapshot>>,
    }

    struct MockInstructionStore {
        snapshot: Option<InstructionSnapshot>,
    }

    struct MockFs;

    struct MockCollaboration;

    struct MockToolExecutor {
        tools: Vec<crate::host::HostToolSpec>,
        invocations: Mutex<Vec<ToolInvokeRequest>>,
    }

    struct MockNotificationSink;

    #[async_trait(?Send)]
    impl HostModelTransport for MockModelTransport {
        async fn start_stream(&self, request: ModelRequest) -> HostResult<ModelEventStream> {
            self.requests.lock().expect("lock poisoned").push(request);
            let events = self
                .event_sequences
                .lock()
                .expect("lock poisoned")
                .remove(0);
            Ok(Box::pin(stream::iter(events)))
        }

        async fn cancel(&self, _request_id: String) -> HostResult<()> {
            Ok(())
        }
    }

    #[async_trait(?Send)]
    impl HostInstructionStore for MockInstructionStore {
        async fn load_instructions(
            &self,
            _thread_id: String,
        ) -> HostResult<Option<InstructionSnapshot>> {
            Ok(self.snapshot.clone())
        }
    }

    #[async_trait(?Send)]
    impl HostFs for MockFs {
        async fn read_file(&self, request: ReadFileRequest) -> HostResult<ReadFileResponse> {
            Ok(ReadFileResponse {
                path: request.path,
                content: "fn answer() {\n    42\n}\n".to_string(),
            })
        }

        async fn list_dir(&self, _request: ListDirRequest) -> HostResult<ListDirResponse> {
            Ok(ListDirResponse {
                entries: vec![HostFileEntry {
                    path: "/workspace".to_string(),
                    is_dir: true,
                    size_bytes: None,
                }],
            })
        }

        async fn search(&self, _request: SearchRequest) -> HostResult<SearchResponse> {
            Ok(SearchResponse {
                matches: Vec::new(),
            })
        }

        async fn write_file(&self, request: WriteFileRequest) -> HostResult<WriteFileResponse> {
            Ok(WriteFileResponse {
                path: request.path,
                bytes_written: request.content.len(),
            })
        }

        async fn apply_patch(&self, _request: ApplyPatchRequest) -> HostResult<ApplyPatchResponse> {
            Ok(ApplyPatchResponse {
                files_changed: Vec::new(),
            })
        }
    }

    #[async_trait(?Send)]
    impl HostCollaboration for MockCollaboration {
        async fn update_plan(&self, _request: UpdatePlanRequest) -> HostResult<()> {
            Ok(())
        }

        async fn request_user_input(
            &self,
            _request: RequestUserInputRequest,
        ) -> HostResult<RequestUserInputResponse> {
            Ok(RequestUserInputResponse {
                answers: vec![RequestUserInputAnswer {
                    id: "choice".to_string(),
                    value: json!("ok"),
                }],
            })
        }
    }

    #[async_trait(?Send)]
    impl HostToolExecutor for MockToolExecutor {
        async fn list_tools(&self) -> HostResult<Vec<crate::host::HostToolSpec>> {
            Ok(self.tools.clone())
        }

        async fn invoke(&self, request: ToolInvokeRequest) -> HostResult<ToolInvokeResponse> {
            self.invocations
                .lock()
                .expect("lock poisoned")
                .push(request.clone());
            Ok(ToolInvokeResponse {
                call_id: request.call_id,
                output: json!({
                    "ok": true,
                    "tool": request.tool_name,
                }),
            })
        }

        async fn cancel(&self, _call_id: String) -> HostResult<()> {
            Ok(())
        }
    }

    #[async_trait(?Send)]
    impl HostSessionStore for MockSessionStore {
        async fn load_thread(&self, _thread_id: String) -> HostResult<Option<SessionSnapshot>> {
            Ok(self.snapshot.lock().expect("lock poisoned").clone())
        }

        async fn save_thread(&self, snapshot: SessionSnapshot) -> HostResult<()> {
            self.saves
                .lock()
                .expect("lock poisoned")
                .push(snapshot.clone());
            *self.snapshot.lock().expect("lock poisoned") = Some(snapshot);
            Ok(())
        }
    }

    #[async_trait(?Send)]
    impl HostNotificationSink for MockNotificationSink {
        async fn emit_notification(&self, _notification: ServerNotification) -> HostResult<()> {
            Ok(())
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn start_thread_persists_empty_snapshot() {
        let session_store = MockSessionStore {
            snapshot: Mutex::new(None),
            saves: Mutex::new(Vec::new()),
        };
        let instruction_store = MockInstructionStore { snapshot: None };
        let model_transport = MockModelTransport {
            event_sequences: Mutex::new(Vec::new()),
            requests: Mutex::new(Vec::new()),
        };
        let fs = MockFs;
        let collaboration = MockCollaboration;
        let tool_executor = MockToolExecutor {
            tools: Vec::new(),
            invocations: Mutex::new(Vec::new()),
        };
        let notification_sink = MockNotificationSink;
        let runtime = BrowserRuntime::new(
            &fs,
            &collaboration,
            &instruction_store,
            &model_transport,
            &notification_sink,
            &session_store,
            &tool_executor,
        );

        let result = runtime
            .start_thread(StartThreadRequest {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
            })
            .await
            .expect("thread start should succeed");

        assert_eq!(
            result.value,
            SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: Vec::new(),
            }
        );
        assert_eq!(
            result.events,
            vec![
                UiEvent::ThreadStarted(ThreadStartedEvent {
                    thread_id: "thread-1".to_string(),
                }),
                UiEvent::SessionSaved(SessionSavedEvent {
                    thread_id: "thread-1".to_string(),
                    item_count: 0,
                }),
            ]
        );
        assert_eq!(
            session_store.saves.lock().expect("lock poisoned").clone(),
            vec![SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: Vec::new(),
            }]
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_turn_streams_model_events_and_saves_history() {
        let session_store = MockSessionStore {
            snapshot: Mutex::new(Some(SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: vec![json!({ "type": "existing" })],
            })),
            saves: Mutex::new(Vec::new()),
        };
        let instruction_store = MockInstructionStore {
            snapshot: Some(InstructionSnapshot {
                user_instructions: Some(UserInstructions {
                    directory: "/repo".to_string(),
                    text: "follow repo rules".to_string(),
                }),
                skills: vec![SkillInstructions {
                    name: "demo-skill".to_string(),
                    path: "skills/demo/SKILL.md".to_string(),
                    contents: "body".to_string(),
                }],
            }),
        };
        let model_transport = MockModelTransport {
            event_sequences: Mutex::new(vec![vec![
                ModelTransportEvent::Started {
                    request_id: "turn-1".to_string(),
                },
                ModelTransportEvent::Delta {
                    request_id: "turn-1".to_string(),
                    payload: json!({ "outputTextDelta": "hi" }),
                },
                ModelTransportEvent::OutputItemDone {
                    request_id: "turn-1".to_string(),
                    item: ResponseItem::Message {
                        id: Some("msg-1".to_string()),
                        role: "assistant".to_string(),
                        content: vec![codex_protocol::models::ContentItem::OutputText {
                            text: "hi".to_string(),
                        }],
                        end_turn: Some(true),
                        phase: None,
                    },
                },
                ModelTransportEvent::Completed {
                    request_id: "turn-1".to_string(),
                },
            ]]),
            requests: Mutex::new(Vec::new()),
        };
        let fs = MockFs;
        let collaboration = MockCollaboration;
        let tool_executor = MockToolExecutor {
            tools: vec![crate::host::HostToolSpec {
                tool_name: "search".to_string(),
                tool_namespace: Some("notion".to_string()),
                description: "Search Notion workspace pages".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }),
            }],
            invocations: Mutex::new(Vec::new()),
        };
        let notification_sink = MockNotificationSink;
        let runtime = BrowserRuntime::new(
            &fs,
            &collaboration,
            &instruction_store,
            &model_transport,
            &notification_sink,
            &session_store,
            &tool_executor,
        );

        let result = runtime
            .run_turn(RunTurnRequest {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                input: json!([{
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "Inspect src/lib.rs" },
                    ],
                }]),
                model_payload: json!({ "model": "demo", "input": [] }),
            })
            .await
            .expect("turn should succeed");
        let expected_transport_tools =
            transport_tools_from_host_specs(&browser_builtin_tool_specs(), &tool_executor.tools);

        assert_eq!(
            result.value,
            SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: vec![
                    json!({ "type": "existing" }),
                    json!({
                        "type": "userInput",
                        "turnId": "turn-1",
                        "input": [{
                            "type": "message",
                            "role": "user",
                            "content": [
                                { "type": "input_text", "text": "Inspect src/lib.rs" },
                            ],
                        }],
                    }),
                    json!({
                        "type": "modelDelta",
                        "turnId": "turn-1",
                        "requestId": "turn-1",
                        "payload": { "outputTextDelta": "hi" },
                    }),
                    json!({
                        "type": "modelOutputItem",
                        "turnId": "turn-1",
                        "requestId": "turn-1",
                        "item": {
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "hi",
                                }
                            ],
                            "end_turn": true,
                        },
                    }),
                    json!({
                        "type": "modelCompleted",
                        "turnId": "turn-1",
                        "requestId": "turn-1",
                    }),
                ],
            }
        );
        assert_eq!(
            result.events,
            vec![
                UiEvent::ThreadLoaded(ThreadLoadedEvent {
                    thread_id: "thread-1".to_string(),
                    item_count: 2,
                }),
                UiEvent::TurnStarted(TurnStartedEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                }),
                UiEvent::ModelStarted(ModelStartedUiEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    request_id: "turn-1".to_string(),
                }),
                UiEvent::ModelDelta(ModelDeltaUiEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    request_id: "turn-1".to_string(),
                    payload: json!({ "outputTextDelta": "hi" }),
                }),
                UiEvent::ModelOutputItem(ModelOutputItemUiEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    request_id: "turn-1".to_string(),
                    item: ResponseItem::Message {
                        id: Some("msg-1".to_string()),
                        role: "assistant".to_string(),
                        content: vec![codex_protocol::models::ContentItem::OutputText {
                            text: "hi".to_string(),
                        }],
                        end_turn: Some(true),
                        phase: None,
                    },
                }),
                UiEvent::ModelCompleted(ModelCompletedUiEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                    request_id: "turn-1".to_string(),
                }),
                UiEvent::TurnCompleted(TurnCompletedEvent {
                    thread_id: "thread-1".to_string(),
                    turn_id: "turn-1".to_string(),
                }),
                UiEvent::SessionSaved(SessionSavedEvent {
                    thread_id: "thread-1".to_string(),
                    item_count: 5,
                }),
            ]
        );
        assert_eq!(session_store.saves.lock().expect("lock poisoned").len(), 2);
        assert_eq!(
            model_transport
                .requests
                .lock()
                .expect("lock poisoned")
                .clone(),
            vec![ModelRequest {
                request_id: "turn-1".to_string(),
                payload: json!({
                    "responseInputItems": [
                        {
                            "type": "message",
                            "role": "user",
                            "content": [
                                { "type": "input_text", "text": "Inspect src/lib.rs" },
                            ],
                        },
                    ],
                    "transportPayload": {
                        "model": "demo".to_string(),
                        "instructions": ([
                            DEFAULT_BASE_INSTRUCTIONS.trim(),
                            "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nfollow repo rules\n</INSTRUCTIONS>",
                            "<skill>\n<name>demo-skill</name>\n<path>skills/demo/SKILL.md</path>\nbody\n</skill>",
                        ]
                        .join("\n\n")),
                        "input": [
                            {
                                "type": "message",
                                "role": "user",
                                "content": [
                                    { "type": "input_text", "text": "Inspect src/lib.rs" },
                                ],
                            },
                        ],
                        "tools": expected_transport_tools,
                        "tool_choice": "auto",
                        "parallel_tool_calls": true,
                        "stream": true,
                    },
                }),
            }]
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_turn_restarts_model_after_tool_output() {
        let session_store = MockSessionStore {
            snapshot: Mutex::new(Some(SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/workspace" }),
                items: Vec::new(),
            })),
            saves: Mutex::new(Vec::new()),
        };
        let instruction_store = MockInstructionStore { snapshot: None };
        let model_transport = MockModelTransport {
            event_sequences: Mutex::new(vec![
                vec![
                    ModelTransportEvent::Started {
                        request_id: "turn-1".to_string(),
                    },
                    ModelTransportEvent::OutputItemDone {
                        request_id: "turn-1".to_string(),
                        item: ResponseItem::FunctionCall {
                            id: Some("fc-1".to_string()),
                            name: "read_file".to_string(),
                            namespace: None,
                            arguments: serde_json::json!({
                                "file_path": "/workspace/src/lib.rs",
                                "offset": 1,
                                "limit": 2,
                            })
                            .to_string(),
                            call_id: "call-1".to_string(),
                        },
                    },
                    ModelTransportEvent::Completed {
                        request_id: "turn-1".to_string(),
                    },
                ],
                vec![
                    ModelTransportEvent::Started {
                        request_id: "turn-1:1".to_string(),
                    },
                    ModelTransportEvent::OutputItemDone {
                        request_id: "turn-1:1".to_string(),
                        item: ResponseItem::Message {
                            id: Some("msg-2".to_string()),
                            role: "assistant".to_string(),
                            content: vec![codex_protocol::models::ContentItem::OutputText {
                                text: "Done".to_string(),
                            }],
                            end_turn: Some(true),
                            phase: None,
                        },
                    },
                    ModelTransportEvent::Completed {
                        request_id: "turn-1:1".to_string(),
                    },
                ],
            ]),
            requests: Mutex::new(Vec::new()),
        };
        let fs = MockFs;
        let collaboration = MockCollaboration;
        let tool_executor = MockToolExecutor {
            tools: Vec::new(),
            invocations: Mutex::new(Vec::new()),
        };
        let notification_sink = MockNotificationSink;
        let runtime = BrowserRuntime::new(
            &fs,
            &collaboration,
            &instruction_store,
            &model_transport,
            &notification_sink,
            &session_store,
            &tool_executor,
        );

        let result = runtime
            .run_turn(RunTurnRequest {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                input: json!([{
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "Read the file" },
                    ],
                }]),
                model_payload: json!({ "model": "demo", "input": [] }),
            })
            .await
            .expect("turn should succeed");
        let expected_tool_output = serde_json::to_value(ResponseInputItem::FunctionCallOutput {
            call_id: "call-1".to_string(),
            output: FunctionCallOutputPayload {
                body: FunctionCallOutputBody::Text("L1: fn answer() {\nL2:     42".to_string()),
                success: Some(true),
            },
        })
        .expect("tool output serializes");
        let expected_function_call = serde_json::to_value(ResponseItem::FunctionCall {
            id: Some("fc-1".to_string()),
            name: "read_file".to_string(),
            namespace: None,
            arguments: serde_json::json!({
                "file_path": "/workspace/src/lib.rs",
                "offset": 1,
                "limit": 2,
            })
            .to_string(),
            call_id: "call-1".to_string(),
        })
        .expect("function call serializes");
        let expected_transport_tools =
            transport_tools_from_host_specs(&browser_builtin_tool_specs(), &[]);

        let requests = model_transport
            .requests
            .lock()
            .expect("lock poisoned")
            .clone();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].request_id, "turn-1");
        assert_eq!(requests[1].request_id, "turn-1:1");
        assert_eq!(
            requests[0].payload,
            json!({
                "transportPayload": {
                    "model": "demo".to_string(),
                    "instructions": DEFAULT_BASE_INSTRUCTIONS.trim(),
                    "input": [
                        {
                            "type": "message",
                            "role": "user",
                            "content": [
                                { "type": "input_text", "text": "Read the file" },
                            ],
                        },
                    ],
                    "tools": expected_transport_tools,
                    "tool_choice": "auto",
                    "parallel_tool_calls": true,
                    "stream": true,
                },
                "responseInputItems": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            { "type": "input_text", "text": "Read the file" },
                        ],
                    },
                ],
            })
        );
        assert_eq!(
            requests[1].payload,
            json!({
                "transportPayload": {
                    "model": "demo".to_string(),
                    "instructions": DEFAULT_BASE_INSTRUCTIONS.trim(),
                    "input": [
                        {
                            "type": "message",
                            "role": "user",
                            "content": [
                                { "type": "input_text", "text": "Read the file" },
                            ],
                        },
                        {
                            "type": "function_call",
                            "name": "read_file",
                            "arguments": "{\"file_path\":\"/workspace/src/lib.rs\",\"limit\":2,\"offset\":1}",
                            "call_id": "call-1",
                        },
                        expected_tool_output,
                    ],
                    "tools": expected_transport_tools,
                    "tool_choice": "auto",
                    "parallel_tool_calls": true,
                    "stream": true,
                },
                "responseInputItems": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            { "type": "input_text", "text": "Read the file" },
                        ],
                    },
                    {
                        "type": "function_call",
                        "name": "read_file",
                        "arguments": "{\"file_path\":\"/workspace/src/lib.rs\",\"limit\":2,\"offset\":1}",
                        "call_id": "call-1",
                    },
                    expected_tool_output,
                ],
            })
        );

        assert_eq!(
            result.value.items,
            vec![
                json!({
                    "type": "userInput",
                    "turnId": "turn-1",
                    "input": [{
                        "type": "message",
                        "role": "user",
                        "content": [
                            { "type": "input_text", "text": "Read the file" },
                        ],
                    }],
                }),
                json!({
                    "type": "modelOutputItem",
                    "turnId": "turn-1",
                    "requestId": "turn-1",
                    "item": expected_function_call,
                }),
                json!({
                    "type": "toolOutputItem",
                    "turnId": "turn-1",
                    "requestId": "turn-1",
                    "item": expected_tool_output,
                }),
                json!({
                    "type": "modelCompleted",
                    "turnId": "turn-1",
                    "requestId": "turn-1",
                }),
                json!({
                    "type": "modelOutputItem",
                    "turnId": "turn-1",
                    "requestId": "turn-1:1",
                    "item": {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Done",
                            }
                        ],
                        "end_turn": true,
                    },
                }),
                json!({
                    "type": "modelCompleted",
                    "turnId": "turn-1",
                    "requestId": "turn-1:1",
                }),
            ]
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_turn_invokes_host_custom_tools() {
        let session_store = MockSessionStore {
            snapshot: Mutex::new(Some(SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: Vec::new(),
            })),
            saves: Mutex::new(Vec::new()),
        };
        let instruction_store = MockInstructionStore { snapshot: None };
        let model_transport = MockModelTransport {
            event_sequences: Mutex::new(vec![
                vec![
                    ModelTransportEvent::Started {
                        request_id: "turn-1".to_string(),
                    },
                    ModelTransportEvent::OutputItemDone {
                        request_id: "turn-1".to_string(),
                        item: ResponseItem::FunctionCall {
                            id: Some("fc-1".to_string()),
                            name: "search".to_string(),
                            namespace: Some("notion".to_string()),
                            arguments: json!({
                                "query": "roadmap"
                            })
                            .to_string(),
                            call_id: "call-1".to_string(),
                        },
                    },
                    ModelTransportEvent::Completed {
                        request_id: "turn-1".to_string(),
                    },
                ],
                vec![
                    ModelTransportEvent::Started {
                        request_id: "turn-1:1".to_string(),
                    },
                    ModelTransportEvent::OutputItemDone {
                        request_id: "turn-1:1".to_string(),
                        item: ResponseItem::Message {
                            id: Some("msg-1".to_string()),
                            role: "assistant".to_string(),
                            content: vec![codex_protocol::models::ContentItem::OutputText {
                                text: "Done".to_string(),
                            }],
                            end_turn: Some(true),
                            phase: None,
                        },
                    },
                    ModelTransportEvent::Completed {
                        request_id: "turn-1:1".to_string(),
                    },
                ],
            ]),
            requests: Mutex::new(Vec::new()),
        };
        let fs = MockFs;
        let collaboration = MockCollaboration;
        let tool_executor = MockToolExecutor {
            tools: vec![crate::host::HostToolSpec {
                tool_name: "search".to_string(),
                tool_namespace: Some("notion".to_string()),
                description: "Search Notion workspace pages".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }),
            }],
            invocations: Mutex::new(Vec::new()),
        };
        let notification_sink = MockNotificationSink;
        let runtime = BrowserRuntime::new(
            &fs,
            &collaboration,
            &instruction_store,
            &model_transport,
            &notification_sink,
            &session_store,
            &tool_executor,
        );

        let result = runtime
            .run_turn(RunTurnRequest {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                input: json!([{
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "Search Notion" },
                    ],
                }]),
                model_payload: json!({ "model": "demo", "input": [] }),
            })
            .await
            .expect("turn should succeed");

        assert_eq!(
            tool_executor
                .invocations
                .lock()
                .expect("lock poisoned")
                .clone(),
            vec![ToolInvokeRequest {
                call_id: "call-1".to_string(),
                tool_name: "search".to_string(),
                tool_namespace: Some("notion".to_string()),
                input: json!({
                    "query": "roadmap"
                }),
            }]
        );
        assert!(result.value.items.iter().any(|item| {
            item.get("type") == Some(&json!("toolOutputItem"))
                && item.get("item").and_then(|value| value.get("output"))
                    == Some(&json!("{\n  \"ok\": true,\n  \"tool\": \"search\"\n}"))
        }));
    }

    #[test]
    fn runtime_dispatch_serializes_model_delta_with_nested_payload() {
        let dispatch = RuntimeDispatch {
            value: SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: Vec::new(),
            },
            events: vec![UiEvent::ModelDelta(ModelDeltaUiEvent {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                request_id: "turn-1".to_string(),
                payload: json!({ "outputTextDelta": "hello" }),
            })],
        };

        assert_eq!(
            serde_json::to_value(dispatch).expect("dispatch should serialize"),
            json!({
                "value": {
                    "threadId": "thread-1",
                    "metadata": { "workspaceRoot": "/repo" },
                    "items": [],
                },
                "events": [
                    {
                        "event": "modelDelta",
                        "payload": {
                            "threadId": "thread-1",
                            "turnId": "turn-1",
                            "requestId": "turn-1",
                            "payload": {
                                "outputTextDelta": "hello",
                            },
                        },
                    },
                ],
            })
        );
    }

    #[test]
    fn runtime_dispatch_serializes_model_output_item() {
        let dispatch = RuntimeDispatch {
            value: SessionSnapshot {
                thread_id: "thread-1".to_string(),
                metadata: json!({ "workspaceRoot": "/repo" }),
                items: Vec::new(),
            },
            events: vec![UiEvent::ModelOutputItem(ModelOutputItemUiEvent {
                thread_id: "thread-1".to_string(),
                turn_id: "turn-1".to_string(),
                request_id: "turn-1".to_string(),
                item: ResponseItem::Message {
                    id: Some("msg-1".to_string()),
                    role: "assistant".to_string(),
                    content: vec![codex_protocol::models::ContentItem::OutputText {
                        text: "hello".to_string(),
                    }],
                    end_turn: Some(true),
                    phase: None,
                },
            })],
        };

        assert_eq!(
            serde_json::to_value(dispatch).expect("dispatch should serialize"),
            json!({
                "value": {
                    "threadId": "thread-1",
                    "metadata": { "workspaceRoot": "/repo" },
                    "items": [],
                },
                "events": [
                    {
                        "event": "modelOutputItem",
                        "payload": {
                            "threadId": "thread-1",
                            "turnId": "turn-1",
                            "requestId": "turn-1",
                            "item": {
                                "type": "message",
                                "role": "assistant",
                                "content": [
                                    {
                                        "type": "output_text",
                                        "text": "hello",
                                    }
                                ],
                                "end_turn": true,
                            },
                        },
                    },
                ],
            })
        );
    }
}
