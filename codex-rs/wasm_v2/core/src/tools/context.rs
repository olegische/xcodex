use codex_protocol::mcp::CallToolResult;
use codex_protocol::models::FunctionCallOutputBody;
use codex_protocol::models::FunctionCallOutputContentItem;
use codex_protocol::models::FunctionCallOutputPayload;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::SearchToolCallParams;
use codex_protocol::models::ShellToolCallParams;
use serde_json::Value as JsonValue;
use std::borrow::Cow;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolCallSource {
    Direct,
    JsRepl,
    CodeMode,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolInvocation {
    pub call_id: String,
    pub tool_name: String,
    pub tool_namespace: Option<String>,
    pub payload: ToolPayload,
}

pub type ToolCall = ToolInvocation;

#[derive(Clone, Debug, PartialEq)]
pub enum ToolPayload {
    Function {
        arguments: String,
    },
    ToolSearch {
        arguments: SearchToolCallParams,
    },
    Custom {
        input: String,
    },
    LocalShell {
        params: ShellToolCallParams,
    },
    Mcp {
        server: String,
        tool: String,
        raw_arguments: String,
    },
}

impl ToolPayload {
    pub fn log_payload(&self) -> Cow<'_, str> {
        match self {
            Self::Function { arguments } => Cow::Borrowed(arguments),
            Self::ToolSearch { arguments } => Cow::Owned(arguments.query.clone()),
            Self::Custom { input } => Cow::Borrowed(input),
            Self::LocalShell { params } => Cow::Owned(params.command.join(" ")),
            Self::Mcp { raw_arguments, .. } => Cow::Borrowed(raw_arguments),
        }
    }
}

pub trait ToolOutput: Send {
    fn log_preview(&self) -> String;

    fn success_for_logging(&self) -> bool;

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem;

    fn code_mode_result(&self, payload: &ToolPayload) -> JsonValue {
        response_input_to_json(self.to_response_item("", payload))
    }
}

impl ToolOutput for CallToolResult {
    fn log_preview(&self) -> String {
        self.as_function_call_output_payload()
            .body
            .to_text()
            .unwrap_or_else(|| serde_json::to_string(self).unwrap_or_default())
    }

    fn success_for_logging(&self) -> bool {
        self.success()
    }

    fn to_response_item(&self, call_id: &str, _payload: &ToolPayload) -> ResponseInputItem {
        ResponseInputItem::McpToolCallOutput {
            call_id: call_id.to_string(),
            output: self.clone(),
        }
    }
}

#[derive(Clone)]
pub struct FunctionToolOutput {
    pub body: Vec<FunctionCallOutputContentItem>,
    pub success: Option<bool>,
}

impl FunctionToolOutput {
    pub fn from_text(text: String, success: Option<bool>) -> Self {
        Self {
            body: vec![FunctionCallOutputContentItem::InputText { text }],
            success,
        }
    }
}

impl ToolOutput for FunctionToolOutput {
    fn log_preview(&self) -> String {
        self.body
            .iter()
            .filter_map(|item| match item {
                FunctionCallOutputContentItem::InputText { text } => Some(text.as_str()),
                FunctionCallOutputContentItem::InputImage { .. } => None,
            })
            .collect::<String>()
    }

    fn success_for_logging(&self) -> bool {
        self.success.unwrap_or(true)
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        let output = FunctionCallOutputPayload {
            body: FunctionCallOutputBody::ContentItems(self.body.clone()),
            success: self.success,
        };
        match payload {
            ToolPayload::Custom { .. } => ResponseInputItem::CustomToolCallOutput {
                call_id: call_id.to_string(),
                output,
            },
            ToolPayload::Function { .. }
            | ToolPayload::ToolSearch { .. }
            | ToolPayload::LocalShell { .. }
            | ToolPayload::Mcp { .. } => ResponseInputItem::FunctionCallOutput {
                call_id: call_id.to_string(),
                output,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolSearchOutput {
    pub tools: Vec<JsonValue>,
}

impl ToolOutput for ToolSearchOutput {
    fn log_preview(&self) -> String {
        JsonValue::Array(self.tools.clone()).to_string()
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, _payload: &ToolPayload) -> ResponseInputItem {
        ResponseInputItem::ToolSearchOutput {
            call_id: call_id.to_string(),
            status: "completed".to_string(),
            execution: "client".to_string(),
            tools: self.tools.clone(),
        }
    }
}

pub fn response_input_to_json(response: ResponseInputItem) -> JsonValue {
    serde_json::to_value(response).unwrap_or(JsonValue::Null)
}
