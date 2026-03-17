use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

pub use codex_protocol::config_types::Personality;
pub use codex_protocol::config_types::Verbosity;
use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;
use serde::de::Error as SerdeError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpServerDisabledReason {
    Unknown,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct McpServerConfig {
    #[serde(flatten)]
    pub transport: McpServerTransportConfig,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(skip)]
    pub disabled_reason: Option<McpServerDisabledReason>,
    #[serde(default, with = "option_duration_secs")]
    pub startup_timeout_sec: Option<Duration>,
    #[serde(default, with = "option_duration_secs")]
    pub tool_timeout_sec: Option<Duration>,
    #[serde(default)]
    pub enabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub disabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    #[serde(default)]
    pub oauth_resource: Option<String>,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            transport: McpServerTransportConfig::Stdio {
                command: String::new(),
                args: Vec::new(),
                env: None,
                env_vars: Vec::new(),
                cwd: None,
            },
            enabled: true,
            required: false,
            disabled_reason: None,
            startup_timeout_sec: None,
            tool_timeout_sec: None,
            enabled_tools: None,
            disabled_tools: None,
            scopes: None,
            oauth_resource: None,
        }
    }
}

#[derive(Deserialize, Clone)]
struct RawMcpServerConfig {
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub env_vars: Option<Vec<String>>,
    #[serde(default)]
    pub cwd: Option<PathBuf>,
    pub http_headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub env_http_headers: Option<HashMap<String, String>>,
    pub url: Option<String>,
    pub bearer_token: Option<String>,
    pub bearer_token_env_var: Option<String>,
    #[serde(default)]
    pub startup_timeout_sec: Option<f64>,
    #[serde(default)]
    pub startup_timeout_ms: Option<u64>,
    #[serde(default, with = "option_duration_secs")]
    pub tool_timeout_sec: Option<Duration>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub enabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub disabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    #[serde(default)]
    pub oauth_resource: Option<String>,
}

impl<'de> Deserialize<'de> for McpServerConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut raw = RawMcpServerConfig::deserialize(deserializer)?;

        let startup_timeout_sec = match (raw.startup_timeout_sec, raw.startup_timeout_ms) {
            (Some(sec), _) => Some(Duration::try_from_secs_f64(sec).map_err(SerdeError::custom)?),
            (None, Some(ms)) => Some(Duration::from_millis(ms)),
            (None, None) => None,
        };

        let tool_timeout_sec = raw.tool_timeout_sec;
        let enabled = raw.enabled.unwrap_or_else(default_enabled);
        let required = raw.required.unwrap_or_default();
        let enabled_tools = raw.enabled_tools.clone();
        let disabled_tools = raw.disabled_tools.clone();
        let scopes = raw.scopes.clone();
        let oauth_resource = raw.oauth_resource.clone();

        fn throw_if_set<E, T>(transport: &str, field: &str, value: Option<&T>) -> Result<(), E>
        where
            E: SerdeError,
        {
            if value.is_none() {
                return Ok(());
            }
            Err(E::custom(format!(
                "{field} is not supported for {transport}"
            )))
        }

        let transport = if let Some(command) = raw.command.clone() {
            throw_if_set("stdio", "url", raw.url.as_ref())?;
            throw_if_set(
                "stdio",
                "bearer_token_env_var",
                raw.bearer_token_env_var.as_ref(),
            )?;
            throw_if_set("stdio", "bearer_token", raw.bearer_token.as_ref())?;
            throw_if_set("stdio", "http_headers", raw.http_headers.as_ref())?;
            throw_if_set("stdio", "env_http_headers", raw.env_http_headers.as_ref())?;
            throw_if_set("stdio", "oauth_resource", raw.oauth_resource.as_ref())?;
            McpServerTransportConfig::Stdio {
                command,
                args: raw.args.clone().unwrap_or_default(),
                env: raw.env.clone(),
                env_vars: raw.env_vars.clone().unwrap_or_default(),
                cwd: raw.cwd.take(),
            }
        } else if let Some(url) = raw.url.clone() {
            throw_if_set("streamable_http", "args", raw.args.as_ref())?;
            throw_if_set("streamable_http", "env", raw.env.as_ref())?;
            throw_if_set("streamable_http", "env_vars", raw.env_vars.as_ref())?;
            throw_if_set("streamable_http", "cwd", raw.cwd.as_ref())?;
            throw_if_set("streamable_http", "bearer_token", raw.bearer_token.as_ref())?;
            McpServerTransportConfig::StreamableHttp {
                url,
                bearer_token_env_var: raw.bearer_token_env_var.clone(),
                http_headers: raw.http_headers.clone(),
                env_http_headers: raw.env_http_headers.take(),
            }
        } else {
            return Err(SerdeError::custom("invalid transport"));
        };

        Ok(Self {
            transport,
            enabled,
            required,
            disabled_reason: None,
            startup_timeout_sec,
            tool_timeout_sec,
            enabled_tools,
            disabled_tools,
            scopes,
            oauth_resource,
        })
    }
}

const fn default_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(untagged, rename_all = "snake_case")]
pub enum McpServerTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Option<HashMap<String, String>>,
        #[serde(default)]
        env_vars: Vec<String>,
        #[serde(default)]
        cwd: Option<PathBuf>,
    },
    StreamableHttp {
        url: String,
        #[serde(default)]
        bearer_token_env_var: Option<String>,
        #[serde(default)]
        http_headers: Option<HashMap<String, String>>,
        #[serde(default)]
        env_http_headers: Option<HashMap<String, String>>,
    },
}

mod option_duration_secs {
    use serde::Deserialize;
    use serde::Deserializer;
    use serde::Serializer;
    use std::time::Duration;

    pub fn serialize<S>(value: &Option<Duration>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(duration) => serializer.serialize_some(&duration.as_secs_f64()),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Duration>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let secs = Option::<f64>::deserialize(deserializer)?;
        secs.map(|value| Duration::try_from_secs_f64(value).map_err(serde::de::Error::custom))
            .transpose()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShellEnvironmentPolicy {
    #[default]
    Inherit,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppsConfigToml {
    #[serde(default, rename = "_default")]
    pub default: Option<AppConfig>,
    #[serde(default, flatten)]
    pub apps: HashMap<String, AppConfig>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub destructive_enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoriesConfig {
    pub no_memories_if_mcp_or_web_search: bool,
    pub generate_memories: bool,
    pub use_memories: bool,
    pub max_raw_memories_for_consolidation: usize,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::McpServerConfig;
    use super::McpServerTransportConfig;

    #[test]
    fn mcp_server_config_deserializes_streamable_http_shorthand() {
        let config: McpServerConfig = toml::from_str(
            r#"
url = "https://mcp.notion.com/mcp"
"#,
        )
        .expect("streamable http shorthand should deserialize");

        assert_eq!(
            config.transport,
            McpServerTransportConfig::StreamableHttp {
                url: "https://mcp.notion.com/mcp".to_string(),
                bearer_token_env_var: None,
                http_headers: None,
                env_http_headers: None,
            }
        );
        assert_eq!(config.enabled, true);
        assert_eq!(config.required, false);
    }
}
