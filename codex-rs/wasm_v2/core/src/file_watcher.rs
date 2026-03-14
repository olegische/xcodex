//! Browser compatibility shim for the `core` file watcher layer.
//!
//! `wasm_v2` does not watch the host filesystem directly. The mirrored runtime
//! still expects this boundary, so we expose a no-op event source instead.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use crate::config::Config;
use crate::skills::SkillsManager;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileWatcherEvent {
    SkillsChanged { paths: Vec<PathBuf> },
}

pub(crate) struct FileWatcher {
    tx: broadcast::Sender<FileWatcherEvent>,
}

pub(crate) struct WatchRegistration;

impl FileWatcher {
    pub(crate) fn new(_codex_home: PathBuf) -> Result<Self, std::io::Error> {
        let (tx, _) = broadcast::channel(16);
        Ok(Self { tx })
    }

    pub(crate) fn noop() -> Self {
        let (tx, _) = broadcast::channel(1);
        Self { tx }
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<FileWatcherEvent> {
        self.tx.subscribe()
    }

    pub(crate) fn register_config(
        self: &Arc<Self>,
        _config: &Config,
        _skills_manager: &SkillsManager,
    ) -> WatchRegistration {
        WatchRegistration
    }

    pub(crate) fn supported(&self) -> bool {
        false
    }
}
