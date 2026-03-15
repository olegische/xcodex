use super::*;

impl Session {
    pub(crate) async fn update_settings(
        &self,
        updates: SessionSettingsUpdate,
    ) -> ConstraintResult<()> {
        let mut state = self.state.lock().await;

        match state.session_configuration.apply(&updates) {
            Ok(updated) => {
                let previous_cwd = state.session_configuration.cwd.clone();
                let next_cwd = updated.cwd.clone();
                let codex_home = updated.codex_home.clone();
                let session_source = updated.session_source.clone();
                state.session_configuration = updated;
                drop(state);

                self.maybe_refresh_shell_snapshot_for_cwd(
                    &previous_cwd,
                    &next_cwd,
                    &codex_home,
                    &session_source,
                );

                Ok(())
            }
            Err(err) => {
                warn!("rejected session settings update: {err}");
                Err(err)
            }
        }
    }

    pub(crate) async fn new_turn_with_sub_id(
        &self,
        sub_id: String,
        updates: SessionSettingsUpdate,
    ) -> ConstraintResult<Arc<TurnContext>> {
        let (
            session_configuration,
            sandbox_policy_changed,
            previous_cwd,
            codex_home,
            session_source,
        ) = {
            let mut state = self.state.lock().await;
            match state.session_configuration.clone().apply(&updates) {
                Ok(next) => {
                    let previous_cwd = state.session_configuration.cwd.clone();
                    let sandbox_policy_changed =
                        state.session_configuration.sandbox_policy != next.sandbox_policy;
                    let codex_home = next.codex_home.clone();
                    let session_source = next.session_source.clone();
                    state.session_configuration = next.clone();
                    (
                        next,
                        sandbox_policy_changed,
                        previous_cwd,
                        codex_home,
                        session_source,
                    )
                }
                Err(err) => {
                    drop(state);
                    self.send_event_raw(Event {
                        id: sub_id.clone(),
                        msg: EventMsg::Error(ErrorEvent {
                            message: err.to_string(),
                            codex_error_info: Some(CodexErrorInfo::BadRequest),
                        }),
                    })
                    .await;
                    return Err(err);
                }
            }
        };

        self.maybe_refresh_shell_snapshot_for_cwd(
            &previous_cwd,
            &session_configuration.cwd,
            &codex_home,
            &session_source,
        );

        Ok(self
            .new_turn_from_configuration(
                sub_id,
                session_configuration,
                updates.final_output_json_schema,
                sandbox_policy_changed,
            )
            .await)
    }

    async fn new_turn_from_configuration(
        &self,
        sub_id: String,
        session_configuration: SessionConfiguration,
        final_output_json_schema: Option<Option<Value>>,
        sandbox_policy_changed: bool,
    ) -> Arc<TurnContext> {
        let per_turn_config = Self::build_per_turn_config(&session_configuration);
        self.services
            .mcp_connection_manager
            .read()
            .await
            .set_approval_policy(&session_configuration.approval_policy);

        if sandbox_policy_changed {
            let sandbox_state = SandboxState {
                sandbox_policy: per_turn_config.permissions.sandbox_policy.get().clone(),
                codex_linux_sandbox_exe: per_turn_config.codex_linux_sandbox_exe.clone(),
                sandbox_cwd: per_turn_config.cwd.clone(),
                use_legacy_landlock: per_turn_config.features.use_legacy_landlock(),
            };
            if let Err(e) = self
                .services
                .mcp_connection_manager
                .read()
                .await
                .notify_sandbox_state_change(&sandbox_state)
                .await
            {
                warn!("Failed to notify sandbox state change to MCP servers: {e:#}");
            }
        }

        let model_info = self
            .services
            .models_manager
            .get_model_info(
                session_configuration.collaboration_mode.model(),
                &per_turn_config,
            )
            .await;
        let skills_outcome = Arc::new(
            self.services
                .skills_manager
                .skills_for_cwd(&session_configuration.cwd, false)
                .await,
        );
        let mut turn_context: TurnContext = Self::make_turn_context(
            Some(Arc::clone(&self.services.auth_manager)),
            &self.services.session_telemetry,
            session_configuration.provider.clone(),
            &session_configuration,
            per_turn_config,
            model_info,
            &self.services.models_manager,
            self.services
                .network_proxy
                .as_ref()
                .map(StartedNetworkProxy::proxy)
                .cloned(),
            sub_id,
            Arc::clone(&self.js_repl),
            skills_outcome,
        );
        turn_context.realtime_active = self.conversation.running_state().await.is_some();

        if let Some(final_schema) = final_output_json_schema {
            turn_context.final_output_json_schema = final_schema;
        }
        let turn_context = Arc::new(turn_context);
        turn_context.turn_metadata_state.spawn_git_enrichment_task();
        turn_context
    }

