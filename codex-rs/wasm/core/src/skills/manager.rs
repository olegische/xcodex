use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use codex_protocol::models::PermissionProfile;
use codex_protocol::protocol::SkillScope;
use serde::Deserialize;

use crate::config::Config;
use crate::plugins::PluginsManager;
use crate::skills::SkillLoadOutcome;
use crate::skills::model::SkillDependencies;
use crate::skills::model::SkillError;
use crate::skills::model::SkillInterface;
use crate::skills::model::SkillMetadata;
use crate::skills::model::SkillPolicy;
use crate::skills::model::SkillToolDependency;

const SKILL_FILENAME: &str = "SKILL.md";
const SKILL_METADATA_RELATIVE_PATH: &str = "agents/openai.yaml";
const MAX_SCAN_DEPTH: usize = 6;

pub struct SkillsManager {
    codex_home: PathBuf,
    #[allow(dead_code)]
    plugins_manager: Arc<PluginsManager>,
    bundled_skills_enabled: bool,
    cache_by_cwd: RwLock<HashMap<PathBuf, SkillLoadOutcome>>,
}

impl SkillsManager {
    pub fn new(
        codex_home: PathBuf,
        plugins_manager: Arc<PluginsManager>,
        bundled_skills_enabled: bool,
    ) -> Self {
        Self {
            codex_home,
            plugins_manager,
            bundled_skills_enabled,
            cache_by_cwd: RwLock::new(HashMap::new()),
        }
    }

    pub fn skills_for_config(&self, config: &Config) -> SkillLoadOutcome {
        self.load_skills_for_cwd(&config.codex_home, &[])
    }

    pub async fn skills_for_cwd(&self, cwd: &Path, force_reload: bool) -> SkillLoadOutcome {
        if !force_reload && let Some(outcome) = self.cached_outcome_for_cwd(cwd) {
            return outcome;
        }
        self.load_skills_for_cwd(cwd, &[])
    }

    pub async fn skills_for_cwd_with_extra_user_roots(
        &self,
        cwd: &Path,
        force_reload: bool,
        extra_user_roots: &[PathBuf],
    ) -> SkillLoadOutcome {
        if !force_reload && let Some(outcome) = self.cached_outcome_for_cwd(cwd) {
            return outcome;
        }
        self.load_skills_for_cwd(cwd, extra_user_roots)
    }

    pub fn clear_cache(&self) {
        let mut cache = match self.cache_by_cwd.write() {
            Ok(cache) => cache,
            Err(err) => err.into_inner(),
        };
        cache.clear();
    }

    fn cached_outcome_for_cwd(&self, cwd: &Path) -> Option<SkillLoadOutcome> {
        match self.cache_by_cwd.read() {
            Ok(cache) => cache.get(cwd).cloned(),
            Err(err) => err.into_inner().get(cwd).cloned(),
        }
    }

    fn load_skills_for_cwd(&self, cwd: &Path, extra_user_roots: &[PathBuf]) -> SkillLoadOutcome {
        let mut roots = vec![cwd.join("skills"), self.codex_home.join("skills")];
        if self.bundled_skills_enabled {
            roots.push(self.codex_home.join("skills").join(".system"));
        }
        roots.extend(extra_user_roots.iter().cloned());

        let mut outcome = SkillLoadOutcome::default();
        let mut seen_paths = HashSet::new();
        for root in roots {
            discover_skills_under_root(
                &root,
                infer_scope(&root, cwd, &self.codex_home),
                &mut outcome,
            );
        }
        outcome
            .skills
            .retain(|skill| seen_paths.insert(skill.path_to_skills_md.clone()));
        outcome.skills.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.path_to_skills_md.cmp(&right.path_to_skills_md))
        });

        let mut cache = match self.cache_by_cwd.write() {
            Ok(cache) => cache,
            Err(err) => err.into_inner(),
        };
        cache.insert(cwd.to_path_buf(), outcome.clone());
        outcome
    }
}

fn infer_scope(root: &Path, cwd: &Path, codex_home: &Path) -> SkillScope {
    if root.starts_with(cwd) {
        SkillScope::Repo
    } else if root.starts_with(codex_home.join("skills").join(".system")) {
        SkillScope::System
    } else {
        SkillScope::User
    }
}

fn discover_skills_under_root(root: &Path, scope: SkillScope, outcome: &mut SkillLoadOutcome) {
    walk_dir(root, root, scope, 0, outcome);
}

