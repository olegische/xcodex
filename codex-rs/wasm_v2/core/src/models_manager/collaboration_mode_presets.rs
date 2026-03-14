use codex_protocol::config_types::CollaborationModeMask;
use codex_protocol::config_types::ModeKind;
use codex_protocol::config_types::TUI_VISIBLE_COLLABORATION_MODES;
use codex_protocol::openai_models::ReasoningEffort;

const COLLABORATION_MODE_PLAN: &str = include_str!("../../templates/collaboration_mode/plan.md");
const COLLABORATION_MODE_DEFAULT: &str =
    include_str!("../../templates/collaboration_mode/default.md");

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CollaborationModesConfig {
    pub default_mode_request_user_input: bool,
}

pub(crate) fn builtin_collaboration_mode_presets(
    _collaboration_modes_config: CollaborationModesConfig,
) -> Vec<CollaborationModeMask> {
    vec![
        CollaborationModeMask {
            name: ModeKind::Plan.display_name().to_string(),
            mode: Some(ModeKind::Plan),
            model: None,
            reasoning_effort: Some(Some(ReasoningEffort::Medium)),
            developer_instructions: Some(Some(COLLABORATION_MODE_PLAN.to_string())),
        },
        CollaborationModeMask {
            name: ModeKind::Default.display_name().to_string(),
            mode: Some(ModeKind::Default),
            model: None,
            reasoning_effort: None,
            developer_instructions: Some(Some(
                COLLABORATION_MODE_DEFAULT.replace(
                    "{{KNOWN_MODE_NAMES}}",
                    &TUI_VISIBLE_COLLABORATION_MODES
                        .iter()
                        .map(|mode| mode.display_name())
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
            )),
        },
    ]
}
