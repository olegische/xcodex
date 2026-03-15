use super::*;
use pretty_assertions::assert_eq;

#[tokio::test]
async fn tool_suggest_dispatch_emits_elicitation_and_returns_completed_result() {
    let (session, turn_context, rx) = make_session_and_context_with_rx().await;
    *session.active_turn.lock().await = Some(ActiveTurn::default());
    let router = ToolRouter::from_config(
        &crate::tools::spec::ToolsConfig {
            tool_suggest: true,
            ..crate::tools::spec::ToolsConfig::default()
        },
        crate::tools::router::ToolRouterParams {
            mcp_tools: None,
            app_tools: None,
            discoverable_tools: Some(vec![crate::tools::discoverable::DiscoverableTool::from(
                AppInfo {
                    id: "calendar".to_string(),
                    name: "Google Calendar".to_string(),
                    description: Some("Plan events and schedules.".to_string()),
                    logo_url: None,
                    logo_url_dark: None,
                    distribution_channel: None,
                    branding: None,
                    app_metadata: None,
                    labels: None,
                    install_url: Some(
                        "https://chatgpt.com/apps/google-calendar/calendar".to_string(),
                    ),
                    is_accessible: false,
                    is_enabled: false,
                    plugin_display_names: Vec::new(),
                },
            )]),
            dynamic_tools: turn_context.dynamic_tools.as_slice(),
        },
    );
    let call = ToolCall {
        tool_name: "tool_suggest".to_string(),
        tool_namespace: None,
        call_id: "call-1".to_string(),
        payload: ToolPayload::Function {
            arguments: json!({
                "tool_type": "connector",
                "action_type": "install",
                "tool_id": "calendar",
                "suggest_reason": "Plan and reference events from your calendar"
            })
            .to_string(),
        },
    };
    let tracker = Arc::new(tokio::sync::Mutex::new(TurnDiffTracker::new()));
    let session_for_response = Arc::clone(&session);
    tokio::spawn(async move {
        loop {
            let event = rx.recv().await.expect("elicitation request event");
            if let EventMsg::ElicitationRequest(request) = event.msg {
                assert_eq!(request.server_name, crate::mcp::CODEX_APPS_MCP_SERVER_NAME);
                handlers::resolve_elicitation(
                    &session_for_response,
                    request.server_name,
                    request.id,
                    codex_protocol::approvals::ElicitationAction::Accept,
                    Some(json!({})),
                    None,
                )
                .await;
                break;
            }
        }
    });

    let response = router
        .dispatch_tool_call(
            Arc::clone(&session),
            Arc::clone(&turn_context),
            tracker,
            call,
            ToolCallSource::Direct,
        )
        .await
        .expect("tool suggest should succeed");

    match response {
        ResponseInputItem::FunctionCallOutput { call_id, output } => {
            assert_eq!(call_id, "call-1");
            assert_eq!(output.success, Some(true));
            let content = output.body.to_text().expect("text body");
            let result: serde_json::Value =
                serde_json::from_str(content.as_str()).expect("valid json result");
            assert_eq!(result["completed"], json!(true));
            assert_eq!(result["user_confirmed"], json!(true));
            assert_eq!(result["tool_id"], json!("calendar"));
            assert_eq!(result["tool_name"], json!("Google Calendar"));
        }
        other => panic!("expected function call output, got {other:?}"),
    }

    assert!(session.get_connector_selection().await.contains("calendar"));
}
