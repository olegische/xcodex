//! Browser compatibility shim for the `core` unified exec manager.
//!
//! The browser runtime has no native process execution. This manager is kept
//! only as a mirror contract surface for copied `core` orchestration.

#[derive(Debug, Default)]
pub struct UnifiedExecProcessManager;

impl UnifiedExecProcessManager {
    pub fn new(_timeout: Option<std::time::Duration>) -> Self {
        Self
    }

    pub fn supported(&self) -> bool {
        false
    }

    pub async fn terminate_all_processes(&self) {}
}
