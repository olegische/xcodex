use std::collections::BTreeSet;

use codex_protocol::openai_models::ModelInfo;
use codex_protocol::protocol::Event;

use crate::auth::AuthManager;
use crate::auth::CodexAuth;
use crate::compat::otel::SessionTelemetry;

#[derive(Debug, Clone, Copy)]
pub enum Stage {
    Stable,
    UnderDevelopment,
    Experimental {
        name: &'static str,
        menu_description: &'static str,
        announcement: &'static str,
    },
}

impl Stage {
    pub fn experimental_menu_description(self) -> Option<&'static str> {
        match self {
            Self::Experimental {
                menu_description, ..
            } => Some(menu_description),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Feature {
    Apps,
    AppsMcpGateway,
    CodeMode,
    CodexGitCommit,
    CodexHooks,
    Collab,
    DefaultModeRequestUserInput,
    EnableRequestCompression,
    GhostCommit,
    GuardianApproval,
    JsRepl,
    JsReplToolsOnly,
    MemoryTool,
    Personality,
    RequestPermissions,
    RuntimeMetrics,
    ShellSnapshot,
    ShellZshFork,
    SkillEnvVarDependencyPrompt,
    SpawnCsv,
    ToolSuggest,
    WebSearchCached,
    WebSearchRequest,
}

impl Feature {
    pub fn key(self) -> &'static str {
        match self {
            Self::Apps => "apps",
            Self::AppsMcpGateway => "apps-mcp-gateway",
            Self::CodeMode => "code-mode",
            Self::CodexGitCommit => "codex-git-commit",
            Self::CodexHooks => "codex-hooks",
            Self::Collab => "collab",
            Self::DefaultModeRequestUserInput => "default_mode_request_user_input",
            Self::EnableRequestCompression => "enable-request-compression",
            Self::GhostCommit => "ghost-commit",
            Self::GuardianApproval => "guardian-approval",
            Self::JsRepl => "js-repl",
            Self::JsReplToolsOnly => "js-repl-tools-only",
            Self::MemoryTool => "memory-tool",
            Self::Personality => "personality",
            Self::RequestPermissions => "request-permissions",
            Self::RuntimeMetrics => "runtime-metrics",
            Self::ShellSnapshot => "shell-snapshot",
            Self::ShellZshFork => "shell-zsh-fork",
            Self::SkillEnvVarDependencyPrompt => "skill-env-var-dependency-prompt",
            Self::SpawnCsv => "spawn-csv",
            Self::ToolSuggest => "tool_suggest",
            Self::WebSearchCached => "web-search-cached",
            Self::WebSearchRequest => "web-search-request",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FeatureSpec {
    pub id: Feature,
    pub key: &'static str,
    pub stage: Stage,
    pub default_enabled: bool,
    pub enable_beta_header: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyFeatureUsage {
    pub summary: String,
    pub details: String,
}

pub const FEATURES: &[FeatureSpec] = &[
    FeatureSpec {
        id: Feature::EnableRequestCompression,
        key: "enable-request-compression",
        stage: Stage::Stable,
        default_enabled: false,
        enable_beta_header: false,
    },
    FeatureSpec {
        id: Feature::DefaultModeRequestUserInput,
        key: "default_mode_request_user_input",
        stage: Stage::UnderDevelopment,
        default_enabled: false,
        enable_beta_header: false,
    },
    FeatureSpec {
        id: Feature::ToolSuggest,
        key: "tool_suggest",
        stage: Stage::UnderDevelopment,
        default_enabled: false,
        enable_beta_header: false,
    },
    FeatureSpec {
        id: Feature::RuntimeMetrics,
        key: "runtime-metrics",
        stage: Stage::Stable,
        default_enabled: false,
        enable_beta_header: false,
    },
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Features {
    enabled: BTreeSet<Feature>,
}

impl Features {
    pub fn with_defaults() -> Self {
        let mut enabled = BTreeSet::new();
        for spec in FEATURES {
            if spec.default_enabled {
                enabled.insert(spec.id);
            }
        }
        Self { enabled }
    }

    pub fn enabled(&self, feature: Feature) -> bool {
        self.enabled.contains(&feature)
    }

    pub fn set_enabled(&mut self, feature: Feature, enabled: bool) {
        if enabled {
            self.enabled.insert(feature);
        } else {
            self.enabled.remove(&feature);
        }
    }

    pub fn enable(&mut self, feature: Feature) -> anyhow::Result<&mut Self> {
        self.set_enabled(feature, true);
        Ok(self)
    }

    pub fn disable(&mut self, feature: Feature) -> anyhow::Result<&mut Self> {
        self.set_enabled(feature, false);
        Ok(self)
    }

    pub fn apps_enabled_for_auth(&self, _auth: Option<&CodexAuth>) -> bool {
        false
    }

    pub fn apps_enabled_cached(&self, auth_manager: Option<&AuthManager>) -> bool {
        let auth = auth_manager.and_then(AuthManager::auth_cached);
        self.apps_enabled_for_auth(auth.as_ref())
    }

    pub fn responses_websocket_enabled(&self, _model_info: &ModelInfo) -> bool {
        false
    }

    pub fn info(&self, feature: Feature) -> &'static FeatureSpec {
        FEATURES
            .iter()
            .find(|spec| spec.id == feature)
            .unwrap_or_else(|| unreachable!("missing FeatureSpec"))
    }

    pub fn legacy_feature_usages(&self) -> std::iter::Empty<LegacyFeatureUsage> {
        std::iter::empty()
    }

    pub fn emit_metrics(&self, _otel: &SessionTelemetry) {}
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ManagedFeatures {
    value: Features,
}

impl ManagedFeatures {
    pub fn enabled(&self, feature: Feature) -> bool {
        self.value.enabled(feature)
    }

    pub fn get(&self) -> &Features {
        &self.value
    }

    pub fn apps_enabled_for_auth(&self, auth: Option<&CodexAuth>) -> bool {
        self.value.apps_enabled_for_auth(auth)
    }

    pub fn apps_enabled_cached(&self, auth_manager: Option<&AuthManager>) -> bool {
        self.value.apps_enabled_cached(auth_manager)
    }

    pub fn enable(&mut self, feature: Feature) -> anyhow::Result<&mut Self> {
        self.value.enable(feature)?;
        Ok(self)
    }

    pub fn disable(&mut self, feature: Feature) -> anyhow::Result<&mut Self> {
        self.value.disable(feature)?;
        Ok(self)
    }

    pub fn enabled_features(&self) -> Vec<String> {
        self.value
            .enabled
            .iter()
            .map(|feature| self.value.info(*feature).key.to_string())
            .collect()
    }

    pub fn use_legacy_landlock(&self) -> bool {
        false
    }

    pub fn legacy_feature_usages(&self) -> std::iter::Empty<LegacyFeatureUsage> {
        self.value.legacy_feature_usages()
    }

    pub fn emit_metrics(&self, otel: &SessionTelemetry) {
        self.value.emit_metrics(otel);
    }
}

impl From<Features> for ManagedFeatures {
    fn from(value: Features) -> Self {
        Self { value }
    }
}

impl std::ops::Deref for ManagedFeatures {
    type Target = Features;

    fn deref(&self) -> &Self::Target {
        self.get()
    }
}

pub fn maybe_push_unstable_features_warning(
    _config: &crate::config::Config,
    events: &mut Vec<Event>,
) {
    let _ = events;
}
