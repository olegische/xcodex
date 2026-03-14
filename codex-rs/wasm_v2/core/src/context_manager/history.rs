use crate::codex::TurnContext;
use crate::context_manager::normalize;
use crate::event_mapping::is_contextual_user_message_content;
use crate::truncate::TruncationPolicy;
use crate::truncate::approx_token_count;
use crate::truncate::truncate_function_output_items_with_policy;
use codex_protocol::models::BaseInstructions;
use codex_protocol::models::ContentItem;
use codex_protocol::models::FunctionCallOutputContentItem;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::InputModality;
use codex_protocol::protocol::TokenUsage;
use codex_protocol::protocol::TokenUsageInfo;
use codex_protocol::protocol::TurnContextItem;
use std::ops::Deref;

/// Transcript/history manager for the mirror-track runtime.
#[derive(Clone, Default)]
pub struct ContextManager {
    items: Vec<ResponseItem>,
    token_info: Option<TokenUsageInfo>,
    reference_context_item: Option<TurnContextItem>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TotalTokenUsageBreakdown {
    pub last_api_response_total_tokens: i64,
    pub all_history_items_model_visible_bytes: i64,
    pub estimated_tokens_of_items_added_since_last_successful_api_response: i64,
    pub estimated_bytes_of_items_added_since_last_successful_api_response: i64,
}

impl ContextManager {
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            token_info: TokenUsageInfo::new_or_append(&None, &None, None),
            reference_context_item: None,
        }
    }

    pub fn token_info(&self) -> Option<TokenUsageInfo> {
        self.token_info.clone()
    }

    pub fn set_token_info(&mut self, info: Option<TokenUsageInfo>) {
        self.token_info = info;
    }

    pub fn set_reference_context_item(&mut self, item: Option<TurnContextItem>) {
        self.reference_context_item = item;
    }

    pub fn reference_context_item(&self) -> Option<TurnContextItem> {
        self.reference_context_item.clone()
    }

    pub fn set_token_usage_full(&mut self, context_window: i64) {
        match &mut self.token_info {
            Some(info) => info.fill_to_context_window(context_window),
            None => {
                self.token_info = Some(TokenUsageInfo::full_context_window(context_window));
            }
        }
    }

    pub fn record_items<I>(&mut self, items: I, policy: TruncationPolicy)
    where
        I: IntoIterator,
        I::Item: std::ops::Deref<Target = ResponseItem>,
    {
        for item in items {
            let item_ref = item.deref();
            let is_ghost_snapshot = matches!(item_ref, ResponseItem::GhostSnapshot { .. });
            if !is_api_message(item_ref) && !is_ghost_snapshot {
                continue;
            }

            self.items.push(process_item(item_ref, policy));
        }
    }

    pub fn for_prompt(mut self, input_modalities: &[InputModality]) -> Vec<ResponseItem> {
        self.normalize_history(input_modalities);
        self.items
            .retain(|item| !matches!(item, ResponseItem::GhostSnapshot { .. }));
        self.items
    }

    pub fn raw_items(&self) -> &[ResponseItem] {
        &self.items
    }

    pub fn replace(&mut self, items: Vec<ResponseItem>) {
        self.items = items;
    }

    pub fn estimate_token_count(&self, turn_context: &TurnContext) -> Option<i64> {
        self.estimate_token_count_with_base_instructions(&BaseInstructions {
            text: turn_context
                .model_info
                .get_model_instructions(turn_context.personality),
        })
    }

    pub fn estimate_token_count_with_base_instructions(
        &self,
        base_instructions: &BaseInstructions,
    ) -> Option<i64> {
        let base_tokens = i64::try_from(approx_token_count(&base_instructions.text)).ok()?;
        let items_tokens = self
            .items
            .iter()
            .map(estimate_item_token_count)
            .fold(0i64, i64::saturating_add);
        Some(base_tokens.saturating_add(items_tokens))
    }

    pub fn remove_first_item(&mut self) {
        if !self.items.is_empty() {
            let removed = self.items.remove(0);
            remove_corresponding_for(&mut self.items, &removed);
        }
    }

    pub fn remove_last_item(&mut self) -> bool {
        if let Some(removed) = self.items.pop() {
            remove_corresponding_for(&mut self.items, &removed);
            true
        } else {
            false
        }
    }

    pub fn replace_last_turn_images(&mut self, placeholder: &str) -> bool {
        let Some(index) = self.items.iter().rposition(|item| {
            matches!(item, ResponseItem::FunctionCallOutput { .. })
                || matches!(item, ResponseItem::Message { role, .. } if role == "user")
        }) else {
            return false;
        };

        match &mut self.items[index] {
            ResponseItem::FunctionCallOutput { output, .. } => {
                let Some(content_items) = output.content_items_mut() else {
                    return false;
                };
                let mut replaced = false;
                for item in content_items.iter_mut() {
                    if matches!(item, FunctionCallOutputContentItem::InputImage { .. }) {
                        *item = FunctionCallOutputContentItem::InputText {
                            text: placeholder.to_string(),
                        };
                        replaced = true;
                    }
                }
                replaced
            }
            ResponseItem::Message { role, .. } if role == "user" => false,
            _ => false,
        }
    }

    pub fn drop_last_n_user_turns(&mut self, num_turns: u32) {
        if num_turns == 0 {
            return;
        }

        let snapshot = self.items.clone();
        let user_positions = user_message_positions(&snapshot);
        let Some(&first_user_idx) = user_positions.first() else {
            self.replace(snapshot);
            return;
        };

        let n_from_end = usize::try_from(num_turns).unwrap_or(usize::MAX);
        let cut_idx = if n_from_end >= user_positions.len() {
            first_user_idx
        } else {
            user_positions[user_positions.len() - n_from_end]
        };

        self.replace(snapshot[..cut_idx].to_vec());
    }

    pub fn update_token_info(&mut self, usage: &TokenUsage, model_context_window: Option<i64>) {
        self.token_info = TokenUsageInfo::new_or_append(
            &self.token_info,
            &Some(usage.clone()),
            model_context_window,
        );
    }

    pub fn get_total_token_usage(&self, server_reasoning_included: bool) -> i64 {
        let last_tokens = self
            .token_info
            .as_ref()
            .map(|info| info.last_token_usage.total_tokens)
            .unwrap_or(0);
        let items_after_last_model_generated_tokens = self
            .items_after_last_model_generated_item()
            .iter()
            .map(estimate_item_token_count)
            .fold(0i64, i64::saturating_add);
        if server_reasoning_included {
            last_tokens.saturating_add(items_after_last_model_generated_tokens)
        } else {
            last_tokens.saturating_add(items_after_last_model_generated_tokens)
        }
    }

    pub fn get_total_token_usage_breakdown(&self) -> TotalTokenUsageBreakdown {
        let last_usage = self
            .token_info
            .as_ref()
            .map(|info| info.last_token_usage.clone())
            .unwrap_or_default();
        let items_after_last_model_generated = self.items_after_last_model_generated_item();

        TotalTokenUsageBreakdown {
            last_api_response_total_tokens: last_usage.total_tokens,
            all_history_items_model_visible_bytes: self
                .items
                .iter()
                .map(model_visible_byte_count)
                .fold(0i64, i64::saturating_add),
            estimated_tokens_of_items_added_since_last_successful_api_response:
                items_after_last_model_generated
                    .iter()
                    .map(estimate_item_token_count)
                    .fold(0i64, i64::saturating_add),
            estimated_bytes_of_items_added_since_last_successful_api_response:
                items_after_last_model_generated
                    .iter()
                    .map(model_visible_byte_count)
                    .fold(0i64, i64::saturating_add),
        }
    }

    fn normalize_history(&mut self, input_modalities: &[InputModality]) {
        normalize::remove_orphan_outputs(&mut self.items);
        normalize::ensure_call_outputs_present(&mut self.items);
        if !input_modalities.contains(&InputModality::Image) {
            strip_images(&mut self.items);
        }
    }

    fn items_after_last_model_generated_item(&self) -> &[ResponseItem] {
        let start = self
            .items
            .iter()
            .rposition(is_model_generated_item)
            .map_or(self.items.len(), |index| index.saturating_add(1));
        &self.items[start..]
    }
}

