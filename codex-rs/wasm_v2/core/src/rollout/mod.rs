//! Rollout module: persistence and discovery of session rollout files.

use codex_protocol::protocol::SessionSource;

pub const SESSIONS_SUBDIR: &str = "sessions";
pub const ARCHIVED_SESSIONS_SUBDIR: &str = "archived_sessions";
pub const INTERACTIVE_SESSION_SOURCES: &[SessionSource] =
    &[SessionSource::Cli, SessionSource::VSCode];

pub(crate) mod error;
pub mod list;
pub(crate) mod metadata;
pub(crate) mod policy;
pub mod recorder;
pub(crate) mod session_index;

pub(crate) use error::map_session_init_error;
pub(crate) use recorder::RolloutRecorder;
pub(crate) use recorder::RolloutRecorderParams;
