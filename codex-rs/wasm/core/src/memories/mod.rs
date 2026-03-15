pub mod citations;
pub mod prompts;

use std::sync::Arc;

use codex_protocol::protocol::SessionSource;

use crate::codex::Session;

pub fn start_memories_startup_task(
    _sess: &Session,
    _config: Arc<crate::config::Config>,
    _session_source: &SessionSource,
) {
}

pub fn memory_root(codex_home: &std::path::Path) -> std::path::PathBuf {
    codex_home.join("memories")
}

pub async fn clear_memory_root_contents(_memory_root: &std::path::Path) -> anyhow::Result<()> {
    Ok(())
}
