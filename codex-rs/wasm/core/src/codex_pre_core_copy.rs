use crate::state::ActiveTurn;
use crate::state::SessionState;
use crate::stream_events_utils::OutputItemResult;
use crate::stream_events_utils::handle_output_item_done;
use crate::stream_events_utils::record_response_input_items;
use crate::tasks::RegularTask;
use crate::tasks::SessionTask;
use codex_protocol::models::ResponseInputItem;
use codex_protocol::models::ResponseItem;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviousTurnSettings {
    pub model: String,
    pub realtime_active: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionConfiguration {
    pub model: String,
    pub base_instructions: String,
    pub developer_instructions: Option<String>,
    pub user_instructions: Option<String>,
    pub cwd: Option<String>,
}

impl Default for SessionConfiguration {
    fn default() -> Self {
        Self {
            model: "gpt-5".to_string(),
            base_instructions: String::new(),
            developer_instructions: None,
            user_instructions: None,
            cwd: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnContext {
    pub sub_id: String,
    pub model: String,
    pub cwd: Option<String>,
    pub developer_instructions: Option<String>,
    pub user_instructions: Option<String>,
}

impl TurnContext {
    pub fn from_session_configuration(
        session_configuration: &SessionConfiguration,
        sub_id: impl Into<String>,
    ) -> Self {
        Self {
            sub_id: sub_id.into(),
            model: session_configuration.model.clone(),
            cwd: session_configuration.cwd.clone(),
            developer_instructions: session_configuration.developer_instructions.clone(),
            user_instructions: session_configuration.user_instructions.clone(),
        }
    }
}

/// Entry point for the mirrored WASM runtime.
pub struct Codex {
    session: Session,
}

/// Context for an initialized browser-backed agent session.
pub struct Session {
    session_configuration: SessionConfiguration,
    state: SessionState,
    active_turn: Option<ActiveTurn>,
    previous_turn_settings: Option<PreviousTurnSettings>,
}

#[derive(Debug, Default, PartialEq)]
pub struct TurnRunResult {
    pub last_agent_message: Option<String>,
    pub needs_follow_up: bool,
    pub response_input_items: Vec<ResponseInputItem>,
}

#[derive(Debug, Default, PartialEq)]
struct SamplingRequestResult {
    needs_follow_up: bool,
    last_agent_message: Option<String>,
}

impl Codex {
    pub fn new() -> Self {
        Self {
            session: Session::new(),
        }
    }

    pub fn session(&self) -> &Session {
        &self.session
    }

    pub fn regular_task(&self) -> RegularTask {
        RegularTask
    }

    pub fn submit_input<I>(&mut self, input: I) -> Result<Option<String>, String>
    where
        I: IntoIterator<Item = ResponseInputItem>,
    {
        let input = input.into_iter().collect::<Vec<_>>();
        let turn_context =
            TurnContext::from_session_configuration(&self.session.session_configuration, "turn-1");
        self.session
            .submit_input(input, self.regular_task(), &turn_context)
    }

    pub fn run_turn<I>(&mut self, model_output: I) -> Result<TurnRunResult, String>
    where
        I: IntoIterator<Item = ResponseItem>,
    {
        self.session.run_turn(model_output)
    }
}

impl Session {
    pub fn new() -> Self {
        Self {
            session_configuration: SessionConfiguration::default(),
            state: SessionState::default(),
            active_turn: None,
            previous_turn_settings: None,
        }
    }

    pub fn state(&self) -> &SessionState {
        &self.state
    }

    pub fn session_configuration(&self) -> &SessionConfiguration {
        &self.session_configuration
    }

    pub fn previous_turn_settings(&self) -> Option<PreviousTurnSettings> {
        self.previous_turn_settings.clone()
    }

    pub fn set_previous_turn_settings(
        &mut self,
        previous_turn_settings: Option<PreviousTurnSettings>,
    ) {
        self.previous_turn_settings = previous_turn_settings;
    }

    pub fn push_pending_input(&mut self, input: ResponseInputItem) {
        let turn = self.active_turn.get_or_insert_with(ActiveTurn::default);
        turn.push_pending_input(input);
    }

    pub fn take_pending_input(&mut self) -> Vec<ResponseInputItem> {
        self.active_turn
            .as_mut()
            .map(ActiveTurn::take_pending_input)
            .unwrap_or_default()
    }

    pub fn has_pending_input(&self) -> bool {
        self.active_turn
            .as_ref()
            .is_some_and(ActiveTurn::has_pending_input)
    }

    pub fn submit_input(
        &mut self,
        input: Vec<ResponseInputItem>,
        task: RegularTask,
        ctx: &TurnContext,
    ) -> Result<Option<String>, String> {
        let mut turn = ActiveTurn::default();
        for item in input.clone() {
            turn.push_pending_input(item);
        }
        self.active_turn = Some(turn);

        let mut active_turn = self.active_turn.take().unwrap_or_default();
        let result = task.run(self, ctx, input, &mut active_turn)?;
        self.active_turn = Some(active_turn);
        Ok(result)
    }

    pub fn run_turn<I>(&mut self, model_output: I) -> Result<TurnRunResult, String>
    where
        I: IntoIterator<Item = ResponseItem>,
    {
        let mut sampling_result = SamplingRequestResult::default();

        for item in model_output {
            let OutputItemResult {
                recorded_items,
                response_input_items,
                last_agent_message,
                needs_follow_up,
                tool_call: _,
            } = handle_output_item_done(item)?;

            if !recorded_items.is_empty() {
                self.state.record_items(recorded_items);
            }
            if let Some(last_agent_message) = last_agent_message {
                sampling_result.last_agent_message = Some(last_agent_message);
            }
            sampling_result.needs_follow_up |= needs_follow_up;
            for item in response_input_items {
                self.push_pending_input(item);
            }
        }

        sampling_result.needs_follow_up |= self.has_pending_input();
        let response_input_items = self.take_pending_input();
        let response_items = record_response_input_items(&response_input_items);
        if !response_items.is_empty() {
            self.state.record_items(response_items);
        }

        self.active_turn = None;
        self.set_previous_turn_settings(Some(PreviousTurnSettings {
            model: self.session_configuration.model.clone(),
            realtime_active: None,
        }));

        Ok(TurnRunResult {
            last_agent_message: sampling_result.last_agent_message,
            needs_follow_up: sampling_result.needs_follow_up,
            response_input_items,
        })
    }
}

pub fn run_turn(
    sess: &mut Session,
    _turn_context: &TurnContext,
    input: Vec<ResponseInputItem>,
    turn: &mut ActiveTurn,
) -> Result<Option<String>, String> {
    let input_response_items = input
        .iter()
        .filter_map(|item| match item {
            ResponseInputItem::Message { role, content } => Some(ResponseItem::Message {
                id: None,
                role: role.clone(),
                content: content.clone(),
                end_turn: None,
                phase: None,
            }),
            ResponseInputItem::FunctionCallOutput { call_id, output } => {
                Some(ResponseItem::FunctionCallOutput {
                    call_id: call_id.clone(),
                    output: output.clone(),
                })
            }
            ResponseInputItem::CustomToolCallOutput { call_id, output } => {
                Some(ResponseItem::CustomToolCallOutput {
                    call_id: call_id.clone(),
                    output: output.clone(),
                })
            }
            ResponseInputItem::ToolSearchOutput {
                call_id,
                status,
                execution,
                tools,
            } => Some(ResponseItem::ToolSearchOutput {
                call_id: Some(call_id.clone()),
                status: status.clone(),
                execution: execution.clone(),
                tools: tools.clone(),
            }),
            ResponseInputItem::McpToolCallOutput { .. } => None,
        })
        .collect::<Vec<_>>();

    for item in input {
        turn.push_pending_input(item);
    }

    if !input_response_items.is_empty() {
        sess.state.record_items(input_response_items);
        sess.set_previous_turn_settings(Some(PreviousTurnSettings {
            model: sess.session_configuration.model.clone(),
            realtime_active: None,
        }));
        let _ = turn.take_pending_input();
        return Ok(Some("regular_task.completed".to_string()));
    }

    Ok(None)
}

impl Default for Codex {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn run_turn_records_assistant_message() {
        let mut codex = Codex::new();

        let result = codex
            .run_turn(vec![ResponseItem::Message {
                id: Some("msg-1".to_string()),
                role: "assistant".to_string(),
                content: vec![codex_protocol::models::ContentItem::OutputText {
                    text: "hello".to_string(),
                }],
                end_turn: Some(true),
                phase: None,
            }])
            .expect("turn should succeed");

        assert_eq!(
            result,
            TurnRunResult {
                last_agent_message: Some("hello".to_string()),
                needs_follow_up: false,
                response_input_items: Vec::new(),
            }
        );
        assert_eq!(codex.session().state().raw_items().len(), 1);
    }

    #[test]
    fn run_turn_marks_tool_follow_up() {
        let mut codex = Codex::new();

        let result = codex
            .run_turn(vec![ResponseItem::FunctionCall {
                id: Some("fc-1".to_string()),
                name: "read_file".to_string(),
                namespace: None,
                arguments: "{}".to_string(),
                call_id: "call-1".to_string(),
            }])
            .expect("turn should succeed");

        assert_eq!(result.needs_follow_up, true);
        assert_eq!(result.last_agent_message, None);
        assert_eq!(codex.session().state().raw_items().len(), 1);
    }

    #[test]
    fn submit_input_updates_previous_turn_settings() {
        let mut codex = Codex::new();

        let result = codex
            .submit_input(vec![ResponseInputItem::Message {
                role: "user".to_string(),
                content: vec![codex_protocol::models::ContentItem::InputText {
                    text: "hello".to_string(),
                }],
            }])
            .expect("submit should succeed");

        assert_eq!(result, Some("regular_task.completed".to_string()));
        assert_eq!(
            codex.session().previous_turn_settings(),
            Some(PreviousTurnSettings {
                model: "gpt-5".to_string(),
                realtime_active: None,
            })
        );
    }
}
