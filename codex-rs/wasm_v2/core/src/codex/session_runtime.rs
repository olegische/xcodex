use super::*;

impl Session {
    pub(crate) fn get_tx_event(&self) -> Sender<Event> {
        self.tx_event.clone()
    }

    pub(crate) fn state_db(&self) -> Option<state_db::StateDbHandle> {
        self.services.state_db.clone()
    }

    pub(crate) async fn flush_rollout(&self) {
        let recorder = {
            let guard = self.services.rollout.lock().await;
            guard.clone()
        };
        if let Some(rec) = recorder
            && let Err(e) = rec.flush().await
        {
            warn!("failed to flush rollout recorder: {e}");
        }
    }

    pub(crate) async fn ensure_rollout_materialized(&self) {
        let recorder = {
            let guard = self.services.rollout.lock().await;
            guard.clone()
        };
        if let Some(rec) = recorder
            && let Err(e) = rec.persist().await
        {
            warn!("failed to materialize rollout recorder: {e}");
        }
    }

    fn next_internal_sub_id(&self) -> String {
        let id = self
            .next_internal_sub_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        format!("auto-compact-{id}")
    }

    pub(crate) async fn route_realtime_text_input(self: &Arc<Self>, text: String) {
        handlers::user_input_or_turn(
            self,
            self.next_internal_sub_id(),
            Op::UserInput {
                items: vec![UserInput::Text {
                    text,
                    text_elements: Vec::new(),
                }],
                final_output_json_schema: None,
            },
        )
        .await;
    }

    async fn maybe_warn_on_server_model_mismatch(
        self: &Arc<Self>,
        turn_context: &Arc<TurnContext>,
        server_model: String,
    ) -> bool {
        let requested_model = turn_context.model_info.slug.clone();
        let server_model_normalized = server_model.to_ascii_lowercase();
        let requested_model_normalized = requested_model.to_ascii_lowercase();
        if server_model_normalized == requested_model_normalized {
            info!("server reported model {server_model} (matches requested model)");
            return false;
        }

        warn!("server reported model {server_model} while requested model was {requested_model}");

        let warning_message = format!(
            "Your account was flagged for potentially high-risk cyber activity and this request was routed to gpt-5.2 as a fallback. To regain access to gpt-5.3-codex, apply for trusted access: {CYBER_VERIFY_URL} or learn more: {CYBER_SAFETY_URL}"
        );

        self.send_event(
            turn_context,
            EventMsg::ModelReroute(ModelRerouteEvent {
                from_model: requested_model.clone(),
                to_model: server_model.clone(),
                reason: ModelRerouteReason::HighRiskCyberActivity,
            }),
        )
        .await;

        self.send_event(
            turn_context,
            EventMsg::Warning(WarningEvent {
                message: warning_message.clone(),
            }),
        )
        .await;
        self.record_model_warning(warning_message, turn_context)
            .await;
        true
    }

    pub fn enabled(&self, feature: Feature) -> bool {
        self.features.enabled(feature)
    }

    pub(crate) fn features(&self) -> ManagedFeatures {
        self.features.clone()
    }

    async fn maybe_start_ghost_snapshot(
        self: &Arc<Self>,
        turn_context: Arc<TurnContext>,
        cancellation_token: CancellationToken,
    ) {
        if !self.enabled(Feature::GhostCommit) {
            return;
        }
        let token = match turn_context.tool_call_gate.subscribe().await {
            Ok(token) => token,
            Err(err) => {
                warn!("failed to subscribe to ghost snapshot readiness: {err}");
                return;
            }
        };

        info!("spawning ghost snapshot task");
        let task = GhostSnapshotTask::new(token);
        Arc::new(task)
            .run(
                Arc::new(SessionTaskContext::new(self.clone())),
                turn_context.clone(),
                Vec::new(),
                cancellation_token,
            )
            .await;
    }

    pub async fn steer_input(
        &self,
        input: Vec<UserInput>,
        expected_turn_id: Option<&str>,
    ) -> Result<String, SteerInputError> {
        if input.is_empty() {
            return Err(SteerInputError::EmptyInput);
        }

        let mut active = self.active_turn.lock().await;
        let Some(active_turn) = active.as_mut() else {
            return Err(SteerInputError::NoActiveTurn(input));
        };

        let Some((active_turn_id, _)) = active_turn.tasks.first() else {
            return Err(SteerInputError::NoActiveTurn(input));
        };

        if let Some(expected_turn_id) = expected_turn_id
            && expected_turn_id != active_turn_id
        {
            return Err(SteerInputError::ExpectedTurnMismatch {
                expected: expected_turn_id.to_string(),
                actual: active_turn_id.clone(),
            });
        }

        let mut turn_state = active_turn.turn_state.lock().await;
        turn_state.push_pending_input(input.into());
        Ok(active_turn_id.clone())
    }

    pub async fn inject_response_items(
        &self,
        input: Vec<ResponseInputItem>,
    ) -> Result<(), Vec<ResponseInputItem>> {
        let mut active = self.active_turn.lock().await;
        match active.as_mut() {
            Some(at) => {
                let mut ts = at.turn_state.lock().await;
                for item in input {
                    ts.push_pending_input(item);
                }
                Ok(())
            }
            None => Err(input),
        }
    }

    pub async fn get_pending_input(&self) -> Vec<ResponseInputItem> {
        let mut active = self.active_turn.lock().await;
        match active.as_mut() {
            Some(at) => {
                let mut ts = at.turn_state.lock().await;
                ts.take_pending_input()
            }
            None => Vec::with_capacity(0),
        }
    }

    pub async fn has_pending_input(&self) -> bool {
        let active = self.active_turn.lock().await;
        match active.as_ref() {
            Some(at) => {
                let ts = at.turn_state.lock().await;
                ts.has_pending_input()
            }
            None => false,
        }
    }

    pub async fn interrupt_task(self: &Arc<Self>) {
        info!("interrupt received: abort current task, if any");
        let has_active_turn = { self.active_turn.lock().await.is_some() };
        if has_active_turn {
            self.abort_all_tasks(TurnAbortReason::Interrupted).await;
        } else {
            self.cancel_mcp_startup().await;
        }
    }

    pub(crate) fn hooks(&self) -> &Hooks {
        &self.services.hooks
    }

    pub(crate) fn user_shell(&self) -> Arc<shell::Shell> {
        Arc::clone(&self.services.user_shell)
    }

    fn show_raw_agent_reasoning(&self) -> bool {
        self.services.show_raw_agent_reasoning
    }
}
