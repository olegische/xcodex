use std::io::Error as IoError;
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use codex_protocol::ThreadId;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use codex_protocol::models::BaseInstructions;
use codex_protocol::protocol::InitialHistory;
use codex_protocol::protocol::ResumedHistory;
use codex_protocol::protocol::RolloutItem;
#[cfg(not(target_arch = "wasm32"))]
use codex_protocol::protocol::RolloutLine;
use codex_protocol::protocol::SessionMeta;
use codex_protocol::protocol::SessionMetaLine;
use codex_protocol::protocol::SessionSource;
#[cfg(not(target_arch = "wasm32"))]
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::SESSIONS_SUBDIR;
use super::metadata::ThreadMetadataBuilder;
use super::policy::EventPersistenceMode;
use super::policy::is_persisted_response_item;
use crate::LoadThreadSessionRequest;
#[cfg(target_arch = "wasm32")]
use crate::SaveThreadSessionRequest;
use crate::StoredThreadSession;
use crate::StoredThreadSessionMetadata;
use crate::ThreadStorageHost;
use crate::config::Config;

#[derive(Clone)]
pub struct RolloutRecorder {
    pub(crate) rollout_path: PathBuf,
    event_persistence_mode: EventPersistenceMode,
    thread_storage_host: Arc<dyn ThreadStorageHost>,
    state: Arc<Mutex<RecorderState>>,
}

#[derive(Clone)]
pub enum RolloutRecorderParams {
    Create {
        conversation_id: ThreadId,
        forked_from_id: Option<ThreadId>,
        source: SessionSource,
        base_instructions: BaseInstructions,
        dynamic_tools: Vec<DynamicToolSpec>,
        event_persistence_mode: EventPersistenceMode,
    },
    Resume {
        path: PathBuf,
        event_persistence_mode: EventPersistenceMode,
    },
}

#[derive(Default)]
struct RecorderState {
    session_meta: Option<SessionMetaLine>,
    thread_name: Option<String>,
    persisted_items: Vec<RolloutItem>,
    buffered_items: Vec<RolloutItem>,
    materialized: bool,
}

impl RolloutRecorderParams {
    pub fn new(
        conversation_id: ThreadId,
        forked_from_id: Option<ThreadId>,
        source: SessionSource,
        base_instructions: BaseInstructions,
        dynamic_tools: Vec<DynamicToolSpec>,
        event_persistence_mode: EventPersistenceMode,
    ) -> Self {
        Self::Create {
            conversation_id,
            forked_from_id,
            source,
            base_instructions,
            dynamic_tools,
            event_persistence_mode,
        }
    }

    pub fn resume(path: PathBuf, event_persistence_mode: EventPersistenceMode) -> Self {
        Self::Resume {
            path,
            event_persistence_mode,
        }
    }
}

impl RolloutRecorder {
    pub async fn new(
        config: &Config,
        params: RolloutRecorderParams,
        thread_storage_host: Arc<dyn ThreadStorageHost>,
        _state_db_ctx: Option<crate::state_db::StateDbHandle>,
        _state_builder: Option<ThreadMetadataBuilder>,
    ) -> std::io::Result<Self> {
        let (
            rollout_path,
            event_persistence_mode,
            session_meta,
            thread_name,
            persisted_items,
            materialized,
        ) = match params {
            RolloutRecorderParams::Create {
                conversation_id,
                forked_from_id,
                source,
                base_instructions,
                dynamic_tools,
                event_persistence_mode,
            } => {
                let rollout_path = rollout_path_for_new_session(config, conversation_id);
                let meta = SessionMetaLine {
                    meta: SessionMeta {
                        id: conversation_id,
                        forked_from_id,
                        timestamp: crate::time::now_rfc3339(),
                        cwd: config.codex_home.clone(),
                        originator: "wasm_v2".to_string(),
                        cli_version: env!("CARGO_PKG_VERSION").to_string(),
                        source,
                        agent_nickname: None,
                        agent_role: None,
                        model_provider: None,
                        base_instructions: Some(base_instructions),
                        dynamic_tools: if dynamic_tools.is_empty() {
                            None
                        } else {
                            Some(dynamic_tools)
                        },
                        memory_mode: None,
                    },
                    git: None,
                };
                (
                    rollout_path,
                    event_persistence_mode,
                    Some(meta),
                    None,
                    Vec::new(),
                    false,
                )
            }
            RolloutRecorderParams::Resume {
                path,
                event_persistence_mode,
            } => {
                let stored_session =
                    load_persisted_session(&thread_storage_host, path.as_path()).await?;
                (
                    path,
                    event_persistence_mode,
                    None,
                    stored_session.metadata.name,
                    stored_session.items,
                    true,
                )
            }
        };

        Ok(Self {
            rollout_path,
            event_persistence_mode,
            thread_storage_host,
            state: Arc::new(Mutex::new(RecorderState {
                session_meta,
                thread_name,
                persisted_items,
                buffered_items: Vec::new(),
                materialized,
            })),
        })
    }

