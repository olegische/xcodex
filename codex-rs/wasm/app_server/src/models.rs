use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use codex_app_server_protocol::AppInfo;
use codex_app_server_protocol::AppsListResponse;
use codex_app_server_protocol::Model;
use codex_app_server_protocol::ModelAvailabilityNux;
use codex_app_server_protocol::ModelListResponse;
use codex_app_server_protocol::ModelUpgradeInfo;
use codex_app_server_protocol::ReasoningEffortOption;
use codex_app_server_protocol::Thread;
use codex_app_server_protocol::ThreadActiveFlag;
use codex_app_server_protocol::ThreadListResponse;
use codex_app_server_protocol::ThreadLoadedListResponse;
use codex_app_server_protocol::ThreadReadResponse;
use codex_app_server_protocol::ThreadStartedNotification;
use codex_app_server_protocol::ThreadStatus;
use codex_app_server_protocol::Turn;
use codex_app_server_protocol::TurnError;
use codex_app_server_protocol::TurnStartResponse;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelPreset;
use codex_protocol::protocol::SessionSource;
use codex_wasm_core::codex::Codex;

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

pub fn initialize_user_agent() -> String {
    format!("codex-wasm-app-server/{}", env!("CARGO_PKG_VERSION"))
}

pub fn build_thread(record: &ThreadRecord, include_turns: bool, status: ThreadStatus) -> Thread {
    Thread {
        id: record.id.clone(),
        preview: record.preview.clone(),
        ephemeral: record.ephemeral,
        model_provider: record.model_provider.clone(),
        created_at: record.created_at,
        updated_at: record.updated_at,
        status,
        path: None,
        cwd: record.cwd.clone(),
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        source: record.source.clone().into(),
        agent_nickname: None,
        agent_role: None,
        git_info: None,
        name: record.name.clone(),
        turns: if include_turns {
            record
                .turns
                .values()
                .cloned()
                .map(turn_to_protocol)
                .collect()
        } else {
            Vec::new()
        },
    }
}

#[allow(dead_code)]
pub fn thread_started_notification(
    record: &ThreadRecord,
    status: ThreadStatus,
) -> codex_app_server_protocol::ServerNotification {
    codex_app_server_protocol::ServerNotification::ThreadStarted(ThreadStartedNotification {
        thread: build_thread(record, false, status),
    })
}

pub fn thread_read_response(
    record: &ThreadRecord,
    status: ThreadStatus,
    include_turns: bool,
) -> ThreadReadResponse {
    ThreadReadResponse {
        thread: build_thread(record, include_turns, status),
    }
}

pub fn thread_list_response(data: Vec<Thread>) -> ThreadListResponse {
    ThreadListResponse {
        data,
        next_cursor: None,
    }
}

pub fn thread_loaded_list_response(data: Vec<String>) -> ThreadLoadedListResponse {
    ThreadLoadedListResponse {
        data,
        next_cursor: None,
    }
}

pub fn map_model_list(models: Vec<ModelInfo>, include_hidden: bool) -> ModelListResponse {
    let mut presets = models
        .into_iter()
        .map(ModelPreset::from)
        .collect::<Vec<_>>();
    ModelPreset::mark_default_by_picker_visibility(&mut presets);
    let data = presets
        .into_iter()
        .filter(|preset| include_hidden || preset.show_in_picker)
        .map(|preset| Model {
            id: preset.id.clone(),
            model: preset.model.clone(),
            upgrade: preset.upgrade.as_ref().map(|upgrade| upgrade.id.clone()),
            upgrade_info: preset.upgrade.map(|upgrade| ModelUpgradeInfo {
                model: upgrade.id,
                upgrade_copy: upgrade.upgrade_copy,
                model_link: upgrade.model_link,
                migration_markdown: upgrade.migration_markdown,
            }),
            availability_nux: preset.availability_nux.map(|nux| ModelAvailabilityNux {
                message: nux.message,
            }),
            display_name: preset.display_name,
            description: preset.description,
            hidden: !preset.show_in_picker,
            supported_reasoning_efforts: preset
                .supported_reasoning_efforts
                .into_iter()
                .map(|effort| ReasoningEffortOption {
                    reasoning_effort: effort.effort,
                    description: effort.description,
                })
                .collect(),
            default_reasoning_effort: preset.default_reasoning_effort,
            input_modalities: preset.input_modalities,
            supports_personality: preset.supports_personality,
            is_default: preset.is_default,
        })
        .collect();
    ModelListResponse {
        data,
        next_cursor: None,
    }
}

pub fn map_apps_list(apps: Vec<AppInfo>) -> AppsListResponse {
    AppsListResponse {
        data: apps,
        next_cursor: None,
    }
}

pub fn turn_start_response(turn_id: String) -> TurnStartResponse {
    TurnStartResponse {
        turn: Turn {
            id: turn_id,
            items: Vec::new(),
            status: TurnStatus::InProgress,
            error: None,
        },
    }
}

pub fn turn_to_protocol(turn: TurnRecord) -> Turn {
    Turn {
        id: turn.id,
        items: turn.items,
        status: turn.status,
        error: turn.error,
    }
}