fn walk_dir(
    root: &Path,
    dir: &Path,
    scope: SkillScope,
    depth: usize,
    outcome: &mut SkillLoadOutcome,
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_dir(root, &path, scope, depth + 1, outcome);
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) != Some(SKILL_FILENAME) {
            continue;
        }
        match parse_skill(root, &path, scope) {
            Ok(skill) => outcome.skills.push(skill),
            Err(message) => outcome.errors.push(SkillError {
                path: path.clone(),
                message,
            }),
        }
    }
}

fn parse_skill(root: &Path, path: &Path, scope: SkillScope) -> Result<SkillMetadata, String> {
    let contents = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let (frontmatter, _) = parse_frontmatter(&contents)?;
    let metadata = load_skill_metadata_file(path.parent().unwrap_or(root));

    Ok(SkillMetadata {
        name: frontmatter
            .name
            .ok_or_else(|| "missing field `name`".to_string())?,
        description: frontmatter
            .description
            .ok_or_else(|| "missing field `description`".to_string())?,
        short_description: frontmatter.metadata.short_description,
        interface: metadata.interface,
        dependencies: metadata.dependencies,
        policy: metadata.policy,
        permission_profile: metadata.permission_profile,
        path_to_skills_md: path.to_path_buf(),
        scope,
    })
}

fn parse_frontmatter(contents: &str) -> Result<(SkillFrontmatter, &str), String> {
    let Some(rest) = contents.strip_prefix("---\n") else {
        return Err("missing YAML frontmatter delimited by ---".to_string());
    };
    let Some((yaml, body)) = rest.split_once("\n---\n") else {
        return Err("missing YAML frontmatter delimited by ---".to_string());
    };
    let frontmatter =
        serde_yaml::from_str::<SkillFrontmatter>(yaml).map_err(|err| err.to_string())?;
    Ok((frontmatter, body))
}

fn load_skill_metadata_file(skill_dir: &Path) -> LoadedSkillMetadata {
    let metadata_path = skill_dir.join(SKILL_METADATA_RELATIVE_PATH);
    let Ok(contents) = fs::read_to_string(metadata_path) else {
        return LoadedSkillMetadata::default();
    };
    let Ok(metadata) = serde_yaml::from_str::<SkillMetadataFile>(&contents) else {
        return LoadedSkillMetadata::default();
    };

    LoadedSkillMetadata {
        interface: metadata.interface.map(|interface| SkillInterface {
            display_name: interface.display_name,
            short_description: interface.short_description,
            icon_small: interface.icon_small,
            icon_large: interface.icon_large,
            brand_color: interface.brand_color,
            default_prompt: interface.default_prompt,
        }),
        dependencies: metadata.dependencies.map(|dependencies| SkillDependencies {
            tools: dependencies
                .tools
                .into_iter()
                .filter_map(|tool| {
                    let r#type = tool.kind?;
                    let value = tool.value?;
                    Some(SkillToolDependency {
                        r#type,
                        value,
                        description: tool.description,
                        transport: tool.transport,
                        command: tool.command,
                        url: tool.url,
                    })
                })
                .collect(),
        }),
        policy: metadata.policy.map(|policy| SkillPolicy {
            allow_implicit_invocation: policy.allow_implicit_invocation,
        }),
        permission_profile: metadata.permissions,
    }
}

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    metadata: SkillFrontmatterMetadata,
}

#[derive(Debug, Default, Deserialize)]
struct SkillFrontmatterMetadata {
    #[serde(default, rename = "short-description")]
    short_description: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct SkillMetadataFile {
    #[serde(default)]
    interface: Option<Interface>,
    #[serde(default)]
    dependencies: Option<Dependencies>,
    #[serde(default)]
    policy: Option<Policy>,
    #[serde(default)]
    permissions: Option<PermissionProfile>,
}

#[derive(Debug, Default)]
struct LoadedSkillMetadata {
    interface: Option<SkillInterface>,
    dependencies: Option<SkillDependencies>,
    policy: Option<SkillPolicy>,
    permission_profile: Option<PermissionProfile>,
}

#[derive(Debug, Default, Deserialize)]
struct Interface {
    display_name: Option<String>,
    short_description: Option<String>,
    icon_small: Option<PathBuf>,
    icon_large: Option<PathBuf>,
    brand_color: Option<String>,
    default_prompt: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Dependencies {
    #[serde(default)]
    tools: Vec<DependencyTool>,
}

#[derive(Debug, Deserialize)]
struct Policy {
    #[serde(default)]
    allow_implicit_invocation: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
struct DependencyTool {
    #[serde(rename = "type")]
    kind: Option<String>,
    value: Option<String>,
    description: Option<String>,
    transport: Option<String>,
    command: Option<String>,
    url: Option<String>,
}
