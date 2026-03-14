use super::*;

pub(crate) async fn run_turn(
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    input: Vec<UserInput>,
    prewarmed_client_session: Option<ModelClientSession>,
    cancellation_token: CancellationToken,
) -> Option<String> {
    if input.is_empty() {
        return None;
    }

    let model_info = turn_context.model_info.clone();
    let auto_compact_limit = model_info.auto_compact_token_limit().unwrap_or(i64::MAX);

    let event = EventMsg::TurnStarted(TurnStartedEvent {
        turn_id: turn_context.sub_id.clone(),
        model_context_window: turn_context.model_context_window(),
        collaboration_mode_kind: turn_context.collaboration_mode.mode,
    });
    sess.send_event(&turn_context, event).await;
    // TODO(ccunningham): Pre-turn compaction runs before context updates and the
    // new user message are recorded. Estimate pending incoming items (context
    // diffs/full reinjection + user input) and trigger compaction preemptively
    // when they would push the thread over the compaction threshold.
    if run_pre_sampling_compact(&sess, &turn_context)
        .await
        .is_err()
    {
        error!("Failed to run pre-sampling compact");
        return None;
    }

    let skills_outcome = Some(turn_context.turn_skills.outcome.as_ref());

    sess.record_context_updates_and_set_reference_context_item(turn_context.as_ref())
        .await;

    let loaded_plugins = sess
        .services
        .plugins_manager
        .plugins_for_config(&turn_context.config);
    // Structured plugin:// mentions are resolved from the current session's
    // enabled plugins, then converted into turn-scoped guidance below.
    let mentioned_plugins =
        collect_explicit_plugin_mentions(&input, loaded_plugins.capability_summaries());
    let mcp_tools = if turn_context.apps_enabled() || !mentioned_plugins.is_empty() {
        // Plugin mentions need raw MCP/app inventory even when app tools
        // are normally hidden so we can describe the plugin's currently
        // usable capabilities for this turn.
        match sess
            .services
            .mcp_connection_manager
            .read()
            .await
            .list_all_tools()
            .or_cancel(&cancellation_token)
            .await
        {
            Ok(mcp_tools) => mcp_tools,
            Err(_) if turn_context.apps_enabled() => return None,
            Err(_) => HashMap::new(),
        }
    } else {
        HashMap::new()
    };
    let available_connectors = if turn_context.apps_enabled() {
        let connectors = connectors::merge_plugin_apps_with_accessible(
            loaded_plugins.effective_apps(),
            connectors::accessible_connectors_from_mcp_tools(&mcp_tools),
        );
        connectors::with_app_enabled_state(connectors, &turn_context.config)
    } else {
        Vec::new()
    };
    let connector_slug_counts = build_connector_slug_counts(&available_connectors);
    let skill_name_counts_lower = skills_outcome
        .as_ref()
        .map_or_else(HashMap::new, |outcome| {
            build_skill_name_counts(&outcome.skills, &outcome.disabled_paths).1
        });
    let mentioned_skills = skills_outcome.as_ref().map_or_else(Vec::new, |outcome| {
        collect_explicit_skill_mentions(
            &input,
            &outcome.skills,
            &outcome.disabled_paths,
            &connector_slug_counts,
        )
    });
    let config = turn_context.config.clone();
    if config
        .features
        .enabled(Feature::SkillEnvVarDependencyPrompt)
    {
        let env_var_dependencies = collect_env_var_dependencies(&mentioned_skills);
        resolve_skill_dependencies_for_turn(&sess, &turn_context, &env_var_dependencies).await;
    }

    maybe_prompt_and_install_mcp_dependencies(
        sess.as_ref(),
        turn_context.as_ref(),
        &cancellation_token,
        &mentioned_skills,
    )
    .await;

    let session_telemetry = turn_context.session_telemetry.clone();
    let thread_id = sess.conversation_id.to_string();
    let tracking = build_track_events_context(
        turn_context.model_info.slug.clone(),
        thread_id,
        turn_context.sub_id.clone(),
    );
    let SkillInjections {
        items: skill_items,
        warnings: skill_warnings,
    } = build_skill_injections(
        &mentioned_skills,
        Some(&session_telemetry),
        &sess.services.analytics_events_client,
        tracking.clone(),
    )
    .await;

    for message in skill_warnings {
        sess.send_event(&turn_context, EventMsg::Warning(WarningEvent { message }))
            .await;
    }

    let plugin_items =
        build_plugin_injections(&mentioned_plugins, &mcp_tools, &available_connectors);

    let mut explicitly_enabled_connectors = collect_explicit_app_ids(&input);
    explicitly_enabled_connectors.extend(collect_explicit_app_ids_from_skill_items(
        &skill_items,
        &available_connectors,
        &skill_name_counts_lower,
    ));
    // Explicit plugin mentions can make a plugin's enabled apps callable for
    // this turn without persisting those connectors as sticky user selections.
    let mut turn_enabled_connectors = explicitly_enabled_connectors.clone();
    turn_enabled_connectors.extend(
        mentioned_plugins
            .iter()
            .flat_map(|plugin| plugin.app_connector_ids.iter())
            .map(|connector_id| connector_id.0.clone())
            .filter(|connector_id| {
                available_connectors
                    .iter()
                    .any(|connector| connector.is_enabled && connector.id == *connector_id)
            }),
    );
    let connector_names_by_id = available_connectors
        .iter()
        .map(|connector| (connector.id.as_str(), connector.name.as_str()))
        .collect::<HashMap<&str, &str>>();
    let mentioned_app_invocations = explicitly_enabled_connectors
        .iter()
        .map(|connector_id| AppInvocation {
            connector_id: Some(connector_id.clone()),
            app_name: connector_names_by_id
                .get(connector_id.as_str())
                .map(|name| (*name).to_string()),
            invocation_type: Some(InvocationType::Explicit),
        })
        .collect::<Vec<_>>();
    sess.services
        .analytics_events_client
        .track_app_mentioned(tracking.clone(), mentioned_app_invocations);
    sess.merge_connector_selection(explicitly_enabled_connectors.clone())
        .await;

    let initial_input_for_turn: ResponseInputItem = ResponseInputItem::from(input.clone());
    let response_item: ResponseItem = initial_input_for_turn.clone().into();
    sess.record_user_prompt_and_emit_turn_item(turn_context.as_ref(), &input, response_item)
        .await;
    // Track the previous-turn baseline from the regular user-turn path only so
    // standalone tasks (compact/shell/review/undo) cannot suppress future
    // model/realtime injections.
    sess.set_previous_turn_settings(Some(PreviousTurnSettings {
        model: turn_context.model_info.slug.clone(),
        realtime_active: Some(turn_context.realtime_active),
    }))
    .await;

    if !skill_items.is_empty() {
        sess.record_conversation_items(&turn_context, &skill_items)
            .await;
    }
    if !plugin_items.is_empty() {
        sess.record_conversation_items(&turn_context, &plugin_items)
            .await;
    }

    sess.maybe_start_ghost_snapshot(Arc::clone(&turn_context), cancellation_token.child_token())
        .await;
    let mut last_agent_message: Option<String> = None;
    let mut stop_hook_active = false;
    let mut pending_stop_hook_message: Option<String> = None;
    // Although from the perspective of codex.rs, TurnDiffTracker has the lifecycle of a Task which contains
    // many turns, from the perspective of the user, it is a single turn.
    let turn_diff_tracker = Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new()));
    let mut server_model_warning_emitted_for_turn = false;

    // `ModelClientSession` is turn-scoped and caches WebSocket + sticky routing state, so we reuse
    // one instance across retries within this turn.
    let mut client_session =
        prewarmed_client_session.unwrap_or_else(|| sess.services.model_client.new_session());

    loop {
        if let Some(session_start_source) = sess.take_pending_session_start_source().await {
            let session_start_permission_mode = match turn_context.approval_policy.value() {
                AskForApproval::Never => "bypassPermissions",
                AskForApproval::UnlessTrusted
                | AskForApproval::OnFailure
                | AskForApproval::OnRequest
                | AskForApproval::Reject(_) => "default",
            }
            .to_string();
            let session_start_request = codex_hooks::SessionStartRequest {
                session_id: sess.conversation_id,
                cwd: turn_context.cwd.clone(),
                transcript_path: sess.current_rollout_path().await,
                model: turn_context.model_info.slug.clone(),
                permission_mode: session_start_permission_mode,
                source: session_start_source,
            };
            for run in sess.hooks().preview_session_start(&session_start_request) {
                sess.send_event(
                    &turn_context,
                    EventMsg::HookStarted(crate::protocol::HookStartedEvent {
                        turn_id: Some(turn_context.sub_id.clone()),
                        run,
                    }),
                )
                .await;
            }
            let session_start_outcome = sess
                .hooks()
                .run_session_start(session_start_request, Some(turn_context.sub_id.clone()))
                .await;
            for completed in session_start_outcome.hook_events {
                sess.send_event(&turn_context, EventMsg::HookCompleted(completed))
                    .await;
            }
            if session_start_outcome.should_stop {
                break;
            }
            if let Some(additional_context) = session_start_outcome.additional_context {
                let developer_message: ResponseItem =
                    DeveloperInstructions::new(additional_context).into();
                sess.record_conversation_items(
                    &turn_context,
                    std::slice::from_ref(&developer_message),
                )
                .await;
            }
        }

        // Note that pending_input would be something like a message the user
        // submitted through the UI while the model was running. Though the UI
        // may support this, the model might not.
        let pending_response_items = sess
            .get_pending_input()
            .await
            .into_iter()
            .map(ResponseItem::from)
            .collect::<Vec<ResponseItem>>();

        if !pending_response_items.is_empty() {
            for response_item in pending_response_items {
                if let Some(TurnItem::UserMessage(user_message)) = parse_turn_item(&response_item) {
                    // todo(aibrahim): move pending input to be UserInput only to keep TextElements. context: https://github.com/openai/codex/pull/10656#discussion_r2765522480
                    sess.record_user_prompt_and_emit_turn_item(
                        turn_context.as_ref(),
                        &user_message.content,
                        response_item,
                    )
                    .await;
                } else {
                    sess.record_conversation_items(
                        &turn_context,
                        std::slice::from_ref(&response_item),
                    )
                    .await;
                }
            }
        }

        // Construct the input that we will send to the model.
        let mut sampling_request_input: Vec<ResponseItem> = {
            sess.clone_history()
                .await
                .for_prompt(&turn_context.model_info.input_modalities)
        };
        if let Some(stop_hook_message) = pending_stop_hook_message.take() {
            sampling_request_input.push(DeveloperInstructions::new(stop_hook_message).into());
        }

        let sampling_request_input_messages = sampling_request_input
            .iter()
            .filter_map(|item| match parse_turn_item(item) {
                Some(TurnItem::UserMessage(user_message)) => Some(user_message),
                _ => None,
            })
            .map(|user_message| user_message.message())
            .collect::<Vec<String>>();
        let turn_metadata_header = turn_context.turn_metadata_state.current_header_value();
        match run_sampling_request(
            Arc::clone(&sess),
            Arc::clone(&turn_context),
            Arc::clone(&turn_diff_tracker),
            &mut client_session,
            turn_metadata_header.as_deref(),
            sampling_request_input,
            &turn_enabled_connectors,
            skills_outcome,
            &mut server_model_warning_emitted_for_turn,
            cancellation_token.child_token(),
        )
        .await
        {
            Ok(sampling_request_output) => {
                let SamplingRequestResult {
                    needs_follow_up,
                    last_agent_message: sampling_request_last_agent_message,
                } = sampling_request_output;
                let total_usage_tokens = sess.get_total_token_usage().await;
                let token_limit_reached = total_usage_tokens >= auto_compact_limit;

                let estimated_token_count =
                    sess.get_estimated_token_count(turn_context.as_ref()).await;

                trace!(
                    turn_id = %turn_context.sub_id,
                    total_usage_tokens,
                    estimated_token_count = ?estimated_token_count,
                    auto_compact_limit,
                    token_limit_reached,
                    needs_follow_up,
                    "post sampling token usage"
                );

                // as long as compaction works well in getting us way below the token limit, we shouldn't worry about being in an infinite loop.
                if token_limit_reached && needs_follow_up {
                    if run_auto_compact(
                        &sess,
                        &turn_context,
                        InitialContextInjection::BeforeLastUserMessage,
                    )
                    .await
                    .is_err()
                    {
                        return None;
                    }
                    continue;
                }

                if !needs_follow_up {
                    last_agent_message = sampling_request_last_agent_message;
                    let stop_hook_permission_mode = match turn_context.approval_policy.value() {
                        AskForApproval::Never => "bypassPermissions",
                        AskForApproval::UnlessTrusted
                        | AskForApproval::OnFailure
                        | AskForApproval::OnRequest
                        | AskForApproval::Reject(_) => "default",
                    }
                    .to_string();
                    let stop_request = codex_hooks::StopRequest {
                        session_id: sess.conversation_id,
                        turn_id: turn_context.sub_id.clone(),
                        cwd: turn_context.cwd.clone(),
                        transcript_path: sess.current_rollout_path().await,
                        model: turn_context.model_info.slug.clone(),
                        permission_mode: stop_hook_permission_mode,
                        stop_hook_active,
                        last_assistant_message: last_agent_message.clone(),
                    };
                    for run in sess.hooks().preview_stop(&stop_request) {
                        sess.send_event(
                            &turn_context,
                            EventMsg::HookStarted(crate::protocol::HookStartedEvent {
                                turn_id: Some(turn_context.sub_id.clone()),
                                run,
                            }),
                        )
                        .await;
                    }
                    let stop_outcome = sess.hooks().run_stop(stop_request).await;
                    for completed in stop_outcome.hook_events {
                        sess.send_event(&turn_context, EventMsg::HookCompleted(completed))
                            .await;
                    }
                    if stop_outcome.should_block {
                        if stop_hook_active {
                            sess.send_event(
                                &turn_context,
                                EventMsg::Warning(WarningEvent {
                                    message: "Stop hook blocked twice in the same turn; ignoring the second block to avoid an infinite loop.".to_string(),
                                }),
                            )
                            .await;
                        } else {
                            stop_hook_active = true;
                            pending_stop_hook_message = stop_outcome.block_message_for_model;
                            continue;
                        }
                    }
                    if stop_outcome.should_stop {
                        break;
                    }
                    let hook_outcomes = sess
                        .hooks()
                        .dispatch(HookPayload {
                            session_id: sess.conversation_id,
                            cwd: turn_context.cwd.clone(),
                            client: turn_context.app_server_client_name.clone(),
                            triggered_at: chrono::Utc::now(),
                            hook_event: HookEvent::AfterAgent {
                                event: HookEventAfterAgent {
                                    thread_id: sess.conversation_id,
                                    turn_id: turn_context.sub_id.clone(),
                                    input_messages: sampling_request_input_messages,
                                    last_assistant_message: last_agent_message.clone(),
                                },
                            },
                        })
                        .await;

                    let mut abort_message = None;
                    for hook_outcome in hook_outcomes {
                        let hook_name = hook_outcome.hook_name;
                        match hook_outcome.result {
                            HookResult::Success => {}
                            HookResult::FailedContinue(error) => {
                                warn!(
                                    turn_id = %turn_context.sub_id,
                                    hook_name = %hook_name,
                                    error = %error,
                                    "after_agent hook failed; continuing"
                                );
                            }
                            HookResult::FailedAbort(error) => {
                                let message = format!(
                                    "after_agent hook '{hook_name}' failed and aborted turn completion: {error}"
                                );
                                warn!(
                                    turn_id = %turn_context.sub_id,
                                    hook_name = %hook_name,
                                    error = %error,
                                    "after_agent hook failed; aborting operation"
                                );
                                if abort_message.is_none() {
                                    abort_message = Some(message);
                                }
                            }
                        }
                    }
                    if let Some(message) = abort_message {
                        sess.send_event(
                            &turn_context,
                            EventMsg::Error(ErrorEvent {
                                message,
                                codex_error_info: None,
                            }),
                        )
                        .await;
                        return None;
                    }
                    break;
                }
                continue;
            }
            Err(CodexErr::TurnAborted) => {
                // Aborted turn is reported via a different event.
                break;
            }
            Err(CodexErr::InvalidImageRequest()) => {
                let mut state = sess.state.lock().await;
                error_or_panic(
                    "Invalid image detected; sanitizing tool output to prevent poisoning",
                );
                if state.history.replace_last_turn_images("Invalid image") {
                    continue;
                }
                let event = EventMsg::Error(ErrorEvent {
                    message: "Invalid image in your last message. Please remove it and try again."
                        .to_string(),
                    codex_error_info: Some(CodexErrorInfo::BadRequest),
                });
                sess.send_event(&turn_context, event).await;
                break;
            }
            Err(e) => {
                info!("Turn error: {e:#}");
                let event = EventMsg::Error(e.to_error_event(None));
                sess.send_event(&turn_context, event).await;
                // let the user continue the conversation
                break;
            }
        }
    }

    last_agent_message
}

