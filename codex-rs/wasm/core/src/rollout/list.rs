use std::path::Path;
use std::path::PathBuf;

pub async fn find_thread_path_by_id_str(
    _codex_home: &Path,
    _thread_id: &str,
) -> std::io::Result<Option<PathBuf>> {
    Ok(None)
}

pub async fn find_archived_thread_path_by_id_str(
    _codex_home: &Path,
    _thread_id: &str,
) -> std::io::Result<Option<PathBuf>> {
    Ok(None)
}

pub fn rollout_date_parts(_path: &Path) -> Option<(i32, u8, u8)> {
    None
}
