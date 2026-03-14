pub async fn get_user_instructions(
    _config: &crate::config::Config,
    _allowed_skills_for_implicit_invocation: Option<&Vec<crate::skills::model::SkillMetadata>>,
    _plugin_summaries: Option<&[crate::plugins::PluginCapabilitySummary]>,
) -> Option<String> {
    None
}
