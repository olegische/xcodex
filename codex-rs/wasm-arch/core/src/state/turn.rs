use serde_json::Value;

/// Turn-scoped mutable state for the WASM mirror runtime.
pub(crate) struct ActiveTurn {
    response_input_items: Vec<Value>,
    request_index: usize,
}

impl ActiveTurn {
    pub(crate) fn new(input: &Value) -> Self {
        Self {
            response_input_items: match input {
                Value::Array(items) => items.clone(),
                other => vec![other.clone()],
            },
            request_index: 0,
        }
    }

    pub(crate) fn request_index(&self) -> usize {
        self.request_index
    }

    pub(crate) fn next_request_id(&self, turn_id: &str) -> String {
        if self.request_index == 0 {
            turn_id.to_string()
        } else {
            format!("{turn_id}:{}", self.request_index)
        }
    }

    pub(crate) fn response_input_items(&self) -> Vec<Value> {
        self.response_input_items.clone()
    }

    pub(crate) fn push_response_input(&mut self, value: Value) {
        self.response_input_items.push(value);
    }

    pub(crate) fn advance(&mut self) {
        self.request_index += 1;
    }
}
