use codex_app_server_protocol::Turn;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::DynamicToolCallResponseEvent;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::RolloutItem;
use std::collections::HashSet;

pub(crate) fn build_turns_from_wasm_rollout_items(items: &[RolloutItem]) -> Vec<Turn> {
    let response_backed_browser_tool_call_ids = items
        .iter()
        .filter_map(browser_tool_call_id_from_rollout_item)
        .collect::<HashSet<_>>();
    let normalized_items = items
        .iter()
        .filter_map(|item| {
            normalize_browser_tool_rollout_item(item, &response_backed_browser_tool_call_ids)
        })
        .collect::<Vec<_>>();
    codex_app_server_protocol::build_turns_from_rollout_items(&normalized_items)
}

pub(crate) fn canonical_browser_tool_name(name: &str, namespace: Option<&str>) -> Option<String> {
    if namespace == Some("browser") || name.starts_with("browser__") {
        return Some(qualify_browser_tool_name(name));
    }

    matches!(
        name,
        "read_file"
            | "list_dir"
            | "grep_files"
            | "apply_patch"
            | "update_plan"
            | "request_user_input"
    )
    .then(|| qualify_browser_tool_name(name))
}

fn qualify_browser_tool_name(name: &str) -> String {
    if name.starts_with("browser__") {
        name.to_string()
    } else {
        format!("browser__{name}")
    }
}

fn normalize_browser_tool_rollout_item(
    item: &RolloutItem,
    response_backed_browser_tool_call_ids: &HashSet<String>,
) -> Option<RolloutItem> {
    match item {
        RolloutItem::ResponseItem(response_item) => Some(RolloutItem::ResponseItem(
            normalize_browser_tool_response_item(response_item),
        )),
        RolloutItem::EventMsg(EventMsg::RawResponseItem(raw_response_item)) => {
            raw_response_item_to_rollout_item(
                &raw_response_item.item,
                response_backed_browser_tool_call_ids,
            )
        }
        RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(request)) => {
            normalize_browser_dynamic_tool_call_request(
                request,
                response_backed_browser_tool_call_ids,
            )
        }
        RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(response)) => {
            normalize_browser_dynamic_tool_call_response(
                response,
                response_backed_browser_tool_call_ids,
            )
        }
        _ => Some(item.clone()),
    }
}

fn normalize_browser_tool_response_item(item: &ResponseItem) -> ResponseItem {
    match item {
        ResponseItem::FunctionCall {
            id,
            name,
            namespace,
            arguments,
            call_id,
        } => {
            if let Some(canonical_name) = canonical_browser_tool_name(name, namespace.as_deref()) {
                ResponseItem::FunctionCall {
                    id: id.clone(),
                    name: canonical_name,
                    namespace: None,
                    arguments: arguments.clone(),
                    call_id: call_id.clone(),
                }
            } else {
                item.clone()
            }
        }
        ResponseItem::CustomToolCall {
            id,
            call_id,
            name,
            input,
            status,
        } => {
            if let Some(canonical_name) = canonical_browser_tool_name(name, None) {
                ResponseItem::CustomToolCall {
                    id: id.clone(),
                    call_id: call_id.clone(),
                    name: canonical_name,
                    input: input.clone(),
                    status: status.clone(),
                }
            } else {
                item.clone()
            }
        }
        _ => item.clone(),
    }
}

fn browser_tool_call_id_from_rollout_item(item: &RolloutItem) -> Option<String> {
    match item {
        RolloutItem::ResponseItem(response_item) => {
            browser_tool_call_id_from_response_item(response_item, &HashSet::new())
        }
        RolloutItem::EventMsg(EventMsg::RawResponseItem(raw_response_item)) => {
            browser_tool_call_id_from_response_item(&raw_response_item.item, &HashSet::new())
        }
        _ => None,
    }
}

fn browser_tool_call_id_from_response_item(
    item: &ResponseItem,
    response_backed_browser_tool_call_ids: &HashSet<String>,
) -> Option<String> {
    match item {
        ResponseItem::FunctionCall {
            call_id,
            name,
            namespace,
            ..
        } if canonical_browser_tool_name(name, namespace.as_deref()).is_some() => {
            Some(call_id.clone())
        }
        ResponseItem::CustomToolCall { call_id, name, .. }
            if canonical_browser_tool_name(name, None).is_some() =>
        {
            Some(call_id.clone())
        }
        ResponseItem::FunctionCallOutput { call_id, .. }
        | ResponseItem::CustomToolCallOutput { call_id, .. }
            if response_backed_browser_tool_call_ids.contains(call_id) =>
        {
            Some(call_id.clone())
        }
        _ => None,
    }
}

fn raw_response_item_to_rollout_item(
    item: &ResponseItem,
    response_backed_browser_tool_call_ids: &HashSet<String>,
) -> Option<RolloutItem> {
    browser_tool_call_id_from_response_item(item, response_backed_browser_tool_call_ids)
        .map(|_| RolloutItem::ResponseItem(normalize_browser_tool_response_item(item)))
}

fn normalize_browser_dynamic_tool_call_request(
    request: &codex_protocol::dynamic_tools::DynamicToolCallRequest,
    response_backed_browser_tool_call_ids: &HashSet<String>,
) -> Option<RolloutItem> {
    let Some(tool) = canonical_browser_tool_name(&request.tool, None) else {
        return Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
            request.clone(),
        )));
    };
    if response_backed_browser_tool_call_ids.contains(&request.call_id) {
        return None;
    }
    Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
        codex_protocol::dynamic_tools::DynamicToolCallRequest {
            tool,
            ..request.clone()
        },
    )))
}

fn normalize_browser_dynamic_tool_call_response(
    response: &DynamicToolCallResponseEvent,
    response_backed_browser_tool_call_ids: &HashSet<String>,
) -> Option<RolloutItem> {
    let Some(tool) = canonical_browser_tool_name(&response.tool, None) else {
        return Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
            response.clone(),
        )));
    };
    if response_backed_browser_tool_call_ids.contains(&response.call_id) {
        return None;
    }
    Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
        DynamicToolCallResponseEvent {
            tool,
            ..response.clone()
        },
    )))
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
}
