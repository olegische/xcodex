use crate::tools::ToolRouter;
use crate::tools::context::ToolCall;
use crate::tools::router::last_assistant_message_from_item;
use crate::tools::router::response_input_to_response_item;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;

#[derive(Debug, Default, PartialEq)]
pub struct OutputItemResult {
    pub recorded_items: Vec<ResponseItem>,
    pub response_input_items: Vec<ResponseInputItem>,
    pub last_agent_message: Option<String>,
    pub needs_follow_up: bool,
    pub tool_call: Option<ToolCall>,
}

pub fn handle_output_item_done(item: ResponseItem) -> Result<OutputItemResult, String> {
    let router = ToolRouter;
    let mut output = OutputItemResult::default();

    match router.build_tool_call(item.clone())? {
        Some(tool_call) => {
            output.needs_follow_up = true;
            output.recorded_items.push(item);
            output.tool_call = Some(tool_call);
        }
        None => {
            output.last_agent_message = last_assistant_message_from_item(&item);
            output.recorded_items.push(item);
        }
    }

    Ok(output)
}

pub fn record_response_input_items(items: &[ResponseInputItem]) -> Vec<ResponseItem> {
    items
        .iter()
        .filter_map(response_input_to_response_item)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn assistant_message_is_recorded_without_follow_up() {
        let item = ResponseItem::Message {
            id: Some("msg-1".to_string()),
            role: "assistant".to_string(),
            content: vec![codex_protocol::models::ContentItem::OutputText {
                text: "done".to_string(),
            }],
            end_turn: Some(true),
            phase: None,
        };

        assert_eq!(
            handle_output_item_done(item).expect("item should be handled"),
            OutputItemResult {
                recorded_items: vec![ResponseItem::Message {
                    id: Some("msg-1".to_string()),
                    role: "assistant".to_string(),
                    content: vec![codex_protocol::models::ContentItem::OutputText {
                        text: "done".to_string(),
                    }],
                    end_turn: Some(true),
                    phase: None,
                }],
                response_input_items: Vec::new(),
                last_agent_message: Some("done".to_string()),
                needs_follow_up: false,
                tool_call: None,
            }
        );
    }

    #[test]
    fn function_call_sets_follow_up() {
        let item = ResponseItem::FunctionCall {
            id: Some("fc-1".to_string()),
            name: "read_file".to_string(),
            namespace: None,
            arguments: "{}".to_string(),
            call_id: "call-1".to_string(),
        };

        let result = handle_output_item_done(item).expect("item should be handled");

        assert_eq!(result.needs_follow_up, true);
        assert_eq!(result.last_agent_message, None);
        assert_eq!(result.tool_call.is_some(), true);
    }
}
