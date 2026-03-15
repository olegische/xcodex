use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use codex_execpolicy::Decision;
use codex_execpolicy::Evaluation;
use codex_execpolicy::Policy;
#[cfg(not(target_arch = "wasm32"))]
use codex_execpolicy::PolicyParser;
use codex_protocol::approvals::ExecPolicyAmendment;
use codex_protocol::protocol::AskForApproval;
use thiserror::Error;

use crate::config_loader::ConfigLayerStack;
#[cfg(not(target_arch = "wasm32"))]
use crate::config_loader::ConfigLayerStackOrdering;

#[derive(Debug)]
pub struct ExecPolicy(Policy);

#[derive(Debug, Default, Clone)]
pub struct ExecPolicyManager {
    current: Arc<ExecPolicy>,
}

#[derive(Debug, Error)]
pub enum ExecPolicyUpdateError {
    #[error("exec policy updates are not implemented in wasm_v2")]
    Unsupported,
}

impl ExecPolicyManager {
    pub async fn load(config_layer_stack: &ConfigLayerStack) -> Result<Self, anyhow::Error> {
        let policy = load_exec_policy(config_layer_stack).await?;
        Ok(Self {
            current: Arc::new(ExecPolicy(policy)),
        })
    }

    pub fn current(&self) -> Arc<ExecPolicy> {
        Arc::clone(&self.current)
    }

    pub async fn append_amendment_and_update(
        &self,
        _codex_home: &Path,
        _amendment: &ExecPolicyAmendment,
    ) -> Result<(), ExecPolicyUpdateError> {
        Err(ExecPolicyUpdateError::Unsupported)
    }

    pub async fn append_network_rule_and_update(
        &self,
        _codex_home: &Path,
        _host: &str,
        _protocol: String,
        _decision: String,
        _justification: Option<String>,
    ) -> Result<(), ExecPolicyUpdateError> {
        Err(ExecPolicyUpdateError::Unsupported)
    }

    pub fn supported(&self) -> bool {
        false
    }
}

impl ExecPolicy {
    pub fn approval_policy(&self) -> AskForApproval {
        AskForApproval::UnlessTrusted
    }

    pub fn check_multiple<'a, I, F>(&self, commands: I, fallback: &F) -> Evaluation
    where
        I: IntoIterator<Item = &'a Vec<String>>,
        F: Fn(&str) -> Decision,
    {
        self.0.check_multiple(commands, &|command| {
            fallback(command.first().map(String::as_str).unwrap_or_default())
        })
    }
}

impl std::ops::Deref for ExecPolicy {
    type Target = Policy;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Default for ExecPolicy {
    fn default() -> Self {
        Self(Policy::empty())
    }
}

const RULES_DIR_NAME: &str = "rules";
const RULE_EXTENSION: &str = "rules";

async fn load_exec_policy(config_stack: &ConfigLayerStack) -> Result<Policy, io::Error> {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = config_stack;
        return Ok(Policy::empty());
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let mut policy_paths = Vec::new();
        for layer in config_stack.get_layers(ConfigLayerStackOrdering::LowestPrecedenceFirst, false)
        {
            if let Some(config_folder) = layer.config_folder() {
                let policy_dir = config_folder
                    .join(RULES_DIR_NAME)
                    .map_err(io::Error::other)?;
                policy_paths.extend(collect_policy_files(policy_dir.as_ref()).await?);
            }
        }

        let mut parser = PolicyParser::new();
        for policy_path in &policy_paths {
            let contents = tokio::fs::read_to_string(policy_path).await?;
            let identifier = policy_path.to_string_lossy().to_string();
            parser
                .parse(&identifier, &contents)
                .map_err(io::Error::other)?;
        }
        Ok(parser.build())
    }
}

async fn collect_policy_files(policy_dir: &Path) -> Result<Vec<PathBuf>, io::Error> {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = policy_dir;
        return Ok(Vec::new());
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let mut dir = match tokio::fs::read_dir(policy_dir).await {
            Ok(dir) => dir,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err),
        };

        let mut policy_paths = Vec::new();
        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == RULE_EXTENSION) {
                policy_paths.push(path);
            }
        }
        policy_paths.sort();
        Ok(policy_paths)
    }
}
