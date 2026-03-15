use super::CollaborationModesConfig;
use super::builtin_collaboration_mode_presets;
use codex_protocol::config_types::ModeKind;
use pretty_assertions::assert_eq;

#[test]
fn default_preset_mentions_request_user_input_unavailable_by_default() {
    let default_instructions =
        builtin_collaboration_mode_presets(CollaborationModesConfig::default())
            .into_iter()
            .find(|preset| preset.mode == Some(ModeKind::Default))
            .and_then(|preset| preset.developer_instructions.flatten())
            .unwrap_or_else(|| unreachable!("default preset should have instructions"));

    assert_eq!(
        default_instructions
            .contains("The `request_user_input` tool is unavailable in Default mode."),
        true
    );
    assert_eq!(
        default_instructions.contains("ask the user directly with a concise plain-text question"),
        true
    );
}

#[test]
fn default_preset_mentions_request_user_input_when_enabled() {
    let default_instructions = builtin_collaboration_mode_presets(CollaborationModesConfig {
        default_mode_request_user_input: true,
    })
    .into_iter()
    .find(|preset| preset.mode == Some(ModeKind::Default))
    .and_then(|preset| preset.developer_instructions.flatten())
    .unwrap_or_else(|| unreachable!("default preset should have instructions"));

    assert_eq!(
        default_instructions
            .contains("The `request_user_input` tool is available in Default mode."),
        true
    );
    assert_eq!(
        default_instructions.contains("prefer using the `request_user_input` tool"),
        true
    );
}

#[test]
fn collaboration_modes_config_reads_default_mode_request_user_input_from_features() {
    let mut features = crate::features::ManagedFeatures::default();
    let _ = features.enable(crate::features::Feature::DefaultModeRequestUserInput);

    assert_eq!(
        CollaborationModesConfig::from_features(&features),
        CollaborationModesConfig {
            default_mode_request_user_input: true,
        }
    );
}