fn process_item(item: &ResponseItem, policy: TruncationPolicy) -> ResponseItem {
    match item {
        ResponseItem::FunctionCallOutput { call_id, output } => ResponseItem::FunctionCallOutput {
            call_id: call_id.clone(),
            output: process_function_output(output, policy),
        },
        _ => item.clone(),
    }
}

fn process_function_output(
    output: &FunctionCallOutputPayload,
    policy: TruncationPolicy,
) -> FunctionCallOutputPayload {
    match output.body.clone() {
        codex_protocol::models::FunctionCallOutputBody::ContentItems(items) => {
            FunctionCallOutputPayload {
                body: codex_protocol::models::FunctionCallOutputBody::ContentItems(
                    truncate_function_output_items_with_policy(&items, policy),
                ),
                success: output.success,
            }
        }
        _ => output.clone(),
    }
}

fn strip_images(items: &mut [ResponseItem]) {
    for item in items {
        match item {
            ResponseItem::Message { content, .. } => {
                content.retain(|entry| !matches!(entry, ContentItem::InputImage { .. }));
            }
            ResponseItem::FunctionCallOutput { output, .. } => {
                if let Some(content_items) = output.content_items_mut() {
                    content_items.retain(|entry| {
                        !matches!(entry, FunctionCallOutputContentItem::InputImage { .. })
                    });
                }
            }
            _ => {}
        }
    }
}

