use super::*;
use crate::connectors::DiscoverableAppsProvider;
use crate::tools::browser_host::HostFs;
use codex_protocol::openai_models::ModelsResponse;

#[derive(Debug, PartialEq)]
pub enum SteerInputError {
    NoActiveTurn(Vec<UserInput>),
    ExpectedTurnMismatch { expected: String, actual: String },
    EmptyInput,
}

/// Notes from the previous real user turn.
///
/// Conceptually this is the same role that `previous_model` used to fill, but
/// it can carry other prior-turn settings that matter when constructing
/// sensible state-change diffs or full-context reinjection, such as model
/// switches or detecting a prior `realtime_active -> false` transition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PreviousTurnSettings {
    pub(crate) model: String,
    pub(crate) realtime_active: Option<bool>,
}

pub(crate) type SessionLoopTermination = Shared<BoxFuture<'static, ()>>;

/// Wrapper returned by [`Codex::spawn`] containing the spawned [`Codex`],
/// the submission id for the initial `ConfigureSession` request and the
/// unique session id.
pub struct CodexSpawnOk {
    pub codex: Codex,
    pub thread_id: ThreadId,
    #[deprecated(note = "use thread_id")]
    pub conversation_id: ThreadId,
}

pub(crate) struct CodexSpawnArgs {
    pub(crate) config: Config,
    pub(crate) auth_manager: Arc<AuthManager>,
    pub(crate) models_manager: Arc<ModelsManager>,
    pub(crate) skills_manager: Arc<SkillsManager>,
    pub(crate) plugins_manager: Arc<PluginsManager>,
    pub(crate) mcp_manager: Arc<McpManager>,
    pub(crate) file_watcher: Arc<FileWatcher>,
    pub(crate) conversation_history: InitialHistory,
    pub(crate) session_source: SessionSource,
    pub(crate) agent_control: AgentControl,
    pub(crate) dynamic_tools: Vec<DynamicToolSpec>,
    pub(crate) persist_extended_history: bool,
    pub(crate) metrics_service_name: Option<String>,
    pub(crate) inherited_shell_snapshot: Option<Arc<ShellSnapshot>>,
    pub(crate) parent_trace: Option<W3cTraceContext>,
    pub(crate) browser_fs: Arc<dyn HostFs>,
    pub(crate) discoverable_apps_provider: Arc<dyn DiscoverableAppsProvider>,
}

pub struct BrowserCodexSpawnArgs {
    pub config: Config,
    pub auth: Option<CodexAuth>,
    pub model_catalog: Option<ModelsResponse>,
    pub conversation_history: InitialHistory,
    pub session_source: SessionSource,
    pub dynamic_tools: Vec<DynamicToolSpec>,
    pub persist_extended_history: bool,
    pub metrics_service_name: Option<String>,
    pub inherited_shell_snapshot: Option<Arc<ShellSnapshot>>,
    pub parent_trace: Option<W3cTraceContext>,
    pub browser_fs: Arc<dyn HostFs>,
    pub discoverable_apps_provider: Arc<dyn DiscoverableAppsProvider>,
}

pub(crate) const INITIAL_SUBMIT_ID: &str = "";
pub(crate) const SUBMISSION_CHANNEL_CAPACITY: usize = 512;
