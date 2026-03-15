use std::path::PathBuf;

use codex_protocol::config_types::WindowsSandboxLevel;
use codex_protocol::protocol::SandboxPolicy;

#[derive(Clone, Debug)]
pub(crate) struct TurnMetadataState {
    header: String,
    _cwd: PathBuf,
    _sandbox_policy: SandboxPolicy,
    _windows_sandbox_level: WindowsSandboxLevel,
}

impl TurnMetadataState {
    pub(crate) fn new(
        turn_id: String,
        cwd: PathBuf,
        sandbox_policy: &SandboxPolicy,
        windows_sandbox_level: WindowsSandboxLevel,
    ) -> Self {
        Self {
            header: serde_json::json!({ "turn_id": turn_id }).to_string(),
            _cwd: cwd,
            _sandbox_policy: sandbox_policy.clone(),
            _windows_sandbox_level: windows_sandbox_level,
        }
    }

    pub(crate) fn current_header_value(&self) -> Option<String> {
        Some(self.header.clone())
    }

    pub(crate) fn spawn_git_enrichment_task(&self) {}

    pub(crate) fn cancel_git_enrichment_task(&self) {}
}