    pub fn rollout_path(&self) -> &Path {
        self.rollout_path.as_path()
    }

    pub(crate) async fn record_items(&self, items: &[RolloutItem]) -> std::io::Result<()> {
        let filtered: Vec<RolloutItem> = items
            .iter()
            .filter(|item| is_persisted_response_item(item, self.event_persistence_mode))
            .cloned()
            .collect();
        if filtered.is_empty() {
            return Ok(());
        }

        let should_write = {
            let mut state = self.state.lock().await;
            state.buffered_items.extend(filtered.clone());
            state.materialized
        };
        if should_write {
            self.write_buffered().await?;
        }
        Ok(())
    }

    pub async fn persist(&self) -> std::io::Result<()> {
        {
            let mut state = self.state.lock().await;
            state.materialized = true;
        }
        self.write_buffered().await
    }

    pub async fn flush(&self) -> std::io::Result<()> {
        self.write_buffered().await
    }

    pub async fn shutdown(&self) -> std::io::Result<()> {
        self.flush().await
    }

    pub async fn set_thread_name(&self, thread_name: Option<String>) {
        let mut state = self.state.lock().await;
        state.thread_name = thread_name;
    }

    pub async fn load_history(&self) -> std::io::Result<InitialHistory> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return Self::get_rollout_history(self.rollout_path.as_path()).await;
        }

        #[cfg(target_arch = "wasm32")]
        {
            let (items, thread_id) = {
                let state = self.state.lock().await;
                let items = all_items(&state);
                let thread_id = thread_id_from_items(items.as_slice());
                (items, thread_id)
            };
            let Some(conversation_id) = thread_id else {
                return Err(IoError::other(
                    "failed to parse thread ID from rollout state",
                ));
            };
            Ok(InitialHistory::Resumed(ResumedHistory {
                conversation_id,
                history: items,
                rollout_path: self.rollout_path.clone(),
            }))
        }
    }

    pub(crate) async fn load_rollout_items(
        path: &Path,
    ) -> std::io::Result<(Vec<RolloutItem>, Option<ThreadId>, usize)> {
        #[cfg(target_arch = "wasm32")]
        {
            let _ = path;
            return Err(IoError::new(
                std::io::ErrorKind::Unsupported,
                "rollout file loading is not available in wasm32",
            ));
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let text = tokio::fs::read_to_string(path).await?;
            if text.trim().is_empty() {
                return Err(IoError::other("empty session file"));
            }

            let mut items = Vec::new();
            let mut thread_id = None;
            let mut parse_errors = 0usize;

            for line in text.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<RolloutLine>(line) {
                    Ok(rollout_line) => {
                        if let RolloutItem::SessionMeta(session_meta_line) = &rollout_line.item
                            && thread_id.is_none()
                        {
                            thread_id = Some(session_meta_line.meta.id);
                        }
                        items.push(rollout_line.item);
                    }
                    Err(_) => {
                        parse_errors = parse_errors.saturating_add(1);
                    }
                }
            }

            Ok((items, thread_id, parse_errors))
        }
    }

    pub async fn get_rollout_history(path: &Path) -> std::io::Result<InitialHistory> {
        let (items, thread_id, _) = Self::load_rollout_items(path).await?;
        let Some(conversation_id) = thread_id else {
            return Err(IoError::other(
                "failed to parse thread ID from rollout file",
            ));
        };

        Ok(InitialHistory::Resumed(ResumedHistory {
            conversation_id,
            history: items,
            rollout_path: path.to_path_buf(),
        }))
    }

    async fn write_buffered(&self) -> std::io::Result<()> {
        #[cfg(target_arch = "wasm32")]
        {
            let mut state = self.state.lock().await;
            if !state.materialized {
                return Ok(());
            }
            let items = all_items(&state);
            let Some(thread_id) = thread_id_from_items(items.as_slice()) else {
                return Err(IoError::other(
                    "failed to parse thread ID from rollout state",
                ));
            };
            let metadata = build_stored_session_metadata(
                &self.rollout_path,
                items.as_slice(),
                state.session_meta.as_ref(),
                state.thread_name.as_deref(),
            );
            self.thread_storage_host
                .save_thread_session(SaveThreadSessionRequest {
                    session: StoredThreadSession { metadata, items },
                })
                .await
                .map_err(host_error_to_io_error)?;
            let session_meta = state.session_meta.take().map(RolloutItem::SessionMeta);
            if let Some(session_meta) = session_meta {
                state.persisted_items.push(session_meta);
            }
            state.persisted_items.append(&mut state.buffered_items);
            return Ok(());
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let (session_meta, items, should_write) = {
                let mut state = self.state.lock().await;
                if !state.materialized {
                    return Ok(());
                }
                let items = std::mem::take(&mut state.buffered_items);
                let session_meta = state.session_meta.take();
                let should_write = session_meta.is_some() || !items.is_empty();
                (session_meta, items, should_write)
            };

            if !should_write {
                return Ok(());
            }

            if let Some(parent) = self.rollout_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.rollout_path)
                .await?;

            if let Some(session_meta) = session_meta {
                let item = RolloutItem::SessionMeta(session_meta);
                write_rollout_item(&mut file, &item).await?;
            }
            for item in &items {
                write_rollout_item(&mut file, item).await?;
            }
            file.flush().await?;
            Ok(())
        }
    }
}

