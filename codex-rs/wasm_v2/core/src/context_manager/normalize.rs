use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ResponseItem;

pub fn ensure_call_outputs_present(items: &mut Vec<ResponseItem>) {
    let mut missing_outputs_to_insert = Vec::new();

    for (index, item) in items.iter().enumerate() {
        match item {
            ResponseItem::FunctionCall { call_id, .. } => {
                let has_output = items.iter().any(|item| match item {
                    ResponseItem::FunctionCallOutput {
                        call_id: existing, ..
                    } => existing == call_id,
                    _ => false,
                });
                if !has_output {
                    missing_outputs_to_insert.push((
                        index,
                        ResponseItem::FunctionCallOutput {
                            call_id: call_id.clone(),
                            output: FunctionCallOutputPayload::from_text("aborted".to_string()),
                        },
                    ));
                }
            }
            ResponseItem::CustomToolCall { call_id, .. } => {
                let has_output = items.iter().any(|item| match item {
                    ResponseItem::CustomToolCallOutput {
                        call_id: existing, ..
                    } => existing == call_id,
                    _ => false,
                });
                if !has_output {
                    missing_outputs_to_insert.push((
                        index,
                        ResponseItem::CustomToolCallOutput {
                            call_id: call_id.clone(),
                            output: FunctionCallOutputPayload::from_text("aborted".to_string()),
                        },
                    ));
                }
            }
            ResponseItem::ToolSearchCall {
                call_id: Some(call_id),
                ..
            } => {
                let has_output = items.iter().any(|item| match item {
                    ResponseItem::ToolSearchOutput {
                        call_id: Some(existing),
                        ..
                    } => existing == call_id,
                    _ => false,
                });
                if !has_output {
                    missing_outputs_to_insert.push((
                        index,
                        ResponseItem::ToolSearchOutput {
                            call_id: Some(call_id.clone()),
                            status: "completed".to_string(),
                            execution: "client".to_string(),
                            tools: Vec::new(),
                        },
                    ));
                }
            }
            _ => {}
        }
    }

    for (index, output) in missing_outputs_to_insert.into_iter().rev() {
        items.insert(index + 1, output);
    }
}

pub fn remove_orphan_outputs(items: &mut Vec<ResponseItem>) {
    let function_call_ids = items
        .iter()
        .filter_map(|item| match item {
            ResponseItem::FunctionCall { call_id, .. } => Some(call_id.clone()),
            _ => None,
        })
        .collect::<std::collections::HashSet<_>>();
    let custom_tool_call_ids = items
        .iter()
        .filter_map(|item| match item {
            ResponseItem::CustomToolCall { call_id, .. } => Some(call_id.clone()),
            _ => None,
        })
        .collect::<std::collections::HashSet<_>>();
    let tool_search_call_ids = items
        .iter()
        .filter_map(|item| match item {
            ResponseItem::ToolSearchCall {
                call_id: Some(call_id),
                ..
            } => Some(call_id.clone()),
            _ => None,
        })
        .collect::<std::collections::HashSet<_>>();

    items.retain(|item| match item {
        ResponseItem::FunctionCallOutput { call_id, .. } => function_call_ids.contains(call_id),
        ResponseItem::CustomToolCallOutput { call_id, .. } => {
            custom_tool_call_ids.contains(call_id)
        }
        ResponseItem::ToolSearchOutput {
            call_id: Some(call_id),
            ..
        } => tool_search_call_ids.contains(call_id),
        ResponseItem::ToolSearchOutput { call_id: None, .. } => true,
        _ => true,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_protocol::models::FunctionCallOutputBody;
    use pretty_assertions::assert_eq;

    #[test]
    fn inserts_missing_function_output_after_call() {
        let mut items = vec![ResponseItem::FunctionCall {
            id: Some("fc-1".to_string()),
            name: "read_file".to_string(),
            namespace: None,
            arguments: "{}".to_string(),
            call_id: "call-1".to_string(),
        }];

        ensure_call_outputs_present(&mut items);

        assert_eq!(
            items,
            vec![
                ResponseItem::FunctionCall {
                    id: Some("fc-1".to_string()),
                    name: "read_file".to_string(),
                    namespace: None,
                    arguments: "{}".to_string(),
                    call_id: "call-1".to_string(),
                },
                ResponseItem::FunctionCallOutput {
                    call_id: "call-1".to_string(),
                    output: FunctionCallOutputPayload {
                        body: FunctionCallOutputBody::Text("aborted".to_string()),
                        success: None,
                    },
                },
            ]
        );
    }
}
