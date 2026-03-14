use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;

use crate::analytics_client::AnalyticsEventsClient;
use crate::analytics_client::InvocationType;
use crate::analytics_client::SkillInvocation;
use crate::analytics_client::TrackEventsContext;
use crate::instructions::SkillInstructions;
use crate::mention_syntax::TOOL_MENTION_SIGIL;
use crate::mentions::build_skill_name_counts;
use crate::skills::SkillMetadata;
use codex_otel::SessionTelemetry;
use codex_protocol::models::ResponseItem;
use codex_protocol::user_input::UserInput;
use tokio::fs;

#[derive(Debug, Default)]
pub(crate) struct SkillInjections {
    pub(crate) items: Vec<ResponseItem>,
    pub(crate) warnings: Vec<String>,
}

pub(crate) async fn build_skill_injections(
    mentioned_skills: &[SkillMetadata],
    otel: Option<&SessionTelemetry>,
    analytics_client: &AnalyticsEventsClient,
    tracking: TrackEventsContext,
) -> SkillInjections {
    if mentioned_skills.is_empty() {
        return SkillInjections::default();
    }

    let mut result = SkillInjections {
        items: Vec::with_capacity(mentioned_skills.len()),
        warnings: Vec::new(),
    };
    let mut invocations = Vec::new();

    for skill in mentioned_skills {
        match fs::read_to_string(&skill.path_to_skills_md).await {
            Ok(contents) => {
                emit_skill_injected_metric(otel, skill, "ok");
                invocations.push(SkillInvocation {
                    skill_name: skill.name.clone(),
                    skill_scope: skill.scope,
                    skill_path: skill.path_to_skills_md.clone(),
                    invocation_type: InvocationType::Explicit,
                });
                result.items.push(ResponseItem::from(SkillInstructions {
                    name: skill.name.clone(),
                    path: skill.path_to_skills_md.to_string_lossy().into_owned(),
                    contents,
                }));
            }
            Err(err) => {
                emit_skill_injected_metric(otel, skill, "error");
                result.warnings.push(format!(
                    "Failed to load skill {} at {}: {err:#}",
                    skill.name,
                    skill.path_to_skills_md.display()
                ));
            }
        }
    }

    analytics_client.track_skill_invocations(tracking, invocations);
    result
}

fn emit_skill_injected_metric(
    otel: Option<&SessionTelemetry>,
    skill: &SkillMetadata,
    status: &str,
) {
    let Some(otel) = otel else {
        return;
    };

    otel.counter(
        "codex.skill.injected",
        1,
        &[("status", status), ("skill", skill.name.as_str())],
    );
}

pub(crate) fn collect_explicit_skill_mentions(
    inputs: &[UserInput],
    skills: &[SkillMetadata],
    disabled_paths: &HashSet<PathBuf>,
    connector_slug_counts: &HashMap<String, usize>,
) -> Vec<SkillMetadata> {
    let skill_name_counts = build_skill_name_counts(skills, disabled_paths).0;
    let selection_context = SkillSelectionContext {
        skills,
        disabled_paths,
        skill_name_counts: &skill_name_counts,
        connector_slug_counts,
    };
    let mut selected = Vec::new();
    let mut seen_names = HashSet::new();
    let mut seen_paths = HashSet::new();
    let mut blocked_plain_names = HashSet::new();

    for input in inputs {
        if let UserInput::Skill { name, path } = input {
            blocked_plain_names.insert(name.clone());
            if selection_context.disabled_paths.contains(path) || seen_paths.contains(path) {
                continue;
            }
            if let Some(skill) = selection_context
                .skills
                .iter()
                .find(|skill| skill.path_to_skills_md.as_path() == path.as_path())
            {
                seen_paths.insert(skill.path_to_skills_md.clone());
                seen_names.insert(skill.name.clone());
                selected.push(skill.clone());
            }
        }
    }

    for input in inputs {
        if let UserInput::Text { text, .. } = input {
            let mentioned_names = extract_tool_mentions(text);
            select_skills_from_mentions(
                &selection_context,
                &blocked_plain_names,
                &mentioned_names,
                &mut seen_names,
                &mut seen_paths,
                &mut selected,
            );
        }
    }

    selected
}

struct SkillSelectionContext<'a> {
    skills: &'a [SkillMetadata],
    disabled_paths: &'a HashSet<PathBuf>,
    skill_name_counts: &'a HashMap<String, usize>,
    connector_slug_counts: &'a HashMap<String, usize>,
}

pub(crate) struct ToolMentions<'a> {
    names: HashSet<&'a str>,
    paths: HashSet<&'a str>,
    plain_names: HashSet<&'a str>,
}

impl<'a> ToolMentions<'a> {
    pub(crate) fn plain_names(&self) -> impl Iterator<Item = &'a str> + '_ {
        self.plain_names.iter().copied()
    }