fn rollout_path_for_new_session(config: &Config, conversation_id: ThreadId) -> PathBuf {
    let timestamp = crate::time::now_utc().format("%Y-%m-%dT%H-%M-%S");
    config
        .codex_home
        .join(SESSIONS_SUBDIR)
        .join(format!("rollout-{timestamp}-{conversation_id}.jsonl"))
}

async fn load_persisted_session(
    thread_storage_host: &Arc<dyn ThreadStorageHost>,
    path: &Path,
) -> std::io::Result<StoredThreadSession> {
    if let Some(thread_id) = thread_id_from_rollout_path(path)
        && let Ok(response) = thread_storage_host
            .load_thread_session(LoadThreadSessionRequest {
                thread_id: thread_id.to_string(),
            })
            .await
    {
        return Ok(response.session);
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let (items, thread_id, _) = RolloutRecorder::load_rollout_items(path).await?;
        let Some(thread_id) = thread_id else {
            return Err(IoError::new(
                ErrorKind::InvalidInput,
                format!(
                    "failed to derive thread id from rollout path `{}`",
                    path.display()
                ),
            ));
        };
        let metadata = build_stored_session_metadata(path, &items, None, None);
        Ok(StoredThreadSession {
            metadata: StoredThreadSessionMetadata {
                thread_id: thread_id.to_string(),
                ..metadata
            },
            items,
        })
    }

    #[cfg(target_arch = "wasm32")]
    {
        Err(IoError::new(
            ErrorKind::InvalidInput,
            format!(
                "failed to derive thread id from rollout path `{}`",
                path.display()
            ),
        ))
    }
}

