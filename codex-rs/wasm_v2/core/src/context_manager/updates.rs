use crate::tools::spec::ToolSpec;
use serde_json::Map;
use serde_json::Value;

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
