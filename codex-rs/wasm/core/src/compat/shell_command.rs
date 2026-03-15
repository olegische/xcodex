#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_shell_command::parse_command::parse_command;

#[cfg(target_arch = "wasm32")]
pub(crate) fn parse_command(
    command: &[String],
) -> Vec<codex_protocol::parse_command::ParsedCommand> {
    vec![codex_protocol::parse_command::ParsedCommand::Unknown {
        cmd: command.join(" "),
    }]
}
