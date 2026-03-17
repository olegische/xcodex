//! Browser compatibility shim for `core` exec request/result types.
//!
//! These types stay in `wasm` only because copied `core` orchestration and
//! tests reference the same contract. No local process execution exists here.

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StreamOutput {
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExecParams {
    pub command: Vec<String>,
    pub cwd: std::path::PathBuf,
    pub expiration: ExecExpiration,
    pub env: std::collections::HashMap<String, String>,
    pub network: Option<String>,
    pub sandbox_permissions: codex_protocol::models::SandboxPermissions,
    pub windows_sandbox_level: codex_protocol::config_types::WindowsSandboxLevel,
    pub justification: Option<String>,
    pub arg0: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExecToolCallOutput {
    pub exit_code: i32,
    pub stdout: StreamOutput,
    pub stderr: StreamOutput,
    pub aggregated_output: StreamOutput,
    pub duration: std::time::Duration,
    pub timed_out: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ExecExpiration {
    timeout_ms: Option<u64>,
}

impl ExecExpiration {
    pub fn timeout_ms(self) -> Option<u64> {
        self.timeout_ms
    }
}

impl From<Option<u64>> for ExecExpiration {
    fn from(timeout_ms: Option<u64>) -> Self {
        Self { timeout_ms }
    }
}

impl From<u64> for ExecExpiration {
    fn from(timeout_ms: u64) -> Self {
        Self {
            timeout_ms: Some(timeout_ms),
        }
    }
}

impl StreamOutput {
    pub fn new(text: String) -> Self {
        Self { text }
    }
}
