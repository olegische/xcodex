use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_channel::Receiver;
use async_channel::Sender;
use codex_app_server_protocol::RequestId;
use codex_app_server_protocol::ThreadStatus;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::protocol::SessionSource;
use codex_wasm_v2_app_server::InProcessThreadHandle;
use codex_wasm_v2_app_server::InProcessTurnRecord;
use codex_wasm_v2_app_server::MessageProcessor;
use codex_wasm_v2_app_server::PendingServerRequest;
use codex_wasm_v2_core::CodexAuth;
use codex_wasm_v2_core::HostFs;
use codex_wasm_v2_core::ModelTransportHost;
use codex_wasm_v2_core::codex::Codex;
use codex_wasm_v2_core::config::Config;
use codex_wasm_v2_core::connectors::DiscoverableAppsProvider;

#[derive(Clone)]
pub struct RuntimeBootstrap {
    pub config: Config,
    pub auth: Option<CodexAuth>,
    pub model_catalog: Option<codex_protocol::openai_models::ModelsResponse>,
    pub browser_fs: Arc<dyn HostFs>,
    pub discoverable_apps_provider: Arc<dyn DiscoverableAppsProvider>,
    pub model_transport_host: Arc<dyn ModelTransportHost>,
}

pub struct RuntimeState {
    pub initialized: bool,
    pub bootstrap: Option<RuntimeBootstrap>,
    pub threads: HashMap<String, LoadedThread>,
    pub next_server_request_id: i64,
    pub outgoing_tx: Sender<codex_app_server_protocol::JSONRPCMessage>,
    pub outgoing_rx: Receiver<codex_app_server_protocol::JSONRPCMessage>,
    pub pending_server_requests: HashMap<RequestId, PendingServerRequest>,
}

impl RuntimeState {
    pub fn new(
        outgoing_tx: Sender<codex_app_server_protocol::JSONRPCMessage>,
        outgoing_rx: Receiver<codex_app_server_protocol::JSONRPCMessage>,
    ) -> Self {
        Self {
            initialized: false,
            bootstrap: None,
            threads: HashMap::new(),
            next_server_request_id: 1,
            outgoing_tx,
            outgoing_rx,
            pending_server_requests: HashMap::new(),
        }
    }

    pub fn next_request_id(&mut self) -> RequestId {
        let id = self.next_server_request_id;
        self.next_server_request_id += 1;
        RequestId::Integer(id)
    }
}

pub struct LoadedThread {
    pub app_server: MessageProcessor,
    pub codex: Arc<Codex>,
    pub record: ThreadRecord,
}

pub struct ThreadRecord {
    pub id: String,
    pub preview: String,
    pub ephemeral: bool,
    pub model_provider: String,
    pub cwd: PathBuf,
    pub source: SessionSource,
    pub name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub turns: BTreeMap<String, TurnRecord>,
    pub active_turn_id: Option<String>,
    pub waiting_on_approval: bool,
    pub waiting_on_user_input: bool,
}

impl ThreadRecord {
    pub fn protocol_status(&self) -> ThreadStatus {
        if self.active_turn_id.is_some() {
            let mut active_flags = Vec::new();
            if self.waiting_on_approval {
                active_flags.push(codex_app_server_protocol::ThreadActiveFlag::WaitingOnApproval);
            }
            if self.waiting_on_user_input {
                active_flags.push(codex_app_server_protocol::ThreadActiveFlag::WaitingOnUserInput);
            }
            return ThreadStatus::Active { active_flags };
        }
        ThreadStatus::Idle
    }

    pub fn in_process_thread_handle(&self) -> InProcessThreadHandle {
        InProcessThreadHandle {
            active_turn_id: self.active_turn_id.clone(),
            waiting_on_approval: self.waiting_on_approval,
            waiting_on_user_input: self.waiting_on_user_input,
            turns: self
                .turns
                .iter()
                .map(|(id, turn)| {
                    (
                        id.clone(),
                        InProcessTurnRecord {
                            id: turn.id.clone(),
                            items: turn.items.clone(),
                            status: turn.status.clone(),
                            error: turn.error.clone(),
                        },
                    )
                })
                .collect(),
        }
    }

    pub fn apply_in_process_thread_handle(&mut self, thread: InProcessThreadHandle) {
        self.active_turn_id = thread.active_turn_id;
        self.waiting_on_approval = thread.waiting_on_approval;
        self.waiting_on_user_input = thread.waiting_on_user_input;
        self.turns = thread
            .turns
            .into_iter()
            .map(|(id, turn)| {
                (
                    id,
                    TurnRecord {
                        id: turn.id,
                        items: turn.items,
                        status: turn.status,
                        error: turn.error,
                    },
                )
            })
            .collect();
    }
}

#[derive(Clone)]
pub struct TurnRecord {
    pub id: String,
    pub items: Vec<codex_app_server_protocol::ThreadItem>,
    pub status: TurnStatus,
    pub error: Option<TurnError>,
}
