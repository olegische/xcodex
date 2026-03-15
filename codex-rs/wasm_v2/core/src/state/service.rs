use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio::sync::RwLock;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::AuthManager;
use crate::agent::AgentControl;
use crate::analytics_client::AnalyticsEventsClient;
use crate::client::ModelClient;
use crate::compat::hooks::Hooks;
use crate::compat::otel::SessionTelemetry;
use crate::config::StartedNetworkProxy;
use crate::connectors::DiscoverableAppsProvider;
use crate::exec_policy::ExecPolicyManager;
use crate::file_watcher::FileWatcher;
use crate::mcp::McpManager;
use crate::mcp_connection_manager::McpConnectionManager;
use crate::models_manager::manager::ModelsManager;
use crate::plugins::PluginsManager;
use crate::rollout::RolloutRecorder;
use crate::shell::Shell;
use crate::shell_snapshot::ShellSnapshot;
use crate::skills::SkillsManager;
use crate::state_db::StateDbHandle;
use crate::tools::browser_host::HostFs;
use crate::tools::code_mode::CodeModeService;
use crate::tools::network_approval::NetworkApprovalService;
use crate::tools::sandboxing::ApprovalStore;
use crate::unified_exec::UnifiedExecProcessManager;

pub(crate) struct SessionServices {
    pub(crate) mcp_connection_manager: Arc<RwLock<McpConnectionManager>>,
    pub(crate) mcp_startup_cancellation_token: Mutex<CancellationToken>,
    pub(crate) analytics_events_client: AnalyticsEventsClient,
    pub(crate) hooks: Hooks,
    pub(crate) rollout: Mutex<Option<RolloutRecorder>>,
    pub(crate) user_shell: Arc<Shell>,
    pub(crate) unified_exec_manager: UnifiedExecProcessManager,
    pub(crate) shell_zsh_path: Option<std::path::PathBuf>,
    pub(crate) main_execve_wrapper_exe: Option<std::path::PathBuf>,
    pub(crate) shell_snapshot_tx: watch::Sender<Option<Arc<ShellSnapshot>>>,
    pub(crate) show_raw_agent_reasoning: bool,
    pub(crate) exec_policy: ExecPolicyManager,
    pub(crate) auth_manager: Arc<AuthManager>,
    pub(crate) models_manager: Arc<ModelsManager>,
    pub(crate) session_telemetry: SessionTelemetry,
    pub(crate) tool_approvals: Mutex<ApprovalStore>,
    pub(crate) execve_session_approvals: RwLock<HashMap<String, ()>>,
    pub(crate) skills_manager: Arc<SkillsManager>,
    pub(crate) plugins_manager: Arc<PluginsManager>,
    pub(crate) mcp_manager: Arc<McpManager>,
    pub(crate) file_watcher: Arc<FileWatcher>,
    pub(crate) agent_control: AgentControl,
    pub(crate) network_proxy: Option<StartedNetworkProxy>,
    pub(crate) network_approval: Arc<NetworkApprovalService>,
    pub(crate) state_db: Option<StateDbHandle>,
    pub(crate) model_client: ModelClient,
    pub(crate) code_mode_service: CodeModeService,
    pub(crate) browser_fs: Arc<dyn HostFs>,
    pub(crate) discoverable_apps_provider: Arc<dyn DiscoverableAppsProvider>,
}
