pub mod types;

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

pub use crate::features::ManagedFeatures;
pub use codex_config::Constrained;
pub use codex_config::ConstraintResult;
use codex_network_proxy::NetworkProxy;
use codex_protocol::config_types::Personality;
use codex_protocol::config_types::ReasoningSummary as ReasoningSummaryConfig;
use codex_protocol::config_types::ServiceTier;
use codex_protocol::config_types::WebSearchMode;
use codex_protocol::openai_models::ReasoningEffort as ReasoningEffortConfig;
use codex_protocol::permissions::FileSystemSandboxPolicy;
use codex_protocol::permissions::NetworkSandboxPolicy;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::SandboxPolicy;
use codex_rmcp_client::OAuthCredentialsStoreMode;
use serde_json::Value;

use crate::config::types::McpServerConfig;
use crate::config::types::MemoriesConfig;
use crate::config::types::Verbosity;
use crate::config_loader::ConfigLayerStack;
use crate::model_provider_info::ModelProviderInfo;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct GhostSnapshotConfig;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OtelConfig {
    pub log_user_prompt: bool,
}

#[derive(Debug, Clone)]
pub struct StartedNetworkProxy {
    proxy: NetworkProxy,
}

impl StartedNetworkProxy {
    pub fn new(proxy: NetworkProxy) -> Self {
        Self { proxy }
    }