fn all_items(state: &RecorderState) -> Vec<RolloutItem> {
    let mut items = state.persisted_items.clone();
    if let Some(session_meta) = state.session_meta.clone() {
        items.insert(0, RolloutItem::SessionMeta(session_meta));
    }
    items.extend(state.buffered_items.clone());
    items
}

fn thread_id_from_items(items: &[RolloutItem]) -> Option<ThreadId> {
    items.iter().find_map(|item| match item {
        RolloutItem::SessionMeta(session_meta) => Some(session_meta.meta.id),
        _ => None,
    })
}

fn thread_id_from_rollout_path(path: &Path) -> Option<ThreadId> {
    let file_name = path.file_name()?.to_string_lossy();
    let thread_id = file_name.strip_prefix("rollout-")?.strip_suffix(".jsonl")?;
    let thread_id = thread_id.get(20..)?;
    ThreadId::from_string(thread_id).ok()
}

fn build_stored_session_metadata(
    rollout_path: &Path,
    items: &[RolloutItem],
    pending_session_meta: Option<&SessionMetaLine>,
    thread_name: Option<&str>,
) -> StoredThreadSessionMetadata {
    let session_meta = pending_session_meta
        .cloned()
        .or_else(|| {
            items.iter().find_map(|item| match item {
                RolloutItem::SessionMeta(session_meta) => Some(session_meta.clone()),
                _ => None,
            })
        })
        .unwrap_or_else(|| SessionMetaLine {
            meta: SessionMeta {
                id: ThreadId::default(),
                forked_from_id: None,
                timestamp: crate::time::now_rfc3339(),
                cwd: PathBuf::new(),
                originator: "wasm_v2".to_string(),
                cli_version: env!("CARGO_PKG_VERSION").to_string(),
                source: SessionSource::Unknown,
                agent_nickname: None,
                agent_role: None,
                model_provider: None,
                base_instructions: None,
                dynamic_tools: None,
                memory_mode: None,
            },
            git: None,
        });

    StoredThreadSessionMetadata {
        thread_id: session_meta.meta.id.to_string(),
        rollout_id: rollout_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| rollout_path.display().to_string()),
        created_at: timestamp_to_unix_seconds(session_meta.meta.timestamp.as_str()),
        updated_at: crate::time::now_unix_seconds(),
        archived: false,
        name: thread_name.map(str::to_owned),
        preview: preview_from_items(items),
        cwd: session_meta.meta.cwd.to_string_lossy().to_string(),
        model_provider: session_meta.meta.model_provider.unwrap_or_default(),
    }
}

fn preview_from_items(items: &[RolloutItem]) -> String {
    codex_app_server_protocol::build_turns_from_rollout_items(items)
        .into_iter()
        .flat_map(|turn| turn.items.into_iter())
        .find_map(|item| match item {
            codex_app_server_protocol::ThreadItem::UserMessage { content, .. } => {
                content.into_iter().find_map(|input| match input {
                    codex_app_server_protocol::UserInput::Text { text, .. } => Some(text),
                    codex_app_server_protocol::UserInput::Image { .. }
                    | codex_app_server_protocol::UserInput::LocalImage { .. }
                    | codex_app_server_protocol::UserInput::Skill { .. }
                    | codex_app_server_protocol::UserInput::Mention { .. } => None,
                })
            }
            _ => None,
        })
        .unwrap_or_default()
}

fn timestamp_to_unix_seconds(timestamp: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .map(|value| value.timestamp())
        .unwrap_or_else(|_| crate::time::now_unix_seconds())
}

fn host_error_to_io_error(error: crate::HostError) -> IoError {
    IoError::other(error.message)
}

#[cfg(not(target_arch = "wasm32"))]
async fn write_rollout_item(
    file: &mut tokio::fs::File,
    rollout_item: &RolloutItem,
) -> std::io::Result<()> {
    let line = RolloutLine {
        timestamp: crate::time::now_rfc3339(),
        item: rollout_item.clone(),
    };
    let mut json = serde_json::to_string(&line).map_err(IoError::other)?;
    json.push('\n');
    file.write_all(json.as_bytes()).await?;
    Ok(())
}