async fn run_pre_sampling_compact(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
) -> CodexResult<()> {
    let total_usage_tokens_before_compaction = sess.get_total_token_usage().await;
    maybe_run_previous_model_inline_compact(
        sess,
        turn_context,
        total_usage_tokens_before_compaction,
    )
    .await?;
    let total_usage_tokens = sess.get_total_token_usage().await;
    let auto_compact_limit = turn_context
        .model_info
        .auto_compact_token_limit()
        .unwrap_or(i64::MAX);
    if total_usage_tokens >= auto_compact_limit {
        run_auto_compact(sess, turn_context, InitialContextInjection::DoNotInject).await?;
    }
    Ok(())
}

async fn maybe_run_previous_model_inline_compact(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    total_usage_tokens: i64,
) -> CodexResult<bool> {
    let Some(previous_turn_settings) = sess.previous_turn_settings().await else {
        return Ok(false);
    };
    let previous_model_turn_context = Arc::new(
        turn_context
            .with_model(previous_turn_settings.model, &sess.services.models_manager)
            .await,
    );

    let Some(old_context_window) = previous_model_turn_context.model_context_window() else {
        return Ok(false);
    };
    let Some(new_context_window) = turn_context.model_context_window() else {
        return Ok(false);
    };
    let new_auto_compact_limit = turn_context
        .model_info
        .auto_compact_token_limit()
        .unwrap_or(i64::MAX);
    let should_run = total_usage_tokens > new_auto_compact_limit
        && previous_model_turn_context.model_info.slug != turn_context.model_info.slug
        && old_context_window > new_context_window;
    if should_run {
        run_auto_compact(
            sess,
            &previous_model_turn_context,
            InitialContextInjection::DoNotInject,
        )
        .await?;
        return Ok(true);
    }
    Ok(false)
}

