use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;

use codex_app_server_protocol::AuthMode as ApiAuthMode;

pub const OPENAI_API_KEY_ENV_VAR: &str = "OPENAI_API_KEY";
pub const CODEX_API_KEY_ENV_VAR: &str = "CODEX_API_KEY";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMode {
    ApiKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthCredentialsStoreMode {
    File,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiKeyAuth {
    api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexAuth {
    ApiKey(ApiKeyAuth),
}

impl CodexAuth {
    pub fn from_api_key(api_key: &str) -> Self {
        Self::ApiKey(ApiKeyAuth {
            api_key: api_key.to_owned(),
        })
    }

    pub fn auth_mode(&self) -> AuthMode {
        match self {
            Self::ApiKey(_) => AuthMode::ApiKey,
        }
    }

    pub fn api_auth_mode(&self) -> ApiAuthMode {
        match self {
            Self::ApiKey(_) => ApiAuthMode::ApiKey,
        }
    }

    pub fn is_api_key_auth(&self) -> bool {
        true
    }

    pub fn is_chatgpt_auth(&self) -> bool {
        false
    }

    pub fn is_external_chatgpt_tokens(&self) -> bool {
        false
    }

    pub fn api_key(&self) -> Option<&str> {
        match self {
            Self::ApiKey(auth) => Some(auth.api_key.as_str()),
        }
    }

    pub fn get_token(&self) -> Result<String, std::io::Error> {
        match self {
            Self::ApiKey(auth) => Ok(auth.api_key.clone()),
        }
    }

    pub fn get_account_id(&self) -> Option<String> {
        None
    }

    pub fn get_account_email(&self) -> Option<String> {
        None
    }
}

pub fn read_openai_api_key_from_env() -> Option<String> {
    env::var(OPENAI_API_KEY_ENV_VAR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn read_codex_api_key_from_env() -> Option<String> {
    env::var(CODEX_API_KEY_ENV_VAR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[derive(Debug)]
pub struct AuthManager {
    _codex_home: PathBuf,
    auth: RwLock<Option<CodexAuth>>,
}

impl AuthManager {
    pub fn new(
        codex_home: PathBuf,
        enable_codex_api_key_env: bool,
        _auth_credentials_store_mode: AuthCredentialsStoreMode,
    ) -> Self {
        let auth = if enable_codex_api_key_env {
            read_codex_api_key_from_env().or_else(read_openai_api_key_from_env)
        } else {
            read_openai_api_key_from_env()
        }
        .map(|api_key| CodexAuth::from_api_key(&api_key));

        Self {
            _codex_home: codex_home,
            auth: RwLock::new(auth),
        }
    }

    pub(crate) fn from_auth_for_testing(auth: CodexAuth) -> Arc<Self> {
        Arc::new(Self {
            _codex_home: PathBuf::from("non-existent"),
            auth: RwLock::new(Some(auth)),
        })
    }

    pub(crate) fn from_auth_for_testing_with_home(
        auth: CodexAuth,
        codex_home: PathBuf,
    ) -> Arc<Self> {
        Arc::new(Self {
            _codex_home: codex_home,
            auth: RwLock::new(Some(auth)),
        })
    }

    pub fn auth_cached(&self) -> Option<CodexAuth> {
        self.auth.read().ok().and_then(|auth| auth.clone())
    }

    pub fn from_auth(codex_home: PathBuf, auth: Option<CodexAuth>) -> Arc<Self> {
        Arc::new(Self {
            _codex_home: codex_home,
            auth: RwLock::new(auth),
        })
    }

    pub async fn auth(&self) -> Option<CodexAuth> {
        self.auth_cached()
    }

    pub fn reload(&self) -> bool {
        false
    }

    pub fn auth_mode(&self) -> Option<ApiAuthMode> {
        self.auth_cached().as_ref().map(CodexAuth::api_auth_mode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn api_key_auth_reports_expected_modes() {
        let auth = CodexAuth::from_api_key("test-key");
        assert_eq!(auth.auth_mode(), AuthMode::ApiKey);
        assert_eq!(auth.api_auth_mode(), ApiAuthMode::ApiKey);
        assert_eq!(auth.api_key(), Some("test-key"));
    }
}
