use crate::truncate::TruncationPolicy;
use crate::truncate::approx_bytes_for_tokens;
use crate::truncate::approx_tokens_from_byte_count_i64;
use crate::truncate::truncate_function_output_items_with_policy;
use crate::truncate::truncate_text;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use codex_protocol::models::ContentItem;
use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::FunctionCallOutputContentItem;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ImageDetail;
use codex_protocol::models::ResponseItem;

/// Approximate model-visible byte cost for one image input.
///
/// The estimator later converts bytes to tokens using a 4-bytes/token heuristic
/// with ceiling division, so 7,373 bytes maps to approximately 1,844 tokens.
pub const RESIZED_IMAGE_BYTES_ESTIMATE: i64 = 7373;
// See https://platform.openai.com/docs/guides/images-vision#calculating-costs.
// Use a direct 32px patch count only for `detail: "original"`;
// all other image inputs continue to use `RESIZED_IMAGE_BYTES_ESTIMATE`.
const ORIGINAL_IMAGE_PATCH_SIZE: u32 = 32;

pub fn truncate_function_output_payload(
    output: &FunctionCallOutputPayload,
    policy: TruncationPolicy,
) -> FunctionCallOutputPayload {
    let body = match &output.body {
        FunctionCallOutputBody::Text(content) => {
            FunctionCallOutputBody::Text(truncate_text(content, policy))
        }
        FunctionCallOutputBody::ContentItems(items) => FunctionCallOutputBody::ContentItems(
            truncate_function_output_items_with_policy(items, policy),
        ),
    };

    FunctionCallOutputPayload {
        body,
        success: output.success,
    }
}

/// API messages include every non-system item.
pub fn is_api_message(message: &ResponseItem) -> bool {
    match message {
        ResponseItem::Message { role, .. } => role.as_str() != "system",
        ResponseItem::FunctionCallOutput { .. }
        | ResponseItem::FunctionCall { .. }
        | ResponseItem::ToolSearchCall { .. }
        | ResponseItem::ToolSearchOutput { .. }
        | ResponseItem::CustomToolCall { .. }
        | ResponseItem::CustomToolCallOutput { .. }
        | ResponseItem::LocalShellCall { .. }
        | ResponseItem::Reasoning { .. }
        | ResponseItem::WebSearchCall { .. }
        | ResponseItem::ImageGenerationCall { .. }
        | ResponseItem::Compaction { .. } => true,
        ResponseItem::GhostSnapshot { .. } | ResponseItem::Other => false,
    }
}

fn estimate_reasoning_length(encoded_len: usize) -> usize {
    encoded_len
        .saturating_mul(3)
        .checked_div(4)
        .unwrap_or(0)
        .saturating_sub(650)
}

pub fn estimate_item_token_count(item: &ResponseItem) -> i64 {
    let model_visible_bytes = estimate_response_item_model_visible_bytes(item);
    approx_tokens_from_byte_count_i64(model_visible_bytes)
}

pub fn estimate_response_item_model_visible_bytes(item: &ResponseItem) -> i64 {
    match item {
        ResponseItem::GhostSnapshot { .. } => 0,
        ResponseItem::Reasoning {
            encrypted_content: Some(content),
            ..
        }
        | ResponseItem::Compaction {
            encrypted_content: content,
        } => i64::try_from(estimate_reasoning_length(content.len())).unwrap_or(i64::MAX),
        item => {
            let raw = serde_json::to_string(item)
                .map(|serialized| i64::try_from(serialized.len()).unwrap_or(i64::MAX))
                .unwrap_or_default();
            let (payload_bytes, replacement_bytes) = image_data_url_estimate_adjustment(item);
            if payload_bytes == 0 || replacement_bytes == 0 {
                raw
            } else {
                raw.saturating_sub(payload_bytes)
                    .saturating_add(replacement_bytes)
            }
        }
    }
}