async fn run_auto_compact(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    initial_context_injection: InitialContextInjection,
) -> CodexResult<()> {
    if should_use_remote_compact_task(&turn_context.provider) {
        run_inline_remote_auto_compact_task(
            Arc::clone(sess),
            Arc::clone(turn_context),
            initial_context_injection,
        )
        .await?;
    } else {
        run_inline_auto_compact_task(
            Arc::clone(sess),
            Arc::clone(turn_context),
            initial_context_injection,
        )
        .await?;
    }
    Ok(())
}

pub(crate) fn collect_explicit_app_ids_from_skill_items(
    skill_items: &[ResponseItem],
    connectors: &[connectors::AppInfo],
    skill_name_counts_lower: &HashMap<String, usize>,
) -> HashSet<String> {
    if skill_items.is_empty() || connectors.is_empty() {
        return HashSet::new();
    }

    let skill_messages = skill_items
        .iter()
        .filter_map(|item| match item {
            ResponseItem::Message { content, .. } => {
                content.iter().find_map(|content_item| match content_item {
                    ContentItem::InputText { text } => Some(text.clone()),
                    _ => None,
                })
            }
            _ => None,
        })
        .collect::<Vec<String>>();
    if skill_messages.is_empty() {
        return HashSet::new();
    }

    let mentions = collect_tool_mentions_from_messages(&skill_messages);
    let mention_names_lower = mentions
        .plain_names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<String>>();
    let mut connector_ids = mentions
        .paths
        .iter()
        .filter(|path| tool_kind_for_path(path) == ToolMentionKind::App)
        .filter_map(|path| app_id_from_path(path).map(str::to_string))
        .collect::<HashSet<String>>();

    let connector_slug_counts = build_connector_slug_counts(connectors);
    for connector in connectors {
        let slug = connectors::connector_mention_slug(connector);
        let connector_count = connector_slug_counts.get(&slug).copied().unwrap_or(0);
        let skill_count = skill_name_counts_lower.get(&slug).copied().unwrap_or(0);
        if connector_count == 1 && skill_count == 0 && mention_names_lower.contains(&slug) {
            connector_ids.insert(connector.id.clone());
        }
    }

    connector_ids
}

