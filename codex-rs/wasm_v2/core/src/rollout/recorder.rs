use std::io::Error as IoError;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use codex_protocol::ThreadId;
use codex_protocol::dynamic_tools::DynamicToolSpec;
use codex_protocol::models::BaseInstructions;
use codex_protocol::protocol::InitialHistory;
use codex_protocol::protocol::ResumedHistory;
use codex_protocol::protocol::RolloutItem;
use codex_protocol::protocol::RolloutLine;
use codex_protocol::protocol::SessionMeta;
use codex_protocol::protocol::SessionMetaLine;
use codex_protocol::protocol::SessionSource;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use super::SESSIONS_SUBDIR;
use super::metadata::ThreadMetadataBuilder;
use super::policy::EventPersistenceMode;
use super::policy::is_persisted_response_item;
use crate::config::Config;

#[derive(Clone)]
pub struct RolloutRecorder {
    pub(crate) rollout_path: PathBuf,
    event_persistence_mode: EventPersistenceMode,
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
        _state_db_ctx: Option<crate::state_db::StateDbHandle>,
        _state_builder: Option<ThreadMetadataBuilder>,
    ) -> std::io::Result<Self> {
        let (rollout_path, event_persistence_mode, session_meta, materialized) = match params {
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
                        timestamp: Utc::now().to_rfc3339(),
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
                (rollout_path, event_persistence_mode, Some(meta), false)
            }
            RolloutRecorderParams::Resume {
                path,
                event_persistence_mode,
            } => (path, event_persistence_mode, None, true),
        };

        Ok(Self {
            rollout_path,
            event_persistence_mode,
            state: Arc::new(Mutex::new(RecorderState {
                session_meta,
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

    pub(crate) async fn load_rollout_items(
        path: &Path,
    ) -> std::io::Result<(Vec<RolloutItem>, Option<ThreadId>, usize)> {
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

fn rollout_path_for_new_session(config: &Config, conversation_id: ThreadId) -> PathBuf {
    let timestamp = Utc::now().format("%Y-%m-%dT%H-%M-%S");
    config
        .codex_home
        .join(SESSIONS_SUBDIR)
        .join(format!("rollout-{timestamp}-{conversation_id}.jsonl"))
}

async fn write_rollout_item(
    file: &mut tokio::fs::File,
    rollout_item: &RolloutItem,
) -> std::io::Result<()> {
    let line = RolloutLine {
        timestamp: Utc::now().to_rfc3339(),
        item: rollout_item.clone(),
    };
    let mut json = serde_json::to_string(&line).map_err(IoError::other)?;
    json.push('\n');
    file.write_all(json.as_bytes()).await?;
    Ok(())
}
