use std::path::PathBuf;
use std::sync::Arc;

use codex_otel::SessionTelemetry;
use codex_protocol::ThreadId;
use tokio::sync::watch;

use crate::shell::Shell;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellSnapshot {
    pub path: PathBuf,
    pub cwd: PathBuf,
}

impl ShellSnapshot {
    pub fn start_snapshotting(
        _codex_home: PathBuf,
        _session_id: ThreadId,
        session_cwd: PathBuf,
        shell: &mut Shell,
        _session_telemetry: SessionTelemetry,
    ) -> watch::Sender<Option<Arc<ShellSnapshot>>> {
        let (tx, rx) = watch::channel(Some(Arc::new(ShellSnapshot {
            path: session_cwd.join(".shell-snapshot"),
            cwd: session_cwd,
        })));
        shell.shell_snapshot = rx;
        tx
    }

    pub fn refresh_snapshot(
        _codex_home: PathBuf,
        _session_id: ThreadId,
        session_cwd: PathBuf,
        _shell: Shell,
        shell_snapshot_tx: watch::Sender<Option<Arc<ShellSnapshot>>>,
        _session_telemetry: SessionTelemetry,
    ) {
        let _ = shell_snapshot_tx.send(Some(Arc::new(ShellSnapshot {
            path: session_cwd.join(".shell-snapshot"),
            cwd: session_cwd,
        })));
    }
}