    pub(crate) async fn maybe_emit_unknown_model_warning_for_turn(&self, tc: &TurnContext) {
        if tc.model_info.used_fallback_model_metadata {
            self.send_event(
                tc,
                EventMsg::Warning(WarningEvent {
                    message: format!(
                        "Model metadata for `{}` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
                        tc.model_info.slug
                    ),
                }),
            )
            .await;
        }
    }

    pub(crate) async fn new_default_turn(&self) -> Arc<TurnContext> {
        self.new_default_turn_with_sub_id(self.next_internal_sub_id())
            .await
    }

    pub(crate) async fn take_startup_regular_task(&self) -> Option<RegularTask> {
        let startup_regular_task = {
            let mut state = self.state.lock().await;
            state.take_startup_regular_task()
        };
        let startup_regular_task = startup_regular_task?;
        match startup_regular_task.join().await {
            Ok(Ok(regular_task)) => Some(regular_task),
            Ok(Err(err)) => {
                warn!("startup websocket prewarm setup failed: {err:#}");
                None
            }
            Err(err) => {
                warn!("startup websocket prewarm setup join failed: {err}");
                None
            }
        }
    }

    pub(crate) async fn schedule_startup_prewarm(self: &Arc<Self>, base_instructions: String) {
        let sess = Arc::clone(self);
        let startup_regular_task = crate::compat::task::spawn_task(async move {
            sess.schedule_startup_prewarm_inner(base_instructions).await
        });
        let mut state = self.state.lock().await;
        state.set_startup_regular_task(startup_regular_task);
    }

    async fn schedule_startup_prewarm_inner(
        self: &Arc<Self>,
        base_instructions: String,
    ) -> CodexResult<RegularTask> {
        let startup_turn_context = self
            .new_default_turn_with_sub_id(INITIAL_SUBMIT_ID.to_owned())
            .await;
        let startup_cancellation_token = CancellationToken::new();
        let startup_router = built_tools(
            self,
            startup_turn_context.as_ref(),
            &[],
            &HashSet::new(),
            None,
            &startup_cancellation_token,
        )
        .await?;
        let startup_prompt = build_prompt(
            Vec::new(),
            startup_router.as_ref(),
            startup_turn_context.as_ref(),
            BaseInstructions {
                text: base_instructions,
            },
        );
        let startup_turn_metadata_header = startup_turn_context
            .turn_metadata_state
            .current_header_value();
        RegularTask::with_startup_prewarm(
            self.services.model_client.clone(),
            startup_prompt,
            startup_turn_context,
            startup_turn_metadata_header,
        )
        .await
    }

    pub(crate) async fn get_config(&self) -> std::sync::Arc<Config> {
        let state = self.state.lock().await;
        state
            .session_configuration
            .original_config_do_not_use
            .clone()
    }

    pub(crate) async fn provider(&self) -> ModelProviderInfo {
        let state = self.state.lock().await;
        state.session_configuration.provider.clone()
    }

    pub(crate) async fn reload_user_config_layer(&self) {
        let config_toml_path = {
            let state = self.state.lock().await;
            state
                .session_configuration
                .codex_home
                .join(CONFIG_TOML_FILE)
        };

        let user_config = match std::fs::read_to_string(&config_toml_path) {
            Ok(contents) => match toml::from_str::<toml::Value>(&contents) {
                Ok(config) => config,
                Err(err) => {
                    warn!("failed to parse user config while reloading layer: {err}");
                    return;
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                toml::Value::Table(Default::default())
            }
            Err(err) => {
                warn!("failed to read user config while reloading layer: {err}");
                return;
            }
        };

        let config_toml_path = match AbsolutePathBuf::try_from(config_toml_path) {
            Ok(path) => path,
            Err(err) => {
                warn!("failed to resolve user config path while reloading layer: {err}");
                return;
            }
        };

        let mut state = self.state.lock().await;
        let mut config = (*state.session_configuration.original_config_do_not_use).clone();
        config.config_layer_stack = config
            .config_layer_stack
            .with_user_config(config_toml_path.as_path(), user_config);
        state.session_configuration.original_config_do_not_use = Arc::new(config);
        self.services.skills_manager.clear_cache();
        self.services.plugins_manager.clear_cache();
    }

    pub(crate) async fn new_default_turn_with_sub_id(&self, sub_id: String) -> Arc<TurnContext> {
        let session_configuration = {
            let state = self.state.lock().await;
            state.session_configuration.clone()
        };
        self.new_turn_from_configuration(sub_id, session_configuration, None, false)
            .await
    }
}
