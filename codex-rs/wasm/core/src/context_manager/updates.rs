use crate::codex::PreviousTurnSettings;
use crate::codex::TurnContext;
use crate::environment_context::EnvironmentContext;
use crate::features::Feature;
use crate::shell::Shell;
use crate::tools::spec::ToolSpec;
use codex_execpolicy::Policy;
use codex_protocol::config_types::Personality;
use codex_protocol::models::ContentItem;
use codex_protocol::models::DeveloperInstructions;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::protocol::TurnContextItem;
use serde_json::Map;
use serde_json::Value;

#[derive(Debug, Clone, Default)]
pub struct TotalTokenUsageBreakdown;

pub fn is_user_turn_boundary(item: &codex_protocol::models::ResponseItem) -> bool {
    matches!(item, ResponseItem::Message { role, .. } if role == "user")
}

pub fn build_model_instructions_update_item(
    previous_turn_settings: Option<&PreviousTurnSettings>,
    next: &TurnContext,
) -> Option<DeveloperInstructions> {
    let previous_turn_settings = previous_turn_settings?;
    if previous_turn_settings.model == next.model_info.slug {
        return None;
    }
    let model_instructions = next.model_info.get_model_instructions(next.personality);
    if model_instructions.is_empty() {
        return None;
    }
    Some(DeveloperInstructions::model_switch_message(
        model_instructions,
    ))
}

pub fn build_initial_realtime_item(
    previous: Option<&TurnContextItem>,
    previous_turn_settings: Option<&PreviousTurnSettings>,
    next: &TurnContext,
) -> Option<DeveloperInstructions> {
    match (
        previous.and_then(|item| item.realtime_active),
        next.realtime_active,
    ) {
        (Some(true), false) => Some(DeveloperInstructions::realtime_end_message("inactive")),
        (Some(false), true) | (None, true) => Some(DeveloperInstructions::realtime_start_message()),
        (Some(true), true) | (Some(false), false) => None,
        (None, false) => previous_turn_settings
            .and_then(|settings| settings.realtime_active)
            .filter(|realtime_active| *realtime_active)
            .map(|_| DeveloperInstructions::realtime_end_message("inactive")),
    }
}

pub fn personality_message_for(model_info: &ModelInfo, personality: Personality) -> Option<String> {
    model_info
        .model_messages
        .as_ref()
        .and_then(|spec| spec.get_personality_message(Some(personality)))
        .filter(|message| !message.is_empty())
}

pub fn build_developer_update_item(developer_sections: Vec<String>) -> Option<ResponseItem> {
    build_text_message("developer", developer_sections)
}

pub fn build_contextual_user_message(sections: Vec<String>) -> Option<ResponseItem> {
    build_text_message("user", sections)
}

pub fn build_settings_update_items(
    previous: Option<&TurnContextItem>,
    previous_turn_settings: Option<&PreviousTurnSettings>,
    next: &TurnContext,
    shell: &Shell,
    exec_policy: &Policy,
    personality_feature_enabled: bool,
) -> Vec<ResponseItem> {
    let contextual_user_message = build_environment_update_item(previous, next, shell);
    let developer_update_sections = [
        build_model_instructions_update_item(previous_turn_settings, next),
        build_permissions_update_item(previous, next, exec_policy),
        build_collaboration_mode_update_item(previous, next),
        build_initial_realtime_item(previous, previous_turn_settings, next),
        build_personality_update_item(previous, next, personality_feature_enabled),
    ]
    .into_iter()
    .flatten()
    .map(DeveloperInstructions::into_text)
    .collect();

    let mut items = Vec::with_capacity(2);
    if let Some(developer_message) = build_developer_update_item(developer_update_sections) {
        items.push(developer_message);
    }
    if let Some(contextual_user_message) = contextual_user_message {
        items.push(contextual_user_message);
    }
    items
}

fn build_environment_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
    shell: &Shell,
) -> Option<ResponseItem> {
    let prev = previous?;
    let prev_context = EnvironmentContext::from_turn_context_item(prev, shell);
    let next_context = EnvironmentContext::from_turn_context(next, shell);
    if prev_context.equals_except_shell(&next_context) {
        return None;
    }
    Some(ResponseItem::from(
        EnvironmentContext::diff_from_turn_context_item(prev, next, shell),
    ))
}

fn build_permissions_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
    exec_policy: &Policy,
) -> Option<DeveloperInstructions> {
    let prev = previous?;
    if prev.sandbox_policy == *next.sandbox_policy.get()
        && prev.approval_policy == next.approval_policy.value()
    {
        return None;
    }
    Some(DeveloperInstructions::from_policy(
        next.sandbox_policy.get(),
        next.approval_policy.value(),
        exec_policy,
        &next.cwd,
        next.features.enabled(Feature::RequestPermissions),
    ))
}

fn build_collaboration_mode_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
) -> Option<DeveloperInstructions> {
    let prev = previous?;
    if prev.collaboration_mode.as_ref() != Some(&next.collaboration_mode) {
        Some(DeveloperInstructions::from_collaboration_mode(
            &next.collaboration_mode,
        )?)
    } else {
        None
    }
}