    pub(crate) fn paths(&self) -> impl Iterator<Item = &'a str> + '_ {
        self.paths.iter().copied()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ToolMentionKind {
    App,
    Mcp,
    Plugin,
    Skill,
    Other,
}

const APP_PATH_PREFIX: &str = "app://";
const MCP_PATH_PREFIX: &str = "mcp://";
const PLUGIN_PATH_PREFIX: &str = "plugin://";
const SKILL_PATH_PREFIX: &str = "skill://";
const SKILL_FILENAME: &str = "SKILL.md";

pub(crate) fn tool_kind_for_path(path: &str) -> ToolMentionKind {
    if path.starts_with(APP_PATH_PREFIX) {
        ToolMentionKind::App
    } else if path.starts_with(MCP_PATH_PREFIX) {
        ToolMentionKind::Mcp
    } else if path.starts_with(PLUGIN_PATH_PREFIX) {
        ToolMentionKind::Plugin
    } else if path.starts_with(SKILL_PATH_PREFIX) || is_skill_filename(path) {
        ToolMentionKind::Skill
    } else {
        ToolMentionKind::Other
    }
}

fn is_skill_filename(path: &str) -> bool {
    let file_name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    file_name.eq_ignore_ascii_case(SKILL_FILENAME)
}

pub(crate) fn app_id_from_path(path: &str) -> Option<&str> {
    path.strip_prefix(APP_PATH_PREFIX)
        .filter(|value| !value.is_empty())
}

pub(crate) fn plugin_config_name_from_path(path: &str) -> Option<&str> {
    path.strip_prefix(PLUGIN_PATH_PREFIX)
        .filter(|value| !value.is_empty())
}

pub(crate) fn extract_tool_mentions(text: &str) -> ToolMentions<'_> {
    extract_tool_mentions_with_sigil(text, TOOL_MENTION_SIGIL)
}

pub(crate) fn extract_tool_mentions_with_sigil(text: &str, sigil: char) -> ToolMentions<'_> {
    let text_bytes = text.as_bytes();
    let mut mentioned_names = HashSet::new();
    let mut mentioned_paths = HashSet::new();
    let mut plain_names = HashSet::new();
    let mut index = 0;

    while index < text_bytes.len() {
        let byte = text_bytes[index];
        if byte == b'['
            && let Some((name, path, end_index)) =
                parse_linked_tool_mention(text, text_bytes, index, sigil)
        {
            mentioned_names.insert(name);
            mentioned_paths.insert(path);
            index = end_index;
            continue;
        }
        if byte == sigil as u8
            && let Some((name, end_index)) = parse_plain_tool_mention(text, text_bytes, index)
        {
            mentioned_names.insert(name);
            plain_names.insert(name);
            index = end_index;
            continue;
        }
        index += 1;
    }

    ToolMentions {
        names: mentioned_names,
        paths: mentioned_paths,
        plain_names,
    }
}

fn parse_linked_tool_mention<'a>(
    text: &'a str,
    text_bytes: &[u8],
    start: usize,
    sigil: char,
) -> Option<(&'a str, &'a str, usize)> {
    let close_bracket = text_bytes[start + 1..]
        .iter()
        .position(|byte| *byte == b']')?
        + start
        + 1;
    let name = text.get(start + 2..close_bracket)?;
    if !text.get(start + 1..start + 2)?.starts_with(sigil) {
        return None;
    }
    let open_paren = close_bracket + 1;
    if *text_bytes.get(open_paren)? != b'(' {
        return None;
    }
    let close_paren = text_bytes[open_paren + 1..]
        .iter()
        .position(|byte| *byte == b')')?
        + open_paren
        + 1;
    let path = text.get(open_paren + 1..close_paren)?;
    Some((name, path, close_paren + 1))
}

fn parse_plain_tool_mention<'a>(
    text: &'a str,
    text_bytes: &[u8],
    start: usize,
) -> Option<(&'a str, usize)> {
    let mut end = start + 1;
    while end < text_bytes.len() {
        let byte = text_bytes[end];
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'/') {
            end += 1;
        } else {
            break;
        }
    }
    if end == start + 1 {
        return None;
    }
    Some((text.get(start + 1..end)?, end))
}

fn select_skills_from_mentions(
    selection_context: &SkillSelectionContext<'_>,
    blocked_plain_names: &HashSet<String>,
    mentioned: &ToolMentions<'_>,
    seen_names: &mut HashSet<String>,
    seen_paths: &mut HashSet<PathBuf>,
    selected: &mut Vec<SkillMetadata>,
) {
    if mentioned.names.is_empty() && mentioned.paths.is_empty() {
        return;
    }

    for skill in selection_context.skills {
        if selection_context
            .disabled_paths
            .contains(&skill.path_to_skills_md)
            || seen_paths.contains(&skill.path_to_skills_md)
        {
            continue;
        }

        let normalized_path = skill.path_to_skills_md.to_string_lossy();
        if mentioned.paths.contains(normalized_path.as_ref())
            || mentioned
                .paths
                .contains(format!("skill://{normalized_path}").as_str())
        {
            seen_paths.insert(skill.path_to_skills_md.clone());
            seen_names.insert(skill.name.clone());
            selected.push(skill.clone());
            continue;
        }

        if blocked_plain_names.contains(&skill.name) {
            continue;
        }
        let skill_name_lower = skill.name.to_ascii_lowercase();
        let skill_count = selection_context
            .skill_name_counts
            .get(&skill.name)
            .copied()
            .unwrap_or(0);
        let connector_count = selection_context
            .connector_slug_counts
            .get(&skill_name_lower)
            .copied()
            .unwrap_or(0);
        if skill_count == 1
            && connector_count == 0
            && mentioned
                .plain_names()
                .any(|name| name.eq_ignore_ascii_case(skill.name.as_str()))
            && seen_names.insert(skill.name.clone())
        {
            seen_paths.insert(skill.path_to_skills_md.clone());
            selected.push(skill.clone());
        }
    }
}
