use crate::host::HostError;
use crate::host::HostErrorCode;
use crate::host::HostResult;
use crate::host::HostToolSpec;
use crate::tool_search::create_tool_search_transport_tool;
use serde_json::Map;
use serde_json::Value;

pub(crate) fn build_request_payload(
    payload: Value,
    response_input_items: Vec<Value>,
    builtin_tool_specs: Vec<HostToolSpec>,
    host_tool_specs: Vec<HostToolSpec>,
) -> HostResult<Value> {
    let payload = match payload {
        Value::Object(map) => map,
        other => {
            return Err(HostError {
                code: HostErrorCode::InvalidInput,
                message: "browser runtime expected model payload object".to_string(),
                retryable: false,
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
) -> HostResult<Value> {
    let model = payload.get("model").cloned().ok_or_else(|| HostError {
        code: HostErrorCode::Internal,
        message: "browser runtime expected model payload to include `model`".to_string(),
        retryable: false,
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

pub(crate) fn transport_tools_from_host_specs(
    builtin_tool_specs: &[HostToolSpec],
    host_tool_specs: &[HostToolSpec],
) -> Value {
    let mut tools = builtin_tool_specs
        .iter()
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
    if let Some(tool_search_tool) = create_tool_search_transport_tool(host_tool_specs) {
        tools.push(tool_search_tool);
    }
    Value::Array(tools)
}