fn build_personality_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
    personality_feature_enabled: bool,
) -> Option<DeveloperInstructions> {
    if !personality_feature_enabled {
        return None;
    }
    let previous = previous?;
    if next.model_info.slug != previous.model {
        return None;
    }
    if let Some(personality) = next.personality
        && next.personality != previous.personality
    {
        let personality_message = personality_message_for(&next.model_info, personality);
        personality_message.map(DeveloperInstructions::personality_spec_message)
    } else {
        None
    }
}

fn build_text_message(role: &str, text_sections: Vec<String>) -> Option<ResponseItem> {
    if text_sections.is_empty() {
        return None;
    }
    let content = text_sections
        .into_iter()
        .map(|text| ContentItem::InputText { text })
        .collect();
    Some(ResponseItem::Message {
        id: None,
        role: role.to_string(),
        content,
        end_turn: None,
        phase: None,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct BuildRequestPayloadError {
    pub message: String,
    pub data: Option<Value>,
}

type BuildRequestPayloadResult<T> = Result<T, BuildRequestPayloadError>;

pub fn build_request_payload(
    payload: Value,
    response_input_items: Vec<Value>,
    builtin_tool_specs: Vec<ToolSpec>,
    host_tool_specs: Vec<ToolSpec>,
) -> BuildRequestPayloadResult<Value> {
    let payload = match payload {
        Value::Object(map) => map,
        other => {
            return Err(BuildRequestPayloadError {
                message: "wasm_v2 expected model payload object".to_string(),
                data: Some(other),
            });
        }
    };

    let transport_tools = transport_tools_from_host_specs(&builtin_tool_specs, &host_tool_specs);
    let serialized_response_input_items = Value::Array(response_input_items.clone());
    let transport_payload =
        build_transport_payload(&payload, response_input_items, transport_tools)?;

    Ok(Value::Object(Map::from_iter([
        (
            "responseInputItems".to_string(),
            serialized_response_input_items,
        ),
        ("transportPayload".to_string(), transport_payload),
    ])))
}

fn build_transport_payload(
    payload: &Map<String, Value>,
    response_input_items: Vec<Value>,
    tools: Value,
) -> BuildRequestPayloadResult<Value> {
    let model = payload
        .get("model")
        .cloned()
        .ok_or_else(|| BuildRequestPayloadError {
            message: "wasm_v2 expected model payload to include `model`".to_string(),
            data: None,
        })?;
    let base_instructions = payload
        .get("baseInstructions")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned);
    let contextual_messages = extract_contextual_user_messages(payload);
    let instructions = std::iter::once(base_instructions.as_deref())
        .flatten()
        .chain(contextual_messages.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(Value::Object(Map::from_iter([
        ("model".to_string(), model),
        (
            "instructions".to_string(),
            if instructions.is_empty() {
                Value::Null
            } else {
                Value::String(instructions)
            },
        ),
        ("input".to_string(), Value::Array(response_input_items)),
        ("tools".to_string(), tools),
        ("tool_choice".to_string(), Value::String("auto".to_string())),
        ("parallel_tool_calls".to_string(), Value::Bool(true)),
        ("stream".to_string(), Value::Bool(true)),
    ])))
}

fn extract_contextual_user_messages(payload: &Map<String, Value>) -> Vec<String> {
    let codex_instructions = payload.get("codexInstructions").and_then(Value::as_object);
    let contextual_messages = codex_instructions
        .and_then(|value| value.get("contextualUserMessages"))
        .and_then(Value::as_array);
    contextual_messages
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub fn transport_tools_from_host_specs(
    builtin_tool_specs: &[ToolSpec],
    host_tool_specs: &[ToolSpec],
) -> Value {
    let tools = builtin_tool_specs
        .iter()
        .chain(host_tool_specs.iter())
        .map(|tool| {
            Value::Object(Map::from_iter([
                ("type".to_string(), Value::String("function".to_string())),
                ("name".to_string(), Value::String(tool.tool_name.clone())),
                (
                    "description".to_string(),
                    Value::String(tool.description.clone()),
                ),
                ("strict".to_string(), Value::Bool(false)),
                ("parameters".to_string(), tool.input_schema.clone()),
            ]))
        })
        .collect::<Vec<_>>();
    Value::Array(tools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    #[test]
    fn request_payload_contains_transport_payload_and_response_input_items() {
        let payload = json!({
            "model": "gpt-5",
            "baseInstructions": "be precise",
            "codexInstructions": {
                "contextualUserMessages": ["repo is browser-only"]
            }
        });
        let response_input_items = vec![json!({"type": "message"})];
        let tools = vec![ToolSpec {
            tool_name: "read_file".to_string(),
            tool_namespace: None,
            description: "Reads a file".to_string(),
            input_schema: json!({"type": "object"}),
        }];

        let request =
            build_request_payload(payload, response_input_items.clone(), tools, Vec::new())
                .expect("payload should build");

        assert_eq!(
            request,
            json!({
                "responseInputItems": response_input_items,
                "transportPayload": {
                    "model": "gpt-5",
                    "instructions": "be precise\n\nrepo is browser-only",
                    "input": [{"type": "message"}],
                    "tools": [{
                        "type": "function",
                        "name": "read_file",
                        "description": "Reads a file",
                        "strict": false,
                        "parameters": {"type": "object"}
                    }],
                    "tool_choice": "auto",
                    "parallel_tool_calls": true,
                    "stream": true
                }
            })
        );
    }
}
