#[derive(Clone, Debug, Default)]
pub struct StateDbHandle;

impl StateDbHandle {
    pub async fn clear_memory_data(&self) -> anyhow::Result<()> {
        Ok(())
    }

    pub async fn record_stage1_output_usage(
        &self,
        _thread_ids: &[codex_protocol::ThreadId],
    ) -> anyhow::Result<()> {
        Ok(())
    }

    pub async fn mark_thread_memory_mode_polluted(
        &self,
        _thread_id: codex_protocol::ThreadId,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

pub async fn init(_config: &crate::config::Config) -> Option<StateDbHandle> {
    None
}

pub async fn get_state_db(_config: &crate::config::Config) -> Option<StateDbHandle> {
    None
}

pub async fn get_dynamic_tools(
    _db: Option<&StateDbHandle>,
    _thread_id: codex_protocol::ThreadId,
    _reason: &str,
) -> Vec<codex_protocol::dynamic_tools::DynamicToolSpec> {
    Vec::new()
}

pub async fn mark_thread_memory_mode_polluted(
    ctx: Option<&StateDbHandle>,
    thread_id: codex_protocol::ThreadId,
    _stage: &str,
) {
    let Some(ctx) = ctx else {
        return;
    };
    let _ = ctx.mark_thread_memory_mode_polluted(thread_id).await;
}
