use std::collections::HashMap;
use std::sync::Arc;

use async_channel::Receiver;
use async_channel::Sender;
use codex_app_server_protocol::RequestId;
use codex_wasm_v2_app_server::ApiVersion;
use codex_wasm_v2_app_server::MessageProcessor;
use codex_wasm_v2_app_server::MessageProcessorArgs;
use codex_wasm_v2_core::codex::Codex;
use tokio::sync::Mutex;

pub struct RuntimeState {
    pub initialized: bool,
    pub bootstrap: Option<RuntimeBootstrap>,
    pub threads: HashMap<String, LoadedThread>,
    pub app_server: Arc<Mutex<MessageProcessor>>,
    pub next_server_request_id: i64,
    pub outgoing_tx: Sender<codex_app_server_protocol::JSONRPCMessage>,
    pub outgoing_rx: Receiver<codex_app_server_protocol::JSONRPCMessage>,
    pub pending_server_request_threads: HashMap<RequestId, String>,
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
            app_server: Arc::new(Mutex::new(MessageProcessor::new(MessageProcessorArgs {
                api_version: ApiVersion::V2,
                config_warnings: Vec::new(),
            }))),
            next_server_request_id: 1,
            outgoing_tx,
            outgoing_rx,
            pending_server_request_threads: HashMap::new(),
        }
    }

    pub fn next_request_id(&mut self) -> RequestId {
        let id = self.next_server_request_id;
        self.next_server_request_id += 1;
        RequestId::Integer(id)
    }
}

pub struct LoadedThread {
    pub app_server: Arc<Mutex<MessageProcessor>>,
    pub codex: Arc<Codex>,
    pub record: ThreadRecord,
}

pub type RuntimeBootstrap = codex_wasm_v2_app_server::RuntimeBootstrap;
pub type ThreadRecord = codex_wasm_v2_app_server::ThreadRecord;
pub type TurnRecord = codex_wasm_v2_app_server::TurnRecord;
