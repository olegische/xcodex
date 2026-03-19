use codex_app_server_protocol::Turn;
use codex_protocol::protocol::RolloutItem;

pub(crate) fn build_turns_from_wasm_rollout_items(items: &[RolloutItem]) -> Vec<Turn> {
    let normalized_items =
        crate::wasm_rollout_adapter::normalize_rollout_items_for_upstream_replay(items);
    codex_app_server_protocol::build_turns_from_rollout_items(&normalized_items)
}

#[cfg(test)]
mod tests {
    use codex_app_server_protocol::DynamicToolCallOutputContentItem;
    use codex_app_server_protocol::DynamicToolCallStatus;
    use codex_app_server_protocol::ThreadItem;
    use codex_protocol::models::FunctionCallOutputPayload;
    use codex_protocol::models::ResponseItem;
    use codex_protocol::protocol::DynamicToolCallResponseEvent;
    use codex_protocol::protocol::EventMsg;
    use codex_protocol::protocol::RolloutItem;
    use codex_protocol::protocol::TurnCompleteEvent;
    use codex_protocol::protocol::TurnStartedEvent;
    use codex_protocol::protocol::UserMessageEvent;
    use pretty_assertions::assert_eq;

    use super::build_turns_from_wasm_rollout_items;

    #[test]
    fn reconstructs_unqualified_builtin_browser_tools_from_rollout_items() {
        let items = vec![
            RolloutItem::EventMsg(EventMsg::TurnStarted(TurnStartedEvent {
                turn_id: "turn-1".into(),
                model_context_window: None,
                collaboration_mode_kind: Default::default(),
            })),
            RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
                message: "inspect files".into(),
                images: None,
                text_elements: Vec::new(),
                local_images: Vec::new(),
            })),
            RolloutItem::ResponseItem(ResponseItem::FunctionCall {
                id: None,
                name: "list_dir".into(),
                namespace: None,
                arguments: serde_json::json!({ "dir_path": "/workspace" }).to_string(),
                call_id: "call-1".into(),
            }),
            RolloutItem::ResponseItem(ResponseItem::FunctionCallOutput {
                call_id: "call-1".into(),
                output: FunctionCallOutputPayload::from_text("[]".into()),
            }),
            RolloutItem::EventMsg(EventMsg::TurnComplete(TurnCompleteEvent {
                turn_id: "turn-1".into(),
                last_agent_message: None,
            })),
        ];

        let turns = build_turns_from_wasm_rollout_items(&items);

        dbg!(&turns);
        assert_eq!(turns.len(), 1);
        assert_eq!(
            turns[0].items[1],
            ThreadItem::DynamicToolCall {
                id: "call-1".into(),
                tool: "browser__list_dir".into(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                    text: "[]".into(),
                }]),
                success: None,
                duration_ms: None,
            }
        );
    }

    #[test]
    fn reconstructs_browser_tools_from_raw_response_items() {
        let items = vec![
            RolloutItem::EventMsg(EventMsg::TurnStarted(TurnStartedEvent {
                turn_id: "turn-1".into(),
                model_context_window: None,
                collaboration_mode_kind: Default::default(),
            })),
            RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
                message: "inspect files".into(),
                images: None,
                text_elements: Vec::new(),
                local_images: Vec::new(),
            })),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent {
                    item: ResponseItem::FunctionCall {
                        id: None,
                        name: "list_dir".into(),
                        namespace: None,
                        arguments: serde_json::json!({ "dir_path": "/workspace" }).to_string(),
                        call_id: "call-1".into(),
                    },
                },
            )),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent {
                    item: ResponseItem::FunctionCallOutput {
                        call_id: "call-1".into(),
                        output: FunctionCallOutputPayload::from_text("[]".into()),
                    },
                },
            )),
            RolloutItem::EventMsg(EventMsg::TurnComplete(TurnCompleteEvent {
                turn_id: "turn-1".into(),
                last_agent_message: None,
            })),
        ];

        let turns = build_turns_from_wasm_rollout_items(&items);

        assert_eq!(turns.len(), 1);
        assert_eq!(
            turns[0].items[1],
            ThreadItem::DynamicToolCall {
                id: "call-1".into(),
                tool: "browser__list_dir".into(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                    text: "[]".into(),
                }]),
                success: None,
                duration_ms: None,
            }
        );
    }

    #[test]
    fn prefers_response_items_over_duplicate_browser_dynamic_tool_events() {
        let items = vec![
            RolloutItem::EventMsg(EventMsg::TurnStarted(TurnStartedEvent {
                turn_id: "turn-1".into(),
                model_context_window: None,
                collaboration_mode_kind: Default::default(),
            })),
            RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
                message: "inspect files".into(),
                images: None,
                text_elements: Vec::new(),
                local_images: Vec::new(),
            })),
            RolloutItem::ResponseItem(ResponseItem::FunctionCall {
                id: None,
                name: "list_dir".into(),
                namespace: None,
                arguments: serde_json::json!({ "dir_path": "/workspace" }).to_string(),
                call_id: "call-1".into(),
            }),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
                codex_protocol::dynamic_tools::DynamicToolCallRequest {
                    call_id: "call-1".into(),
                    turn_id: "turn-1".into(),
                    tool: "list_dir".into(),
                    arguments: serde_json::json!({ "dir_path": "/workspace" }),
                },
            )),
            RolloutItem::ResponseItem(ResponseItem::FunctionCallOutput {
                call_id: "call-1".into(),
                output: FunctionCallOutputPayload::from_text("[]".into()),
            }),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
                DynamicToolCallResponseEvent {
                    call_id: "call-1".into(),
                    turn_id: "turn-1".into(),
                    tool: "list_dir".into(),
                    arguments: serde_json::json!({ "dir_path": "/workspace" }),
                    content_items: vec![],
                    success: true,
                    error: None,
                    duration: std::time::Duration::from_secs(1),
                },
            )),
            RolloutItem::EventMsg(EventMsg::TurnComplete(TurnCompleteEvent {
                turn_id: "turn-1".into(),
                last_agent_message: None,
            })),
        ];

        let turns = build_turns_from_wasm_rollout_items(&items);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].items.len(), 2);
        assert_eq!(
            turns[0].items[1],
            ThreadItem::DynamicToolCall {
                id: "call-1".into(),
                tool: "browser__list_dir".into(),
                arguments: serde_json::json!({ "dir_path": "/workspace" }),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                    text: "[]".into(),
                }]),
                success: None,
                duration_ms: None,
            }
        );
    }

    #[test]
    fn preserves_multiple_browser_tool_calls_with_mixed_rollout_sources() {
        let assistant_pre_tool = ResponseItem::Message {
            id: None,
            role: "assistant".into(),
            content: vec![codex_protocol::models::ContentItem::OutputText {
                text: "I'll inspect the workspace first.".into(),
            }],
            end_turn: None,
            phase: None,
        };
        let assistant_between_tools = ResponseItem::Message {
            id: None,
            role: "assistant".into(),
            content: vec![codex_protocol::models::ContentItem::OutputText {
                text: "Now I'll inspect the page.".into(),
            }],
            end_turn: None,
            phase: None,
        };
        let assistant_summary = ResponseItem::Message {
            id: None,
            role: "assistant".into(),
            content: vec![codex_protocol::models::ContentItem::OutputText {
                text: "Done.".into(),
            }],
            end_turn: Some(true),
            phase: None,
        };
        let first_call = ResponseItem::FunctionCall {
            id: None,
            name: "list_dir".into(),
            namespace: None,
            arguments: serde_json::json!({ "dir_path": "/workspace" }).to_string(),
            call_id: "call-1".into(),
        };
        let first_output = ResponseItem::FunctionCallOutput {
            call_id: "call-1".into(),
            output: FunctionCallOutputPayload::from_text("[\"a.txt\"]".into()),
        };
        let second_call = ResponseItem::FunctionCall {
            id: None,
            name: "page_context".into(),
            namespace: Some("browser".into()),
            arguments: serde_json::json!({ "includeDom": true }).to_string(),
            call_id: "call-2".into(),
        };
        let second_output = ResponseItem::FunctionCallOutput {
            call_id: "call-2".into(),
            output: FunctionCallOutputPayload::from_text("{\"title\":\"Home\"}".into()),
        };
        let items = vec![
            RolloutItem::EventMsg(EventMsg::TurnStarted(TurnStartedEvent {
                turn_id: "turn-1".into(),
                model_context_window: None,
                collaboration_mode_kind: Default::default(),
            })),
            RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
                message: "inspect files and page".into(),
                images: None,
                text_elements: Vec::new(),
                local_images: Vec::new(),
            })),
            RolloutItem::ResponseItem(assistant_pre_tool.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent {
                    item: assistant_pre_tool,
                },
            )),
            RolloutItem::ResponseItem(first_call.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent { item: first_call },
            )),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
                codex_protocol::dynamic_tools::DynamicToolCallRequest {
                    call_id: "call-1".into(),
                    turn_id: "turn-1".into(),
                    tool: "list_dir".into(),
                    arguments: serde_json::json!({ "dir_path": "/workspace" }),
                },
            )),
            RolloutItem::ResponseItem(first_output.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent { item: first_output },
            )),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
                DynamicToolCallResponseEvent {
                    call_id: "call-1".into(),
                    turn_id: "turn-1".into(),
                    tool: "list_dir".into(),
                    arguments: serde_json::json!({ "dir_path": "/workspace" }),
                    content_items: vec![codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputText {
                        text: "[\"a.txt\"]".into(),
                    }],
                    success: true,
                    error: None,
                    duration: std::time::Duration::from_millis(40),
                },
            )),
            RolloutItem::ResponseItem(assistant_between_tools.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent {
                    item: assistant_between_tools,
                },
            )),
            RolloutItem::ResponseItem(second_call.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent { item: second_call },
            )),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
                codex_protocol::dynamic_tools::DynamicToolCallRequest {
                    call_id: "call-2".into(),
                    turn_id: "turn-1".into(),
                    tool: "page_context".into(),
                    arguments: serde_json::json!({ "includeDom": true }),
                },
            )),
            RolloutItem::ResponseItem(second_output.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent { item: second_output },
            )),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
                DynamicToolCallResponseEvent {
                    call_id: "call-2".into(),
                    turn_id: "turn-1".into(),
                    tool: "page_context".into(),
                    arguments: serde_json::json!({ "includeDom": true }),
                    content_items: vec![codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputText {
                        text: "{\"title\":\"Home\"}".into(),
                    }],
                    success: true,
                    error: None,
                    duration: std::time::Duration::from_millis(80),
                },
            )),
            RolloutItem::ResponseItem(assistant_summary.clone()),
            RolloutItem::EventMsg(EventMsg::RawResponseItem(
                codex_protocol::protocol::RawResponseItemEvent {
                    item: assistant_summary,
                },
            )),
            RolloutItem::EventMsg(EventMsg::TurnComplete(TurnCompleteEvent {
                turn_id: "turn-1".into(),
                last_agent_message: None,
            })),
        ];

        let turns = build_turns_from_wasm_rollout_items(&items);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].items.len(), 3);
        assert_eq!(
            turns[0].items,
            vec![
                ThreadItem::UserMessage {
                    id: "item-1".into(),
                    content: vec![codex_app_server_protocol::UserInput::Text {
                        text: "inspect files and page".into(),
                        text_elements: Vec::new(),
                    }],
                },
                ThreadItem::DynamicToolCall {
                    id: "call-1".into(),
                    tool: "browser__list_dir".into(),
                    arguments: serde_json::json!({ "dir_path": "/workspace" }),
                    status: DynamicToolCallStatus::Completed,
                    content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                        text: "[\"a.txt\"]".into(),
                    }]),
                    success: None,
                    duration_ms: None,
                },
                ThreadItem::DynamicToolCall {
                    id: "call-2".into(),
                    tool: "browser__page_context".into(),
                    arguments: serde_json::json!({ "includeDom": true }),
                    status: DynamicToolCallStatus::Completed,
                    content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                        text: "{\"title\":\"Home\"}".into(),
                    }]),
                    success: None,
                    duration_ms: None,
                },
            ]
        );
    }

    #[test]
    fn prefers_response_items_for_browser_namespace_dynamic_tools() {
        let items = vec![
            RolloutItem::EventMsg(EventMsg::TurnStarted(TurnStartedEvent {
                turn_id: "turn-1".into(),
                model_context_window: None,
                collaboration_mode_kind: Default::default(),
            })),
            RolloutItem::EventMsg(EventMsg::UserMessage(UserMessageEvent {
                message: "inspect page".into(),
                images: None,
                text_elements: Vec::new(),
                local_images: Vec::new(),
            })),
            RolloutItem::ResponseItem(ResponseItem::FunctionCall {
                id: None,
                name: "page_context".into(),
                namespace: Some("browser".into()),
                arguments: serde_json::json!({ "includeDom": true }).to_string(),
                call_id: "call-1".into(),
            }),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
                codex_protocol::dynamic_tools::DynamicToolCallRequest {
                    call_id: "call-1".into(),
                    turn_id: "turn-1".into(),
                    tool: "page_context".into(),
                    arguments: serde_json::json!({ "includeDom": true }),
                },
            )),
            RolloutItem::ResponseItem(ResponseItem::FunctionCallOutput {
                call_id: "call-1".into(),
                output: FunctionCallOutputPayload::from_text("{\"title\":\"Home\"}".into()),
            }),
            RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
                DynamicToolCallResponseEvent {
                    call_id: "call-1".into(),
                    turn_id: "turn-1".into(),
                    tool: "page_context".into(),
                    arguments: serde_json::json!({ "includeDom": true }),
                    content_items: vec![codex_protocol::dynamic_tools::DynamicToolCallOutputContentItem::InputText {
                        text: "duplicate".into(),
                    }],
                    success: true,
                    error: None,
                    duration: std::time::Duration::from_secs(1),
                },
            )),
            RolloutItem::EventMsg(EventMsg::TurnComplete(TurnCompleteEvent {
                turn_id: "turn-1".into(),
                last_agent_message: None,
            })),
        ];

        let turns = build_turns_from_wasm_rollout_items(&items);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].items.len(), 2);
        assert_eq!(
            turns[0].items[1],
            ThreadItem::DynamicToolCall {
                id: "call-1".into(),
                tool: "browser__page_context".into(),
                arguments: serde_json::json!({ "includeDom": true }),
                status: DynamicToolCallStatus::Completed,
                content_items: Some(vec![DynamicToolCallOutputContentItem::InputText {
                    text: "{\"title\":\"Home\"}".into(),
                }]),
                success: None,
                duration_ms: None,
            }
        );
    }
}