fn parse_base64_image_data_url(url: &str) -> Option<&str> {
    if !url
        .get(.."data:".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:"))
    {
        return None;
    }
    let comma_index = url.find(',')?;
    let metadata = &url[..comma_index];
    let payload = &url[comma_index + 1..];
    let metadata_without_scheme = &metadata["data:".len()..];
    let mut metadata_parts = metadata_without_scheme.split(';');
    let mime_type = metadata_parts.next().unwrap_or_default();
    let has_base64_marker = metadata_parts.any(|part| part.eq_ignore_ascii_case("base64"));
    if !mime_type
        .get(.."image/".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("image/"))
    {
        return None;
    }
    if !has_base64_marker {
        return None;
    }
    Some(payload)
}

fn estimate_original_image_bytes(image_url: &str) -> Option<i64> {
    let payload = match parse_base64_image_data_url(image_url) {
        Some(payload) => payload,
        None => {
            tracing::trace!("skipping original-detail estimate for non-base64 image data URL");
            return None;
        }
    };
    let bytes = match BASE64_STANDARD.decode(payload) {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::trace!("failed to decode original-detail image payload: {error}");
            return None;
        }
    };
    let dynamic = match image::load_from_memory(&bytes) {
        Ok(dynamic) => dynamic,
        Err(error) => {
            tracing::trace!("failed to decode original-detail image bytes: {error}");
            return None;
        }
    };
    let width = i64::from(dynamic.width());
    let height = i64::from(dynamic.height());
    let patch_size = i64::from(ORIGINAL_IMAGE_PATCH_SIZE);
    let patches_wide = width.saturating_add(patch_size.saturating_sub(1)) / patch_size;
    let patches_high = height.saturating_add(patch_size.saturating_sub(1)) / patch_size;
    let patch_count = patches_wide.saturating_mul(patches_high);
    let patch_count = usize::try_from(patch_count).unwrap_or(usize::MAX);
    Some(i64::try_from(approx_bytes_for_tokens(patch_count)).unwrap_or(i64::MAX))
}

fn image_data_url_estimate_adjustment(item: &ResponseItem) -> (i64, i64) {
    let mut payload_bytes = 0i64;
    let mut replacement_bytes = 0i64;

    let mut accumulate = |image_url: &str, detail: Option<ImageDetail>| {
        if let Some(payload_len) = parse_base64_image_data_url(image_url).map(str::len) {
            payload_bytes =
                payload_bytes.saturating_add(i64::try_from(payload_len).unwrap_or(i64::MAX));
            replacement_bytes = replacement_bytes.saturating_add(match detail {
                Some(ImageDetail::Original) => {
                    estimate_original_image_bytes(image_url).unwrap_or(RESIZED_IMAGE_BYTES_ESTIMATE)
                }
                _ => RESIZED_IMAGE_BYTES_ESTIMATE,
            });
        }
    };

    match item {
        ResponseItem::Message { content, .. } => {
            for content_item in content {
                if let ContentItem::InputImage { image_url } = content_item {
                    accumulate(image_url, None);
                }
            }
        }
        ResponseItem::FunctionCallOutput { output, .. }
        | ResponseItem::CustomToolCallOutput { output, .. } => {
            if let FunctionCallOutputBody::ContentItems(items) = &output.body {
                for content_item in items {
                    if let FunctionCallOutputContentItem::InputImage { image_url, detail } =
                        content_item
                    {
                        accumulate(image_url, *detail);
                    }
                }
            }
        }
        _ => {}
    }

    (payload_bytes, replacement_bytes)
}

pub fn is_model_generated_item(item: &ResponseItem) -> bool {
    match item {
        ResponseItem::Message { role, .. } => role == "assistant",
        ResponseItem::Reasoning { .. }
        | ResponseItem::FunctionCall { .. }
        | ResponseItem::ToolSearchCall { .. }
        | ResponseItem::WebSearchCall { .. }
        | ResponseItem::ImageGenerationCall { .. }
        | ResponseItem::CustomToolCall { .. }
        | ResponseItem::LocalShellCall { .. }
        | ResponseItem::Compaction { .. } => true,
        ResponseItem::FunctionCallOutput { .. }
        | ResponseItem::ToolSearchOutput { .. }
        | ResponseItem::CustomToolCallOutput { .. }
        | ResponseItem::GhostSnapshot { .. }
        | ResponseItem::Other => false,
    }
}

pub fn is_codex_generated_item(item: &ResponseItem) -> bool {
    matches!(
        item,
        ResponseItem::FunctionCallOutput { .. }
            | ResponseItem::ToolSearchOutput { .. }
            | ResponseItem::CustomToolCallOutput { .. }
    ) || matches!(item, ResponseItem::Message { role, .. } if role == "developer")
}

#[cfg(test)]
mod tests {
    use super::estimate_item_token_count;
    use super::estimate_response_item_model_visible_bytes;
    use super::is_api_message;
    use super::is_codex_generated_item;
    use super::truncate_function_output_payload;
    use crate::truncate::TruncationPolicy;
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use codex_protocol::models::ContentItem;
    use codex_protocol::models::FunctionCallOutputBody;
    use codex_protocol::models::FunctionCallOutputContentItem;
    use codex_protocol::models::FunctionCallOutputPayload;
    use codex_protocol::models::ImageDetail;
    use codex_protocol::models::ReasoningItemContent;
    use codex_protocol::models::ReasoningItemReasoningSummary;
    use codex_protocol::models::ResponseItem;
    use image::ImageBuffer;
    use image::ImageFormat;
    use image::Rgba;
    use pretty_assertions::assert_eq;
    use regex_lite::Regex;

