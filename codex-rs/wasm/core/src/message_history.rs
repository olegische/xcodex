pub use codex_protocol::message_history::HistoryEntry;

use std::io::Result;

use codex_protocol::ThreadId;

pub async fn append_entry(
    _text: &str,
    _conversation_id: &ThreadId,
    _config: &crate::config::Config,
) -> Result<()> {
    Ok(())
}

pub async fn history_metadata(_config: &crate::config::Config) -> Result<(u64, usize)> {
    Ok((0, 0))
}

pub async fn lookup(
    _log_id: &str,
    _offset: i64,
    _config: &crate::config::Config,
) -> Result<Vec<HistoryEntry>> {
    Ok(Vec::new())
}
