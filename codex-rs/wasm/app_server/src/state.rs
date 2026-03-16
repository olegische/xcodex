use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use codex_app_server_protocol::AppInfo;
use codex_app_server_protocol::ThreadActiveFlag;
use codex_app_server_protocol::ThreadStatus;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::protocol::SessionSource;
use codex_wasm_v2_core::codex::Codex;

use crate::InProcessThreadHandle;
use crate::InProcessTurnRecord;

#[derive(Default, Clone)]
pub struct AppServerState {
    pub threads: BTreeMap<String, ThreadRecord>,
    pub running_threads: BTreeMap<String, Arc<Codex>>,
    pub models: Vec<ModelInfo>,
    pub apps: Vec<AppInfo>,
}

impl AppServerState {
    pub fn upsert_thread(&mut self, thread: ThreadRecord) {
        self.threads.insert(thread.id.clone(), thread);
    }

    pub fn upsert_loaded_thread(&mut self, loaded_thread: LoadedThread) {
        self.running_threads.insert(
            loaded_thread.record.id.clone(),
            Arc::clone(&loaded_thread.codex),
        );
        self.upsert_thread(loaded_thread.record);
    }

    pub fn thread(&self, thread_id: &str) -> Option<&ThreadRecord> {
        self.threads.get(thread_id)
    }

    pub fn running_thread(&self, thread_id: &str) -> Option<Arc<Codex>> {
        self.running_threads.get(thread_id).cloned()
    }

    pub fn loaded_thread_ids(&self) -> Vec<String> {
        self.running_threads.keys().cloned().collect()
    }
}

#[derive(Clone)]
pub struct LoadedThread {
    pub codex: Arc<Codex>,
    pub record: ThreadRecord,
}

#[derive(Clone)]
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
    pub archived: bool,
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
                active_flags.push(ThreadActiveFlag::WaitingOnApproval);
            }
            if self.waiting_on_user_input {
                active_flags.push(ThreadActiveFlag::WaitingOnUserInput);
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