pub(crate) fn filter_connectors_for_input(
    connectors: &[connectors::AppInfo],
    input: &[ResponseItem],
    explicitly_enabled_connectors: &HashSet<String>,
    skill_name_counts_lower: &HashMap<String, usize>,
) -> Vec<connectors::AppInfo> {
    let connectors: Vec<connectors::AppInfo> = connectors
        .iter()
        .filter(|connector| connector.is_enabled)
        .cloned()
        .collect::<Vec<_>>();
    if connectors.is_empty() {
        return Vec::new();
    }

    let user_messages = collect_user_messages(input);
    if user_messages.is_empty() && explicitly_enabled_connectors.is_empty() {
        return Vec::new();
    }

    let mentions = collect_tool_mentions_from_messages(&user_messages);
    let mention_names_lower = mentions
        .plain_names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<String>>();

    let connector_slug_counts = build_connector_slug_counts(&connectors);
    let mut allowed_connector_ids = explicitly_enabled_connectors.clone();
    for path in mentions
        .paths
        .iter()
        .filter(|path| tool_kind_for_path(path) == ToolMentionKind::App)
    {
        if let Some(connector_id) = app_id_from_path(path) {
            allowed_connector_ids.insert(connector_id.to_string());
        }
    }

    connectors
        .into_iter()
        .filter(|connector| {
            connector_inserted_in_messages(
                connector,
                &mention_names_lower,
                &allowed_connector_ids,
                &connector_slug_counts,
                skill_name_counts_lower,
            )
        })
        .collect()
}

