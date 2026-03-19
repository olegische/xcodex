use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::DynamicToolCallResponseEvent;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::RolloutItem;
use std::collections::HashSet;

pub(crate) fn normalize_rollout_items_for_upstream_replay(
    items: &[RolloutItem],
) -> Vec<RolloutItem> {
    let response_backed_browser_tool_call_ids = items
        .iter()
        .filter_map(browser_tool_call_id_from_rollout_item)
        .collect::<HashSet<_>>();
    items
        .iter()
        .filter_map(|item| {
            normalize_browser_tool_rollout_item(item, &response_backed_browser_tool_call_ids)
        })
        .collect()
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
    if response_backed_browser_tool_call_ids.contains(&request.call_id) {
        return None;
    }
    let Some(tool) = canonical_browser_tool_name(&request.tool, None) else {
        return Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallRequest(
            request.clone(),
        )));
    };
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
    if response_backed_browser_tool_call_ids.contains(&response.call_id) {
        return None;
    }
    let Some(tool) = canonical_browser_tool_name(&response.tool, None) else {
        return Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
            response.clone(),
        )));
    };
    Some(RolloutItem::EventMsg(EventMsg::DynamicToolCallResponse(
        DynamicToolCallResponseEvent {
            tool,
            ..response.clone()
        },
    )))
}
