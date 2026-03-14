//! Browser-only compatibility shim for `core/src/windows_sandbox.rs`.
//!
//! `wasm_v2` never enables any Windows sandbox behavior. The mirrored runtime
//! still references this module, so we keep the same extension point but force
//! the effective level to `Disabled`.

use codex_protocol::config_types::WindowsSandboxLevel;

pub trait WindowsSandboxLevelExt {
    fn from_config(_config: &crate::config::Config) -> WindowsSandboxLevel;
    fn from_features(_features: &crate::features::ManagedFeatures) -> WindowsSandboxLevel;
    fn enabled(self) -> bool;
}

impl WindowsSandboxLevelExt for WindowsSandboxLevel {
    fn from_config(_config: &crate::config::Config) -> WindowsSandboxLevel {
        WindowsSandboxLevel::Disabled
    }

    fn from_features(_features: &crate::features::ManagedFeatures) -> WindowsSandboxLevel {
        WindowsSandboxLevel::Disabled
    }

    fn enabled(self) -> bool {
        let _ = self;
        false
    }
}

pub fn windows_sandbox_level_from_config(_config: &crate::config::Config) -> WindowsSandboxLevel {
    WindowsSandboxLevel::Disabled
}

pub fn windows_sandbox_level_from_features(
    _features: &crate::features::ManagedFeatures,
) -> WindowsSandboxLevel {
    WindowsSandboxLevel::Disabled
}
