pub const GUARDIAN_SUBAGENT_NAME: &str = "guardian";

pub fn is_guardian_subagent_source(source: &codex_protocol::protocol::SessionSource) -> bool {
    matches!(
        source,
        codex_protocol::protocol::SessionSource::SubAgent(
            codex_protocol::protocol::SubAgentSource::Other(name)
        ) if name == GUARDIAN_SUBAGENT_NAME
    )
}
