use super::*;

/// Context for an initialized model agent
///
/// A session has at most 1 running task at a time, and can be interrupted by user input.
pub(crate) struct Session {
    pub(crate) conversation_id: ThreadId,
    tx_event: Sender<Event>,
    agent_status: watch::Sender<AgentStatus>,
    out_of_band_elicitation_paused: watch::Sender<bool>,
    state: Mutex<SessionState>,
    /// The set of enabled features should be invariant for the lifetime of the
    /// session.
    features: ManagedFeatures,
    pending_mcp_server_refresh_config: Mutex<Option<McpServerRefreshConfig>>,
    pub(crate) conversation: Arc<RealtimeConversationManager>,
    pub(crate) active_turn: Mutex<Option<ActiveTurn>>,
    pub(crate) services: SessionServices,
    js_repl: Arc<JsReplHandle>,
    next_internal_sub_id: AtomicU64,
}

#[derive(Clone, Debug)]
pub(crate) struct TurnSkillsContext {
    pub(crate) outcome: Arc<SkillLoadOutcome>,
    pub(crate) implicit_invocation_seen_skills: Arc<Mutex<HashSet<String>>>,
}
impl TurnSkillsContext {
    pub(crate) fn new(outcome: Arc<SkillLoadOutcome>) -> Self {
        Self {
            outcome,
            implicit_invocation_seen_skills: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

/// The context needed for a single turn of the thread.
#[derive(Debug)]
pub(crate) struct TurnContext {
    pub(crate) sub_id: String,
    pub(crate) trace_id: Option<String>,
    pub(crate) realtime_active: bool,
    pub(crate) config: Arc<Config>,
    pub(crate) auth_manager: Option<Arc<AuthManager>>,
    pub(crate) model_info: ModelInfo,
    pub(crate) session_telemetry: SessionTelemetry,
    pub(crate) provider: ModelProviderInfo,
    pub(crate) reasoning_effort: Option<ReasoningEffortConfig>,
    pub(crate) reasoning_summary: ReasoningSummaryConfig,
    pub(crate) session_source: SessionSource,
    pub(crate) cwd: PathBuf,
    pub(crate) current_date: Option<String>,
    pub(crate) timezone: Option<String>,
    pub(crate) app_server_client_name: Option<String>,
    pub(crate) developer_instructions: Option<String>,
    pub(crate) compact_prompt: Option<String>,
    pub(crate) user_instructions: Option<String>,
    pub(crate) collaboration_mode: CollaborationMode,
    pub(crate) personality: Option<Personality>,
    pub(crate) approval_policy: Constrained<AskForApproval>,
    pub(crate) sandbox_policy: Constrained<SandboxPolicy>,
    pub(crate) file_system_sandbox_policy: FileSystemSandboxPolicy,
    pub(crate) network_sandbox_policy: NetworkSandboxPolicy,
    pub(crate) network: Option<NetworkProxy>,
    pub(crate) windows_sandbox_level: WindowsSandboxLevel,
    pub(crate) shell_environment_policy: ShellEnvironmentPolicy,
    pub(crate) tools_config: ToolsConfig,
    pub(crate) features: ManagedFeatures,
    pub(crate) ghost_snapshot: GhostSnapshotConfig,
    pub(crate) final_output_json_schema: Option<Value>,
    pub(crate) codex_linux_sandbox_exe: Option<PathBuf>,
    pub(crate) tool_call_gate: Arc<ReadinessFlag>,
    pub(crate) truncation_policy: TruncationPolicy,
    pub(crate) js_repl: Arc<JsReplHandle>,
    pub(crate) dynamic_tools: Vec<DynamicToolSpec>,
    pub(crate) turn_metadata_state: Arc<TurnMetadataState>,
    pub(crate) turn_skills: TurnSkillsContext,
    pub(crate) turn_timing_state: Arc<TurnTimingState>,
}
impl TurnContext {
    pub(crate) fn model_context_window(&self) -> Option<i64> {
        let effective_context_window_percent = self.model_info.effective_context_window_percent;
        self.model_info.context_window.map(|context_window| {
            context_window.saturating_mul(effective_context_window_percent) / 100
        })
    }

    pub(crate) fn apps_enabled(&self) -> bool {
        self.features
            .apps_enabled_cached(self.auth_manager.as_deref())
    }

    pub(crate) async fn with_model(&self, model: String, models_manager: &ModelsManager) -> Self {
        let mut config = (*self.config).clone();
        config.model = Some(model.clone());
        let model_info = models_manager.get_model_info(model.as_str(), &config).await;
        let truncation_policy = model_info.truncation_policy.into();
        let supported_reasoning_levels = model_info
            .supported_reasoning_levels
            .iter()
            .map(|preset| preset.effort)
            .collect::<Vec<_>>();
        let reasoning_effort = if let Some(current_reasoning_effort) = self.reasoning_effort {
            if supported_reasoning_levels.contains(&current_reasoning_effort) {
                Some(current_reasoning_effort)
            } else {
                supported_reasoning_levels
                    .get(supported_reasoning_levels.len().saturating_sub(1) / 2)
                    .copied()
                    .or(model_info.default_reasoning_level)
            }
        } else {
            supported_reasoning_levels
                .get(supported_reasoning_levels.len().saturating_sub(1) / 2)
                .copied()
                .or(model_info.default_reasoning_level)
        };
        config.model_reasoning_effort = reasoning_effort;

        let collaboration_mode =
            self.collaboration_mode
                .with_updates(Some(model.clone()), Some(reasoning_effort), None);
        let features = self.features.clone();
        let tools_config = ToolsConfig::new(&ToolsConfigParams {
            model_info: &model_info,
            available_models: &models_manager
                .list_models(RefreshStrategy::OnlineIfUncached)
                .await,
            features: &features,
            web_search_mode: self.tools_config.web_search_mode,
            session_source: self.session_source.clone(),
        })
        .with_web_search_config(self.tools_config.web_search_config.clone())
        .with_allow_login_shell(self.tools_config.allow_login_shell)
        .with_agent_roles(config.agent_roles.clone());

        Self {
            sub_id: self.sub_id.clone(),
            trace_id: self.trace_id.clone(),
            realtime_active: self.realtime_active,
            config: Arc::new(config),
            auth_manager: self.auth_manager.clone(),
            model_info: model_info.clone(),
            session_telemetry: self
                .session_telemetry
                .clone()
                .with_model(model.as_str(), model_info.slug.as_str()),
            provider: self.provider.clone(),
            reasoning_effort,
            reasoning_summary: self.reasoning_summary,
            session_source: self.session_source.clone(),
            cwd: self.cwd.clone(),
            current_date: self.current_date.clone(),
            timezone: self.timezone.clone(),
            app_server_client_name: self.app_server_client_name.clone(),
            developer_instructions: self.developer_instructions.clone(),
            compact_prompt: self.compact_prompt.clone(),
            user_instructions: self.user_instructions.clone(),
            collaboration_mode,
            personality: self.personality,
            approval_policy: self.approval_policy.clone(),
            sandbox_policy: self.sandbox_policy.clone(),
            file_system_sandbox_policy: self.file_system_sandbox_policy.clone(),
            network_sandbox_policy: self.network_sandbox_policy,
            network: self.network.clone(),
            windows_sandbox_level: self.windows_sandbox_level,
            shell_environment_policy: self.shell_environment_policy.clone(),
            tools_config,
            features,
            ghost_snapshot: self.ghost_snapshot.clone(),
            final_output_json_schema: self.final_output_json_schema.clone(),
            codex_linux_sandbox_exe: self.codex_linux_sandbox_exe.clone(),
            tool_call_gate: Arc::new(ReadinessFlag::new()),
            truncation_policy,
            js_repl: Arc::clone(&self.js_repl),
            dynamic_tools: self.dynamic_tools.clone(),
            turn_metadata_state: self.turn_metadata_state.clone(),
            turn_skills: self.turn_skills.clone(),
            turn_timing_state: Arc::clone(&self.turn_timing_state),
        }
    }

    pub(crate) fn resolve_path(&self, path: Option<String>) -> PathBuf {
        path.as_ref()
            .map(PathBuf::from)
            .map_or_else(|| self.cwd.clone(), |p| self.cwd.join(p))
    }

    pub(crate) fn compact_prompt(&self) -> &str {
        self.compact_prompt
            .as_deref()
            .unwrap_or(compact::SUMMARIZATION_PROMPT)
    }

    pub(crate) fn to_turn_context_item(&self) -> TurnContextItem {
        TurnContextItem {
            turn_id: Some(self.sub_id.clone()),
            trace_id: self.trace_id.clone(),
            cwd: self.cwd.clone(),
            current_date: self.current_date.clone(),
            timezone: self.timezone.clone(),
            approval_policy: self.approval_policy.value(),
            sandbox_policy: self.sandbox_policy.get().clone(),
            network: self.turn_context_network_item(),
            model: self.model_info.slug.clone(),
            personality: self.personality,
            collaboration_mode: Some(self.collaboration_mode.clone()),
            realtime_active: Some(self.realtime_active),
            effort: self.reasoning_effort,
            summary: self.reasoning_summary,
            user_instructions: self.user_instructions.clone(),
            developer_instructions: self.developer_instructions.clone(),
            final_output_json_schema: self.final_output_json_schema.clone(),
            truncation_policy: Some(self.truncation_policy.into()),
        }
    }

    fn turn_context_network_item(&self) -> Option<TurnContextNetworkItem> {
        let network = self
            .config
            .config_layer_stack
            .requirements()
            .network
            .as_ref()?;
        Some(TurnContextNetworkItem {
            allowed_domains: network.allowed_domains.clone().unwrap_or_default(),
            denied_domains: network.denied_domains.clone().unwrap_or_default(),
        })
    }
}

pub(super) fn local_time_context() -> (String, String) {
    match iana_time_zone::get_timezone() {
        Ok(timezone) => (Local::now().format("%Y-%m-%d").to_string(), timezone),
        Err(_) => (
            Utc::now().format("%Y-%m-%d").to_string(),
            "Etc/UTC".to_string(),
        ),
    }
}

#[derive(Clone)]
pub(crate) struct SessionConfiguration {
    provider: ModelProviderInfo,
    collaboration_mode: CollaborationMode,
    model_reasoning_summary: Option<ReasoningSummaryConfig>,
    service_tier: Option<ServiceTier>,
    developer_instructions: Option<String>,
    user_instructions: Option<String>,
    personality: Option<Personality>,
    base_instructions: String,
    compact_prompt: Option<String>,
    approval_policy: Constrained<AskForApproval>,
    sandbox_policy: Constrained<SandboxPolicy>,
    file_system_sandbox_policy: FileSystemSandboxPolicy,
    network_sandbox_policy: NetworkSandboxPolicy,
    windows_sandbox_level: WindowsSandboxLevel,
    cwd: PathBuf,
    codex_home: PathBuf,
    thread_name: Option<String>,
    original_config_do_not_use: Arc<Config>,
    metrics_service_name: Option<String>,
    app_server_client_name: Option<String>,
    session_source: SessionSource,
    dynamic_tools: Vec<DynamicToolSpec>,
    persist_extended_history: bool,
    inherited_shell_snapshot: Option<Arc<ShellSnapshot>>,
}

impl SessionConfiguration {
    pub(crate) fn codex_home(&self) -> &PathBuf {
        &self.codex_home
    }

    fn thread_config_snapshot(&self) -> ThreadConfigSnapshot {
        ThreadConfigSnapshot {
            model: self.collaboration_mode.model().to_string(),
            model_provider_id: self.original_config_do_not_use.model_provider_id.clone(),
            service_tier: self.service_tier,
            approval_policy: self.approval_policy.value(),
            sandbox_policy: self.sandbox_policy.get().clone(),
            cwd: self.cwd.clone(),
            ephemeral: self.original_config_do_not_use.ephemeral,
            reasoning_effort: self.collaboration_mode.reasoning_effort(),
            personality: self.personality,
            session_source: self.session_source.clone(),
        }
    }

    pub(crate) fn apply(&self, updates: &SessionSettingsUpdate) -> ConstraintResult<Self> {
        let mut next_configuration = self.clone();
        let file_system_policy_matches_legacy = self.file_system_sandbox_policy
            == FileSystemSandboxPolicy::from_legacy_sandbox_policy(
                self.sandbox_policy.get(),
                &self.cwd,
            );
        if let Some(collaboration_mode) = updates.collaboration_mode.clone() {
            next_configuration.collaboration_mode = collaboration_mode;
        }
        if let Some(summary) = updates.reasoning_summary {
            next_configuration.model_reasoning_summary = Some(summary);
        }
        if let Some(service_tier) = updates.service_tier {
            next_configuration.service_tier = service_tier;
        }
        if let Some(personality) = updates.personality {
            next_configuration.personality = Some(personality);
        }
        if let Some(approval_policy) = updates.approval_policy {
            next_configuration.approval_policy.set(approval_policy)?;
        }
        let mut sandbox_policy_changed = false;
        if let Some(sandbox_policy) = updates.sandbox_policy.clone() {
            next_configuration.sandbox_policy.set(sandbox_policy)?;
            next_configuration.network_sandbox_policy =
                NetworkSandboxPolicy::from(next_configuration.sandbox_policy.get());
            sandbox_policy_changed = true;
        }
        if let Some(windows_sandbox_level) = updates.windows_sandbox_level {
            next_configuration.windows_sandbox_level = windows_sandbox_level;
        }
        let mut cwd_changed = false;
        if let Some(cwd) = updates.cwd.clone() {
            next_configuration.cwd = cwd;
            cwd_changed = true;
        }
        if sandbox_policy_changed || (cwd_changed && file_system_policy_matches_legacy) {
            next_configuration.file_system_sandbox_policy =
                FileSystemSandboxPolicy::from_legacy_sandbox_policy(
                    next_configuration.sandbox_policy.get(),
                    &next_configuration.cwd,
                );
        }
        if let Some(app_server_client_name) = updates.app_server_client_name.clone() {
            next_configuration.app_server_client_name = Some(app_server_client_name);
        }
        Ok(next_configuration)
    }
}

#[derive(Default, Clone)]
pub(crate) struct SessionSettingsUpdate {
    pub(crate) cwd: Option<PathBuf>,
    pub(crate) approval_policy: Option<AskForApproval>,
    pub(crate) sandbox_policy: Option<SandboxPolicy>,
    pub(crate) windows_sandbox_level: Option<WindowsSandboxLevel>,
    pub(crate) collaboration_mode: Option<CollaborationMode>,
    pub(crate) reasoning_summary: Option<ReasoningSummaryConfig>,
    pub(crate) service_tier: Option<Option<ServiceTier>>,
    pub(crate) final_output_json_schema: Option<Option<Value>>,
    pub(crate) personality: Option<Personality>,
    pub(crate) app_server_client_name: Option<String>,
}
