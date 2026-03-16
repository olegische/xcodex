use codex_app_server_protocol::AppInfo;
use codex_app_server_protocol::AppsListResponse;
use codex_app_server_protocol::Model;
use codex_app_server_protocol::ModelAvailabilityNux;
use codex_app_server_protocol::ModelListResponse;
use codex_app_server_protocol::ModelUpgradeInfo;
use codex_app_server_protocol::ReasoningEffortOption;
use codex_app_server_protocol::Thread;
use codex_app_server_protocol::ThreadListResponse;
use codex_app_server_protocol::ThreadLoadedListResponse;
use codex_app_server_protocol::ThreadReadResponse;
use codex_app_server_protocol::ThreadStartedNotification;
use codex_app_server_protocol::ThreadStatus;
use codex_app_server_protocol::Turn;
use codex_app_server_protocol::TurnStartResponse;
use codex_app_server_protocol::TurnStatus;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelPreset;

use crate::state::ThreadRecord;
use crate::state::TurnRecord;

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