    pub fn proxy(&self) -> &NetworkProxy {
        &self.proxy
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NetworkProxySpec;

impl NetworkProxySpec {
    pub async fn start_proxy(
        &self,
        _sandbox_policy: &SandboxPolicy,
        _network_policy_decider: Option<Arc<dyn codex_network_proxy::NetworkPolicyDecider>>,
        _blocked_request_observer: Option<Arc<dyn codex_network_proxy::BlockedRequestObserver>>,
        _managed_network_requirements_enabled: bool,
        _audit_metadata: codex_network_proxy::NetworkProxyAuditMetadata,
    ) -> anyhow::Result<StartedNetworkProxy> {
        let _ = self;
        Err(anyhow::anyhow!(
            "managed network proxy is not implemented in wasm_v2 yet"
        ))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Permissions {
    pub approval_policy: Constrained<AskForApproval>,
    pub sandbox_policy: Constrained<SandboxPolicy>,
    pub file_system_sandbox_policy: FileSystemSandboxPolicy,
    pub network_sandbox_policy: NetworkSandboxPolicy,
    pub allow_login_shell: bool,
    pub shell_environment_policy: types::ShellEnvironmentPolicy,
    pub network: Option<NetworkProxySpec>,
}

impl Default for Permissions {
    fn default() -> Self {
        Self {
            approval_policy: Constrained::allow_any(AskForApproval::UnlessTrusted),
            sandbox_policy: Constrained::allow_any(SandboxPolicy::new_read_only_policy()),
            file_system_sandbox_policy: FileSystemSandboxPolicy::default(),
            network_sandbox_policy: NetworkSandboxPolicy::default(),
            allow_login_shell: false,
            shell_environment_policy: types::ShellEnvironmentPolicy::default(),
            network: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub model: Option<String>,
    pub review_model: Option<String>,
    pub model_reasoning_effort: Option<ReasoningEffortConfig>,
    pub model_reasoning_summary: Option<ReasoningSummaryConfig>,
    pub model_provider: ModelProviderInfo,
    pub model_provider_id: String,
    pub service_tier: Option<ServiceTier>,
    pub permissions: Permissions,
    pub mcp_servers: Constrained<HashMap<String, McpServerConfig>>,
    pub mcp_oauth_credentials_store_mode: OAuthCredentialsStoreMode,
    pub codex_home: PathBuf,
    pub chatgpt_base_url: String,
    pub features: ManagedFeatures,
    pub ghost_snapshot: GhostSnapshotConfig,
    pub otel: OtelConfig,
    pub agent_roles: BTreeMap<String, Value>,
    pub developer_instructions: Option<String>,
    pub user_instructions: Option<String>,
    pub personality: Option<Personality>,
    pub show_raw_agent_reasoning: bool,
    pub base_instructions: Option<String>,
    pub compact_prompt: Option<String>,
    pub commit_attribution: Option<String>,
    pub cwd: PathBuf,
    pub agent_max_depth: i32,
    pub memories: MemoriesConfig,
    pub ephemeral: bool,
    pub web_search_config: Option<Value>,
    pub codex_linux_sandbox_exe: Option<PathBuf>,
    pub js_repl_node_path: Option<PathBuf>,
    pub js_repl_node_module_dirs: Vec<PathBuf>,
    pub startup_warnings: Vec<String>,
    pub model_verbosity: Option<Verbosity>,
    pub model_context_window: Option<i64>,
    pub model_auto_compact_token_limit: Option<i64>,
    pub active_profile: Option<String>,
    pub background_terminal_max_timeout: Option<std::time::Duration>,
    pub main_execve_wrapper_exe: Option<PathBuf>,
    pub notify: Option<Vec<String>>,
    pub zsh_path: Option<PathBuf>,
    pub web_search_mode: Constrained<WebSearchMode>,
    pub config_layer_stack: ConfigLayerStack,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            model: None,
            review_model: None,
            model_reasoning_effort: None,
            model_reasoning_summary: None,
            model_provider: ModelProviderInfo::create_openai_provider(),
            model_provider_id: "openai".to_string(),
            service_tier: None,
            permissions: Permissions::default(),
            mcp_servers: Constrained::allow_any(HashMap::new()),
            mcp_oauth_credentials_store_mode: OAuthCredentialsStoreMode::Auto,
            codex_home: PathBuf::new(),
            chatgpt_base_url: "https://api.openai.com".to_string(),
            features: ManagedFeatures::default(),
            ghost_snapshot: GhostSnapshotConfig,
            otel: OtelConfig::default(),
            agent_roles: BTreeMap::new(),
            developer_instructions: None,
            user_instructions: None,
            personality: None,
            show_raw_agent_reasoning: false,
            base_instructions: None,
            compact_prompt: None,
            commit_attribution: None,
            cwd: PathBuf::new(),
            agent_max_depth: 16,
            memories: MemoriesConfig::default(),
            ephemeral: false,
            web_search_config: None,
            codex_linux_sandbox_exe: None,
            js_repl_node_path: None,
            js_repl_node_module_dirs: Vec::new(),
            startup_warnings: Vec::new(),
            model_verbosity: None,
            model_context_window: None,
            model_auto_compact_token_limit: None,
            active_profile: None,
            background_terminal_max_timeout: None,
            main_execve_wrapper_exe: None,
            notify: None,
            zsh_path: None,
            web_search_mode: Constrained::allow_any(WebSearchMode::Disabled),
            config_layer_stack: ConfigLayerStack::default(),
        }
    }
}

impl Config {
    pub fn managed_network_requirements_enabled(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, Default)]
pub struct ConfigBuilder {
    codex_home: Option<PathBuf>,
}

impl ConfigBuilder {
    pub fn codex_home(mut self, codex_home: PathBuf) -> Self {
        self.codex_home = Some(codex_home);
        self
    }

    pub async fn build(self) -> std::io::Result<Arc<Config>> {
        Ok(Arc::new(test_config_with_home(
            self.codex_home.unwrap_or_default(),
        )))
    }
}

pub fn test_config() -> Arc<Config> {
    Arc::new(test_config_with_home(PathBuf::new()))
}

pub fn find_codex_home() -> std::io::Result<PathBuf> {
    codex_utils_home_dir::find_codex_home()
}

fn test_config_with_home(codex_home: PathBuf) -> Config {
    Config {
        codex_home,
        chatgpt_base_url: "https://api.openai.com".to_string(),
        mcp_servers: Constrained::allow_any(HashMap::new()),
        web_search_mode: Constrained::allow_any(WebSearchMode::Disabled),
        ..Default::default()
    }
}

pub fn resolve_web_search_mode_for_turn(
    web_search_mode: &Constrained<WebSearchMode>,
    sandbox_policy: &SandboxPolicy,
) -> WebSearchMode {
    let preferred = web_search_mode.value();
    if matches!(sandbox_policy, SandboxPolicy::DangerFullAccess)
        && preferred != WebSearchMode::Disabled
    {
        for mode in [
            WebSearchMode::Live,
            WebSearchMode::Cached,
            WebSearchMode::Disabled,
        ] {
            if web_search_mode.can_set(&mode).is_ok() {
                return mode;
            }
        }
    } else {
        if web_search_mode.can_set(&preferred).is_ok() {
            return preferred;
        }
        for mode in [
            WebSearchMode::Cached,
            WebSearchMode::Live,
            WebSearchMode::Disabled,
        ] {
            if web_search_mode.can_set(&mode).is_ok() {
                return mode;
            }
        }
    }
    WebSearchMode::Disabled
}

pub fn uses_deprecated_instructions_file(_config_layer_stack: &ConfigLayerStack) -> bool {
    false
}
