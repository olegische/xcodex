use anyhow::Result;
use std::path::PathBuf;

use crate::auth::CodexAuth;
use crate::config::Config;
use codex_protocol::protocol::RemoteSkillHazelnutScope;
use codex_protocol::protocol::RemoteSkillProductSurface;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSkillSummary {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSkillDownloadResult {
    pub id: String,
    pub path: PathBuf,
}

pub async fn list_remote_skills(
    _config: &Config,
    _auth: Option<&CodexAuth>,
    _hazelnut_scope: RemoteSkillHazelnutScope,
    _product_surface: RemoteSkillProductSurface,
    _enabled: Option<bool>,
) -> Result<Vec<RemoteSkillSummary>> {
    anyhow::bail!("remote skills are disabled in wasm_v2")
}

pub async fn export_remote_skill(
    _config: &Config,
    _auth: Option<&CodexAuth>,
    _hazelnut_id: &str,
) -> Result<RemoteSkillDownloadResult> {
    anyhow::bail!("remote skills are disabled in wasm_v2")
}
