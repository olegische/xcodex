use codex_protocol::items::AgentMessageContent;
use codex_protocol::items::AgentMessageItem;
use codex_protocol::items::ReasoningItem;
use codex_protocol::items::TurnItem;
use codex_protocol::items::UserMessageItem;
use codex_protocol::items::WebSearchItem;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;
use codex_protocol::models::WebSearchAction;
use codex_protocol::user_input::UserInput;
use uuid::Uuid;

use crate::contextual_user_message::is_contextual_user_fragment;

pub(crate) fn is_contextual_user_message_content(message: &[ContentItem]) -> bool {
    message.iter().any(is_contextual_user_fragment)
}

fn parse_user_message(message: &[ContentItem]) -> UserMessageItem {
    if is_contextual_user_message_content(message) {
        return UserMessageItem::new(&[]);
    }

    let content = message
        .iter()
        .filter_map(|content_item| match content_item {
            ContentItem::InputText { text } => Some(UserInput::Text {
                text: text.clone(),
                text_elements: Vec::new(),
            }),
            ContentItem::InputImage { image_url } => Some(UserInput::Image {
                image_url: image_url.clone(),
            }),
            ContentItem::OutputText { .. } => None,
        })
        .collect::<Vec<_>>();
    UserMessageItem::new(&content)
}

pub fn parse_turn_item(item: &ResponseItem) -> Option<TurnItem> {
    match item {
        ResponseItem::Message {
            role,
            content,
            id,
            phase,
            ..
        } => match role.as_str() {
            "user" => {
                if is_contextual_user_message_content(content) {
                    None
                } else {
                    Some(TurnItem::UserMessage(parse_user_message(content)))
                }
            }
            "assistant" => Some(TurnItem::AgentMessage(AgentMessageItem {
                id: id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
                content: content
                    .iter()
                    .filter_map(|content_item| match content_item {
                        ContentItem::OutputText { text } => {
                            Some(AgentMessageContent::Text { text: text.clone() })
                        }
                        _ => None,
                    })
                    .collect(),
                phase: phase.clone(),
            })),
            _ => None,
        },
        ResponseItem::Reasoning {
            id,
            summary,
            content,
            ..
        } => Some(TurnItem::Reasoning(ReasoningItem {
            id: id.clone(),
            summary_text: summary
                .iter()
                .map(|entry| match entry {
                    codex_protocol::models::ReasoningItemReasoningSummary::SummaryText { text } => {
                        text.clone()
                    }
                })
                .collect(),
            raw_content: content
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|entry| match entry {
                    codex_protocol::models::ReasoningItemContent::ReasoningText { text }
                    | codex_protocol::models::ReasoningItemContent::Text { text } => text,
                })
                .collect(),
        })),
        ResponseItem::WebSearchCall { id, action, .. } => {
            Some(TurnItem::WebSearch(WebSearchItem {
                id: id.clone().unwrap_or_default(),
                query: String::new(),
                action: action.clone().unwrap_or(WebSearchAction::Other),
            }))
        }
        ResponseItem::ImageGenerationCall {
            id,
            status,
            revised_prompt,
            result,
        } => Some(TurnItem::ImageGeneration(
            codex_protocol::items::ImageGenerationItem {
                id: id.clone(),
                status: status.clone(),
                revised_prompt: revised_prompt.clone(),
                result: result.clone(),
                saved_path: None,
            },
        )),
        _ => None,
    }
}
