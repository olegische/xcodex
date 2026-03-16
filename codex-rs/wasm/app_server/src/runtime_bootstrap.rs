use std::path::PathBuf;
use std::sync::Arc;

use codex_app_server_protocol::AskForApproval;
use codex_app_server_protocol::ThreadStartParams;
use codex_protocol::config_types::SandboxMode as CoreSandboxMode;
use codex_protocol::openai_models::ModelsResponse;
use codex_wasm_v2_core::CodexAuth;
use codex_wasm_v2_core::ConfigStorageHost;
use codex_wasm_v2_core::DiscoverableAppsProvider;
use codex_wasm_v2_core::HostFs;
use codex_wasm_v2_core::ModelTransportHost;
use codex_wasm_v2_core::ThreadStorageHost;
use codex_wasm_v2_core::config::Config;

#[derive(Clone)]
pub struct RuntimeBootstrap {
    pub config: Config,
    pub auth: Option<CodexAuth>,
    pub model_catalog: Option<ModelsResponse>,
    pub browser_fs: Arc<dyn HostFs>,
    pub discoverable_apps_provider: Arc<dyn DiscoverableAppsProvider>,
    pub model_transport_host: Arc<dyn ModelTransportHost>,
    pub config_storage_host: Arc<dyn ConfigStorageHost>,
    pub thread_storage_host: Arc<dyn ThreadStorageHost>,
}

pub fn apply_thread_start_overrides(config: &mut Config, params: &ThreadStartParams) {
    if let Some(model) = params.model.clone() {
        config.model = Some(model);
    }
    if let Some(model_provider) = params.model_provider.clone() {
        config.model_provider_id = model_provider;
    }
    if let Some(service_tier) = params.service_tier {
        config.service_tier = service_tier;
    }
    if let Some(cwd) = params.cwd.clone() {
        config.cwd = PathBuf::from(cwd);
    }
    if let Some(approval_policy) = params.approval_policy {
        let _ = config
            .permissions
            .approval_policy
            .set(approval_policy.to_core());
    }
    if let Some(sandbox) = params.sandbox {
        let _ = config
            .permissions
            .sandbox_policy
            .set(sandbox_policy_from_mode(sandbox.to_core()));
    }
    if let Some(base_instructions) = params.base_instructions.clone() {
        config.base_instructions = Some(base_instructions);
    }
    if let Some(developer_instructions) = params.developer_instructions.clone() {
        config.developer_instructions = Some(developer_instructions);
    }
    if let Some(personality) = params.personality {
        config.personality = Some(personality);
    }
    if let Some(ephemeral) = params.ephemeral {
        config.ephemeral = ephemeral;
    }
}

pub fn resolve_model(
    configured_model: Option<String>,
    model_catalog: Option<&ModelsResponse>,
) -> String {
    configured_model
        .or_else(|| {
            model_catalog
                .and_then(|catalog| catalog.models.first())
                .map(|model| model.slug.clone())
        })
        .unwrap_or_else(|| "gpt-4.1".to_string())
}

fn sandbox_policy_from_mode(mode: CoreSandboxMode) -> codex_protocol::protocol::SandboxPolicy {
    match mode {
        CoreSandboxMode::ReadOnly => {
            codex_protocol::protocol::SandboxPolicy::new_read_only_policy()
        }
        CoreSandboxMode::WorkspaceWrite => {
            codex_protocol::protocol::SandboxPolicy::new_workspace_write_policy()
        }
        CoreSandboxMode::DangerFullAccess => {
            codex_protocol::protocol::SandboxPolicy::DangerFullAccess
        }
    }
}

pub fn effective_approval_policy(params: &ThreadStartParams, config: &Config) -> AskForApproval {
    params
        .approval_policy
        .unwrap_or_else(|| AskForApproval::from(config.permissions.approval_policy.value()))
}