fn connector_inserted_in_messages(
    connector: &connectors::AppInfo,
    mention_names_lower: &HashSet<String>,
    allowed_connector_ids: &HashSet<String>,
    connector_slug_counts: &HashMap<String, usize>,
    skill_name_counts_lower: &HashMap<String, usize>,
) -> bool {
    if allowed_connector_ids.contains(&connector.id) {
        return true;
    }

    let mention_slug = connectors::connector_mention_slug(connector);
    let connector_count = connector_slug_counts
        .get(&mention_slug)
        .copied()
        .unwrap_or(0);
    let skill_count = skill_name_counts_lower
        .get(&mention_slug)
        .copied()
        .unwrap_or(0);
    connector_count == 1 && skill_count == 0 && mention_names_lower.contains(&mention_slug)
}

pub(crate) fn filter_codex_apps_mcp_tools(
    mcp_tools: &HashMap<String, crate::mcp_connection_manager::ToolInfo>,
    connectors: &[connectors::AppInfo],
    config: &Config,
) -> HashMap<String, crate::mcp_connection_manager::ToolInfo> {
    let allowed: HashSet<&str> = connectors
        .iter()
        .map(|connector| connector.id.as_str())
        .collect();

    mcp_tools
        .iter()
        .filter(|(_, tool)| {
            if tool.server_name != CODEX_APPS_MCP_SERVER_NAME {
                return false;
            }
            let Some(connector_id) = codex_apps_connector_id(tool) else {
                return false;
            };
            allowed.contains(connector_id) && connectors::codex_app_tool_is_enabled(config, tool)
        })
        .map(|(name, tool)| (name.clone(), tool.clone()))
        .collect()
}

fn codex_apps_connector_id(tool: &crate::mcp_connection_manager::ToolInfo) -> Option<&str> {
    tool.connector_id.as_deref()
}
