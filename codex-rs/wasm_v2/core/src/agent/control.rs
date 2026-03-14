use codex_protocol::ThreadId;

#[derive(Clone, Default)]
pub(crate) struct AgentControl;

impl AgentControl {
    pub(crate) async fn format_environment_context_subagents(
        &self,
        _parent_thread_id: ThreadId,
    ) -> String {
        String::new()
    }
}
