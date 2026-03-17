use super::*;

#[derive(Debug)]
pub(super) struct SamplingRequestResult {
    pub(super) needs_follow_up: bool,
    pub(super) last_agent_message: Option<String>,
}

async fn drain_in_flight(
    in_flight: &mut FuturesOrdered<BoxFuture<'static, CodexResult<ResponseInputItem>>>,
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
) -> CodexResult<()> {
    while let Some(res) = in_flight.next().await {
        match res {
            Ok(response_input) => {
                sess.record_conversation_items(&turn_context, &[response_input.into()])
                    .await;
            }
            Err(err) => {
                error_or_panic(format!("in-flight tool future failed during drain: {err}"));
            }
        }
    }
    Ok(())
}

pub(crate) async fn run_sampling_request(
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    turn_diff_tracker: SharedTurnDiffTracker,
    client_session: &mut ModelClientSession,
    turn_metadata_header: Option<&str>,
    input: Vec<ResponseItem>,
    explicitly_enabled_connectors: &HashSet<String>,
    skills_outcome: Option<&SkillLoadOutcome>,
    server_model_warning_emitted_for_turn: &mut bool,
    cancellation_token: CancellationToken,
) -> CodexResult<SamplingRequestResult> {
    let router = built_tools(
        sess.as_ref(),
        turn_context.as_ref(),
        &input,
        explicitly_enabled_connectors,
        skills_outcome,
        &cancellation_token,
    )
    .await?;

    let base_instructions = sess.get_base_instructions().await;

    let prompt = build_prompt(
        input,
        router.as_ref(),
        turn_context.as_ref(),
        base_instructions,
    );
    let mut retries = 0;
    loop {
        let err = match try_run_sampling_request(
            Arc::clone(&router),
            Arc::clone(&sess),
            Arc::clone(&turn_context),
            client_session,
            turn_metadata_header,
            Arc::clone(&turn_diff_tracker),
            server_model_warning_emitted_for_turn,
            &prompt,
            cancellation_token.child_token(),
        )
        .await
        {
            Ok(output) => {
                return Ok(output);
            }
            Err(CodexErr::ContextWindowExceeded) => {
                sess.set_total_tokens_full(&turn_context).await;
                return Err(CodexErr::ContextWindowExceeded);
            }
            Err(CodexErr::UsageLimitReached(e)) => {
                let rate_limits = e.rate_limits.clone();
                if let Some(rate_limits) = rate_limits {
                    sess.update_rate_limits(&turn_context, *rate_limits).await;
                }
                return Err(CodexErr::UsageLimitReached(e));
            }
            Err(err) => err,
        };

        if !err.is_retryable() {
            return Err(err);
        }

        let max_retries = turn_context.provider.stream_max_retries();
        if retries >= max_retries
            && client_session.try_switch_fallback_transport(
                &turn_context.session_telemetry,
                &turn_context.model_info,
            )
        {
            sess.send_event(
                &turn_context,
                EventMsg::Warning(WarningEvent {
                    message: format!("Falling back from WebSockets to HTTPS transport. {err:#}"),
                }),
            )
            .await;
            retries = 0;
            continue;
        }
        if retries < max_retries {
            retries += 1;
            let delay = match &err {
                CodexErr::Stream(_, requested_delay) => {
                    requested_delay.unwrap_or_else(|| backoff(retries))
                }
                _ => backoff(retries),
            };
            warn!(
                "stream disconnected - retrying sampling request ({retries}/{max_retries} in {delay:?})...",
            );

            let report_error = retries > 1
                || cfg!(debug_assertions)
                || !sess
                    .services
                    .model_client
                    .responses_websocket_enabled(&turn_context.model_info);
            if report_error {
                sess.notify_stream_error(
                    &turn_context,
                    format!("Reconnecting... {retries}/{max_retries}"),
                    err,
                )
                .await;
            }
            crate::time::sleep(delay).await;
        } else {
            return Err(err);
        }
    }
}

