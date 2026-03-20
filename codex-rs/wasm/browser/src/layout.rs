use std::path::Path;
use std::path::PathBuf;

pub(crate) const BROWSER_WORKSPACE_ROOT: &str = "/workspace";

pub(crate) fn browser_workspace_root() -> PathBuf {
    PathBuf::from(BROWSER_WORKSPACE_ROOT)
}

pub(crate) fn normalize_browser_user_cwd(_cwd: &Path) -> PathBuf {
    browser_workspace_root()
}
