use super::*;

impl Session {
    async fn record_initial_history(&self, conversation_history: InitialHistory) {
        let turn_context = self.new_default_turn().await;
        let is_subagent = {
            let state = self.state.lock().await;
            matches!(
                state.session_configuration.session_source,
                SessionSource::SubAgent(_)
            )
        };
        match conversation_history {
            InitialHistory::New => {
                self.set_previous_turn_settings(None).await;
            }
            InitialHistory::Resumed(resumed_history) => {
                let rollout_items = resumed_history.history;

                let reconstructed_rollout = self
                    .reconstruct_history_from_rollout(&turn_context, &rollout_items)
                    .await;
                let previous_turn_settings = reconstructed_rollout.previous_turn_settings.clone();
                self.set_previous_turn_settings(previous_turn_settings.clone())
                    .await;
                {
                    let mut state = self.state.lock().await;
                    state.set_reference_context_item(reconstructed_rollout.reference_context_item);
                }

                let curr: &str = turn_context.model_info.slug.as_str();
                if let Some(prev) = previous_turn_settings
                    .as_ref()
                    .map(|settings| settings.model.as_str())
                    .filter(|model| *model != curr)
                {
                    warn!("resuming session with different model: previous={prev}, current={curr}");
                    self.send_event(
                        &turn_context,
                        EventMsg::Warning(WarningEvent {
                            message: format!(
                                "This session was recorded with model `{prev}` but is resuming with `{curr}`. \
                         Consider switching back to `{prev}` as it may affect Codex performance."
                            ),
                        }),
                    )
                    .await;
                }

                let reconstructed_history = reconstructed_rollout.history;
                if !reconstructed_history.is_empty() {
                    self.record_into_history(&reconstructed_history, &turn_context)
                        .await;
                }

                if let Some(info) = Self::last_token_info_from_rollout(&rollout_items) {
                    let mut state = self.state.lock().await;
                    state.set_token_info(Some(info));
                }

                if !is_subagent {
                    self.flush_rollout().await;
                }
            }
            InitialHistory::Forked(rollout_items) => {
                let reconstructed_rollout = self
                    .reconstruct_history_from_rollout(&turn_context, &rollout_items)
                    .await;
                self.set_previous_turn_settings(
                    reconstructed_rollout.previous_turn_settings.clone(),
                )
                .await;
                {
                    let mut state = self.state.lock().await;
                    state.set_reference_context_item(
                        reconstructed_rollout.reference_context_item.clone(),
                    );
                }

                let reconstructed_history = reconstructed_rollout.history;
                if !reconstructed_history.is_empty() {
                    self.record_into_history(&reconstructed_history, &turn_context)
                        .await;
                }

                if let Some(info) = Self::last_token_info_from_rollout(&rollout_items) {
                    let mut state = self.state.lock().await;
                    state.set_token_info(Some(info));
                }

                if !rollout_items.is_empty() {
                    self.persist_rollout_items(&rollout_items).await;
                }

                let initial_context = self.build_initial_context(&turn_context).await;
                self.record_conversation_items(&turn_context, &initial_context)
                    .await;
                {
                    let mut state = self.state.lock().await;
                    state.set_reference_context_item(Some(turn_context.to_turn_context_item()));
                }

                self.ensure_rollout_materialized().await;

                if !is_subagent {
                    self.flush_rollout().await;
                }
            }
        }
    }

    fn last_token_info_from_rollout(rollout_items: &[RolloutItem]) -> Option<TokenUsageInfo> {
        rollout_items.iter().rev().find_map(|item| match item {
            RolloutItem::EventMsg(EventMsg::TokenCount(ev)) => ev.info.clone(),
            _ => None,
        })
    }

    async fn previous_turn_settings(&self) -> Option<PreviousTurnSettings> {
        let state = self.state.lock().await;
        state.previous_turn_settings()
    }

    pub(crate) async fn set_previous_turn_settings(
        &self,
        previous_turn_settings: Option<PreviousTurnSettings>,
    ) {
        let mut state = self.state.lock().await;
        state.set_previous_turn_settings(previous_turn_settings);
    }

    fn maybe_refresh_shell_snapshot_for_cwd(
        &self,
        previous_cwd: &Path,
        next_cwd: &Path,
        codex_home: &Path,
        session_source: &SessionSource,
    ) {
        if previous_cwd == next_cwd {
            return;
        }

        if !self.features.enabled(Feature::ShellSnapshot) {
            return;
        }

        if matches!(
            session_source,
            SessionSource::SubAgent(SubAgentSource::ThreadSpawn { .. })
        ) {
            return;
        }

        ShellSnapshot::refresh_snapshot(
            codex_home.to_path_buf(),
            self.conversation_id,
            next_cwd.to_path_buf(),
            self.services.user_shell.as_ref().clone(),
            self.services.shell_snapshot_tx.clone(),
            self.services.session_telemetry.clone(),
        );
    }

    async fn build_settings_update_items(
        &self,
        reference_context_item: Option<&TurnContextItem>,
        current_context: &TurnContext,
    ) -> Vec<ResponseItem> {
        let previous_turn_settings = {
            let state = self.state.lock().await;
            state.previous_turn_settings()
        };
        let shell = self.user_shell();
        let exec_policy = self.services.exec_policy.current();
        crate::context_manager::updates::build_settings_update_items(
            reference_context_item,
            previous_turn_settings.as_ref(),
            current_context,
            shell.as_ref(),
            exec_policy.as_ref(),
            self.features.enabled(Feature::Personality),
        )
    }
}