    fn user_input_text_msg(text: &str) -> ResponseItem {
        ResponseItem::Message {
            id: None,
            role: "user".to_string(),
            content: vec![ContentItem::InputText {
                text: text.to_string(),
            }],
            end_turn: None,
            phase: None,
        }
    }

    fn reasoning_with_encrypted_content(len: usize) -> ResponseItem {
        ResponseItem::Reasoning {
            id: String::new(),
            summary: vec![ReasoningItemReasoningSummary::SummaryText {
                text: "summary".to_string(),
            }],
            content: Some(vec![ReasoningItemContent::ReasoningText {
                text: "not visible".to_string(),
            }]),
            encrypted_content: Some("a".repeat(len)),
        }
    }

    #[test]
    fn filters_system_messages_from_api_messages() {
        let system = ResponseItem::Message {
            id: None,
            role: "system".to_string(),
            content: vec![ContentItem::OutputText {
                text: "ignored".to_string(),
            }],
            end_turn: None,
            phase: None,
        };
        assert!(!is_api_message(&system));
        assert!(is_api_message(&user_input_text_msg("hi")));
    }

    #[test]
    fn token_estimate_uses_visible_bytes() {
        let item = user_input_text_msg("abcdefgh");
        assert_eq!(estimate_item_token_count(&item), 21);
    }

    #[test]
    fn reasoning_uses_encrypted_payload_estimate() {
        // (900 * 0.75 - 650) = 25 visible bytes, then ceil-divide by 4 => 7 tokens.
        assert_eq!(
            estimate_item_token_count(&reasoning_with_encrypted_content(900)),
            7
        );
    }

    #[test]
    fn codex_generated_detection_matches_expected_items() {
        assert!(is_codex_generated_item(&ResponseItem::FunctionCallOutput {
            call_id: "call".to_string(),
            output: FunctionCallOutputPayload::from_text("ok".to_string()),
        }));
        assert!(is_codex_generated_item(&ResponseItem::Message {
            id: None,
            role: "developer".to_string(),
            content: vec![ContentItem::OutputText {
                text: "note".to_string(),
            }],
            end_turn: None,
            phase: None,
        }));
        assert!(!is_codex_generated_item(&user_input_text_msg("user")));
    }

    #[test]
    fn truncates_text_function_output_payload() {
        let payload =
            FunctionCallOutputPayload::from_text("abcdefghijklmnopqrstuvwxyz".to_string());
        let truncated = truncate_function_output_payload(&payload, TruncationPolicy::Bytes(10));
        let FunctionCallOutputBody::Text(text) = truncated.body else {
            panic!("expected text body");
        };
        assert!(text.contains("truncated"));
    }

    #[test]
    fn image_data_urls_use_estimated_cost() {
        let mut png = Vec::new();
        let image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(32, 32, Rgba([255, 0, 0, 255]));
        image
            .write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .expect("write png");
        let image_url = format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&png));
        let item = ResponseItem::FunctionCallOutput {
            call_id: "call".to_string(),
            output: FunctionCallOutputPayload {
                body: FunctionCallOutputBody::ContentItems(vec![
                    FunctionCallOutputContentItem::InputImage {
                        image_url,
                        detail: Some(ImageDetail::Original),
                    },
                ]),
                success: Some(true),
            },
        };
        let bytes = estimate_response_item_model_visible_bytes(&item);
        assert!(bytes > 0);
        let serialized = serde_json::to_string(&item).expect("serialize item");
        assert!(bytes < i64::try_from(serialized.len()).unwrap_or(i64::MAX));
    }

    #[test]
    fn truncated_image_payload_keeps_image_items() {
        let payload = FunctionCallOutputPayload {
            body: FunctionCallOutputBody::ContentItems(vec![
                FunctionCallOutputContentItem::InputImage {
                    image_url: "https://example.com/image.png".to_string(),
                    detail: None,
                },
                FunctionCallOutputContentItem::InputText {
                    text: "x".repeat(200),
                },
            ]),
            success: Some(true),
        };
        let truncated = truncate_function_output_payload(&payload, TruncationPolicy::Bytes(20));
        let FunctionCallOutputBody::ContentItems(items) = truncated.body else {
            panic!("expected content items");
        };
        assert!(matches!(
            items.first(),
            Some(FunctionCallOutputContentItem::InputImage { .. })
        ));
    }

    #[test]
    fn text_byte_estimate_is_stable_enough_for_regression_checks() {
        let bytes = estimate_response_item_model_visible_bytes(&user_input_text_msg("hello world"));
        let regex = Regex::new(r"^\d+$").expect("regex");
        assert!(regex.is_match(&bytes.to_string()));
    }
}