pub(crate) async fn built_tools(
    sess: &Session,
    turn_context: &TurnContext,
    _input: &[ResponseItem],
    explicitly_enabled_connectors: &HashSet<String>,
    _skills_outcome: Option<&SkillLoadOutcome>,
    _cancellation_token: &CancellationToken,
) -> CodexResult<Arc<ToolRouter>> {
    let mcp_tools = HashMap::new();
    let loaded_plugins = sess
        .services
        .plugins_manager
        .plugins_for_config(&turn_context.config);

    let mut effective_explicitly_enabled_connectors = explicitly_enabled_connectors.clone();
    effective_explicitly_enabled_connectors.extend(sess.get_connector_selection().await);

    let apps_enabled = turn_context.apps_enabled();
    let accessible_connectors =
        apps_enabled.then(|| connectors::accessible_connectors_from_mcp_tools(&mcp_tools));
    let accessible_connectors_with_enabled_state =
        accessible_connectors.as_ref().map(|connectors| {
            connectors::with_app_enabled_state(connectors.clone(), &turn_context.config)
        });
    let connectors = if apps_enabled {
        let connectors = connectors::merge_plugin_apps_with_accessible(
            loaded_plugins.effective_apps(),
            accessible_connectors.clone().unwrap_or_default(),
        );
        Some(connectors::with_app_enabled_state(
            connectors,
            &turn_context.config,
        ))
    } else {
        None
    };
    let discoverable_tools = if apps_enabled
        && turn_context.tools_config.search_tool
        && turn_context.tools_config.tool_suggest
    {
        if let Some(accessible_connectors) = accessible_connectors_with_enabled_state.as_ref() {
            match connectors::list_tool_suggest_discoverable_tools(
                Arc::clone(&sess.services.discoverable_apps_provider),
                accessible_connectors.as_slice(),
            )
            .await
            {
                Ok(connectors) if connectors.is_empty() => None,
                Ok(connectors) => {
                    Some(connectors.into_iter().map(DiscoverableTool::from).collect())
                }
                Err(err) => {
                    warn!("failed to load discoverable tool suggestions: {err:#}");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    let app_tools = connectors.as_ref().and_then(|connectors| {
        let filtered = filter_codex_apps_mcp_tools(&mcp_tools, connectors, &turn_context.config);
        (!filtered.is_empty()).then_some(filtered)
    });

    Ok(Arc::new(ToolRouter::from_config(
        &turn_context.tools_config,
        ToolRouterParams {
            mcp_tools: None,
            app_tools,
            discoverable_tools,
            dynamic_tools: turn_context.dynamic_tools.as_slice(),
        },
    )))
}

#[allow(clippy::too_many_arguments)]
#[instrument(level = "trace", skip_all, fields(turn_id = %turn_context.sub_id, model = %turn_context.model_info.slug))]
async fn try_run_sampling_request(
    router: Arc<ToolRouter>,
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    client_session: &mut ModelClientSession,
    turn_metadata_header: Option<&str>,
    turn_diff_tracker: SharedTurnDiffTracker,
    server_model_warning_emitted_for_turn: &mut bool,
    prompt: &Prompt,
    cancellation_token: CancellationToken,
) -> CodexResult<SamplingRequestResult> {
    feedback_tags!(
        model = turn_context.model_info.slug.clone(),
        approval_policy = turn_context.approval_policy.value(),
        sandbox_policy = turn_context.sandbox_policy.get(),
        effort = turn_context.reasoning_effort,
        auth_mode = sess.services.auth_manager.auth_mode(),
        features = sess.features.enabled_features(),
    );
    let mut stream = client_session
        .stream(
            prompt,
            &turn_context.model_info,
            &turn_context.session_telemetry,
            turn_context.reasoning_effort,
            turn_context.reasoning_summary,
            turn_context.config.service_tier,
            turn_metadata_header,
        )
        .instrument(trace_span!("stream_request"))
        .or_cancel(&cancellation_token)
        .await??;

    let tool_runtime = ToolCallRuntime::new(
        Arc::clone(&router),
        Arc::clone(&sess),
        Arc::clone(&turn_context),
        Arc::clone(&turn_diff_tracker),
    );
    let mut in_flight: FuturesOrdered<BoxFuture<'static, CodexResult<ResponseInputItem>>> =
        FuturesOrdered::new();
    let mut needs_follow_up = false;
    let mut last_agent_message: Option<String> = None;
    let mut active_item: Option<TurnItem> = None;
    let mut should_emit_turn_diff = false;
    let plan_mode = turn_context.collaboration_mode.mode == ModeKind::Plan;
    let mut assistant_message_stream_parsers = AssistantMessageStreamParsers::new(plan_mode);
    let mut plan_mode_state = plan_mode.then(|| PlanModeStreamState::new(&turn_context.sub_id));
    let receiving_span = trace_span!("receiving_stream");
    let outcome: CodexResult<SamplingRequestResult> = loop {
        let handle_responses = trace_span!(
            parent: &receiving_span,
            "handle_responses",
            otel.name = field::Empty,
            tool_name = field::Empty,
            from = field::Empty,
        );

        let event = match stream
            .next()
            .instrument(trace_span!(parent: &handle_responses, "receiving"))
            .or_cancel(&cancellation_token)
            .await
        {
            Ok(event) => event,
            Err(codex_async_utils::CancelErr::Cancelled) => break Err(CodexErr::TurnAborted),
        };

        let event = match event {
            Some(res) => res?,
            None => {
                break Err(CodexErr::Stream(
                    "stream closed before response.completed".into(),
                    None,
                ));
            }
        };

        sess.services
            .session_telemetry
            .record_responses(&handle_responses, &event);
        record_turn_ttft_metric(&turn_context, &event).await;

        match event {
            ResponseEvent::Created => {}
            ResponseEvent::OutputItemDone(item) => {
                let previously_active_item = active_item.take();
                if let Some(previous) = previously_active_item.as_ref()
                    && matches!(previous, TurnItem::AgentMessage(_))
                {
                    let item_id = previous.id();
                    flush_assistant_text_segments_for_item(
                        &sess,
                        &turn_context,
                        plan_mode_state.as_mut(),
                        &mut assistant_message_stream_parsers,
                        &item_id,
                    )
                    .await;
                }
                if let Some(state) = plan_mode_state.as_mut()
                    && handle_assistant_item_done_in_plan_mode(
                        &sess,
                        &turn_context,
                        &item,
                        state,
                        previously_active_item.as_ref(),
                        &mut last_agent_message,
                    )
                    .await
                {
                    continue;
                }

                let mut ctx = HandleOutputCtx {
                    sess: sess.clone(),
                    turn_context: turn_context.clone(),
                    tool_runtime: tool_runtime.clone(),
                    cancellation_token: cancellation_token.child_token(),
                };

                let output_result = handle_output_item_done(&mut ctx, item, previously_active_item)
                    .instrument(handle_responses)
                    .await?;
                if let Some(tool_future) = output_result.tool_future {
                    in_flight.push_back(tool_future);
                }
                if let Some(agent_message) = output_result.last_agent_message {
                    last_agent_message = Some(agent_message);
                }
                needs_follow_up |= output_result.needs_follow_up;
            }
            ResponseEvent::OutputItemAdded(item) => {
                if let Some(turn_item) = handle_non_tool_response_item(
                    sess.as_ref(),
                    turn_context.as_ref(),
                    &item,
                    plan_mode,
                )
                .await
                {
                    let mut turn_item = turn_item;
                    let mut seeded_parsed: Option<ParsedAssistantTextDelta> = None;
                    let mut seeded_item_id: Option<String> = None;
                    if matches!(turn_item, TurnItem::AgentMessage(_))
                        && let Some(raw_text) = raw_assistant_output_text_from_item(&item)
                    {
                        let item_id = turn_item.id();
                        let mut seeded =
                            assistant_message_stream_parsers.seed_item_text(&item_id, &raw_text);
                        if let TurnItem::AgentMessage(agent_message) = &mut turn_item {
                            agent_message.content =
                                vec![codex_protocol::items::AgentMessageContent::Text {
                                    text: if plan_mode {
                                        String::new()
                                    } else {
                                        std::mem::take(&mut seeded.visible_text)
                                    },
                                }];
                        }
                        seeded_parsed = plan_mode.then_some(seeded);
                        seeded_item_id = Some(item_id);
                    }
                    if let Some(state) = plan_mode_state.as_mut()
                        && matches!(turn_item, TurnItem::AgentMessage(_))
                    {
                        let item_id = turn_item.id();
                        state
                            .pending_agent_message_items
                            .insert(item_id, turn_item.clone());
                    } else {
                        sess.emit_turn_item_started(&turn_context, &turn_item).await;
                    }
                    if let (Some(state), Some(item_id), Some(parsed)) = (
                        plan_mode_state.as_mut(),
                        seeded_item_id.as_deref(),
                        seeded_parsed,
                    ) {
                        emit_streamed_assistant_text_delta(
                            &sess,
                            &turn_context,
                            Some(state),
                            item_id,
                            parsed,
                        )
                        .await;
                    }
                    active_item = Some(turn_item);
                }
            }
            ResponseEvent::ServerModel(server_model) => {
                if !*server_model_warning_emitted_for_turn
                    && sess
                        .maybe_warn_on_server_model_mismatch(&turn_context, server_model)
                        .await
                {
                    *server_model_warning_emitted_for_turn = true;
                }
            }
            ResponseEvent::ServerReasoningIncluded(included) => {
                sess.set_server_reasoning_included(included).await;
            }
            ResponseEvent::RateLimits(snapshot) => {
                sess.update_rate_limits(&turn_context, snapshot).await;
            }
            ResponseEvent::ModelsEtag(etag) => {
                sess.services.models_manager.refresh_if_new_etag(etag).await;
            }
            ResponseEvent::Completed {
                response_id: _,
                token_usage,
            } => {
                flush_assistant_text_segments_all(
                    &sess,
                    &turn_context,
                    plan_mode_state.as_mut(),
                    &mut assistant_message_stream_parsers,
                )
                .await;
                sess.update_token_usage_info(&turn_context, token_usage.as_ref())
                    .await;
                should_emit_turn_diff = true;
                needs_follow_up |= sess.has_pending_input().await;

                break Ok(SamplingRequestResult {
                    needs_follow_up,
                    last_agent_message,
                });
            }
            ResponseEvent::OutputTextDelta(delta) => {
                if let Some(active) = active_item.as_ref() {
                    let item_id = active.id();
                    if matches!(active, TurnItem::AgentMessage(_)) {
                        let parsed = assistant_message_stream_parsers.parse_delta(&item_id, &delta);
                        emit_streamed_assistant_text_delta(
                            &sess,
                            &turn_context,
                            plan_mode_state.as_mut(),
                            &item_id,
                            parsed,
                        )
                        .await;
                    } else {
                        let event = AgentMessageContentDeltaEvent {
                            thread_id: sess.conversation_id.to_string(),
                            turn_id: turn_context.sub_id.clone(),
                            item_id,
                            delta,
                        };
                        sess.send_event(&turn_context, EventMsg::AgentMessageContentDelta(event))
                            .await;
                    }
                } else {
                    error_or_panic("OutputTextDelta without active item".to_string());
                }
            }
            ResponseEvent::ReasoningSummaryDelta {
                delta,
                summary_index,
            } => {
                if let Some(active) = active_item.as_ref() {
                    let event = ReasoningContentDeltaEvent {
                        thread_id: sess.conversation_id.to_string(),
                        turn_id: turn_context.sub_id.clone(),
                        item_id: active.id(),
                        delta,
                        summary_index,
                    };
                    sess.send_event(&turn_context, EventMsg::ReasoningContentDelta(event))
                        .await;
                } else {
                    error_or_panic("ReasoningSummaryDelta without active item".to_string());
                }
            }
            ResponseEvent::ReasoningSummaryPartAdded { summary_index } => {
                if let Some(active) = active_item.as_ref() {
                    let event =
                        EventMsg::AgentReasoningSectionBreak(AgentReasoningSectionBreakEvent {
                            item_id: active.id(),
                            summary_index,
                        });
                    sess.send_event(&turn_context, event).await;
                } else {
                    error_or_panic("ReasoningSummaryPartAdded without active item".to_string());
                }
            }
            ResponseEvent::ReasoningContentDelta {
                delta,
                content_index,
            } => {
                if let Some(active) = active_item.as_ref() {
                    let event = ReasoningRawContentDeltaEvent {
                        thread_id: sess.conversation_id.to_string(),
                        turn_id: turn_context.sub_id.clone(),
                        item_id: active.id(),
                        delta,
                        content_index,
                    };
                    sess.send_event(&turn_context, EventMsg::ReasoningRawContentDelta(event))
                        .await;
                } else {
                    error_or_panic("ReasoningRawContentDelta without active item".to_string());
                }
            }
        }
    };

    flush_assistant_text_segments_all(
        &sess,
        &turn_context,
        plan_mode_state.as_mut(),
        &mut assistant_message_stream_parsers,
    )
    .await;

    drain_in_flight(&mut in_flight, sess.clone(), turn_context.clone()).await?;

    if cancellation_token.is_cancelled() {
        return Err(CodexErr::TurnAborted);
    }

    if should_emit_turn_diff {
        let unified_diff = {
            let tracker = turn_diff_tracker.lock().await;
            tracker.get_unified_diff()
        };
        if let Some(unified_diff) = unified_diff {
            let msg = EventMsg::TurnDiff(TurnDiffEvent { unified_diff });
            sess.clone().send_event(&turn_context, msg).await;
        }
    }

    outcome
}

pub(crate) fn get_last_assistant_message_from_turn(responses: &[ResponseItem]) -> Option<String> {
    for item in responses.iter().rev() {
        if let Some(message) = last_assistant_message_from_item(item, false) {
            return Some(message);
        }
    }
    None
}