fn user_message_positions(items: &[ResponseItem]) -> Vec<usize> {
    items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| match item {
            ResponseItem::Message { role, content, .. }
                if role == "user" && !is_contextual_user_message_content(content) =>
            {
                Some(index)
            }
            _ => None,
        })
        .collect()
}

fn remove_corresponding_for(items: &mut Vec<ResponseItem>, removed: &ResponseItem) {
    match removed {
        ResponseItem::FunctionCall { call_id, .. } => items.retain(|item| {
            !matches!(item, ResponseItem::FunctionCallOutput { call_id: existing, .. } if existing == call_id)
        }),
        ResponseItem::FunctionCallOutput { call_id, .. } => items.retain(|item| {
            !matches!(item, ResponseItem::FunctionCall { call_id: existing, .. } if existing == call_id)
        }),
        ResponseItem::CustomToolCall { call_id, .. } => items.retain(|item| {
            !matches!(item, ResponseItem::CustomToolCallOutput { call_id: existing, .. } if existing == call_id)
        }),
        ResponseItem::CustomToolCallOutput { call_id, .. } => items.retain(|item| {
            !matches!(item, ResponseItem::CustomToolCall { call_id: existing, .. } if existing == call_id)
        }),
        _ => {}
    }
}

fn estimate_item_token_count(item: &ResponseItem) -> i64 {
    i64::try_from(model_visible_byte_count(item) / 4).unwrap_or(i64::MAX)
}

fn model_visible_byte_count(item: &ResponseItem) -> i64 {
    i64::try_from(serde_json::to_vec(item).map_or(0, |value| value.len())).unwrap_or(i64::MAX)
}

fn is_model_generated_item(item: &ResponseItem) -> bool {
    matches!(item, ResponseItem::Message { role, .. } if role == "assistant")
        || matches!(
            item,
            ResponseItem::Reasoning { .. }
                | ResponseItem::FunctionCall { .. }
                | ResponseItem::CustomToolCall { .. }
                | ResponseItem::LocalShellCall { .. }
                | ResponseItem::ToolSearchCall { .. }
        )
}

fn is_api_message(item: &ResponseItem) -> bool {
    matches!(
        item,
        ResponseItem::Message { .. }
            | ResponseItem::Reasoning { .. }
            | ResponseItem::FunctionCall { .. }
            | ResponseItem::FunctionCallOutput { .. }
            | ResponseItem::CustomToolCall { .. }
            | ResponseItem::CustomToolCallOutput { .. }
            | ResponseItem::LocalShellCall { .. }
            | ResponseItem::ToolSearchCall { .. }
            | ResponseItem::ToolSearchOutput { .. }
            | ResponseItem::WebSearchCall { .. }
            | ResponseItem::ImageGenerationCall { .. }
    )
}
