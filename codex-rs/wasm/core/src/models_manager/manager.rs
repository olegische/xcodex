use std::path::PathBuf;
use std::sync::Arc;

use codex_protocol::config_types::CollaborationModeMask;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ModelsResponse;
use tokio::sync::RwLock;

use crate::auth::AuthManager;
use crate::config::Config;
use crate::model_provider_info::ModelProviderInfo;
use crate::models_manager::collaboration_mode_presets::CollaborationModesConfig;
use crate::models_manager::collaboration_mode_presets::builtin_collaboration_mode_presets;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshStrategy {
    Online,
    Offline,
    OnlineIfUncached,
}

#[derive(Debug)]
pub struct ModelsManager {
    remote_models: RwLock<Vec<ModelInfo>>,
    collaboration_modes_config: CollaborationModesConfig,
    _auth_manager: Arc<AuthManager>,
    provider: ModelProviderInfo,
}

impl Default for ModelsManager {
    fn default() -> Self {
        Self::new(
            PathBuf::new(),
            Arc::new(AuthManager::new(
                PathBuf::new(),
                true,
                crate::auth::AuthCredentialsStoreMode::File,
            )),
            None,
            CollaborationModesConfig::default(),
        )
    }
}

impl ModelsManager {
    pub fn new(
        _codex_home: PathBuf,
        auth_manager: Arc<AuthManager>,
        model_catalog: Option<ModelsResponse>,
        collaboration_modes_config: CollaborationModesConfig,
    ) -> Self {
        Self {
            remote_models: RwLock::new(
                model_catalog
                    .map(|catalog| catalog.models)
                    .unwrap_or_default(),
            ),
            collaboration_modes_config,
            _auth_manager: auth_manager,
            provider: ModelProviderInfo::create_openai_provider(),
        }
    }

    pub async fn list_models(&self, _refresh_strategy: RefreshStrategy) -> Vec<ModelInfo> {
        self.remote_models.read().await.clone()
    }

    pub fn try_list_models(&self) -> anyhow::Result<Vec<ModelInfo>> {
        Ok(self
            .remote_models
            .try_read()
            .map(|models| models.clone())
            .unwrap_or_default())
    }

    pub fn list_collaboration_modes(&self) -> Vec<CollaborationModeMask> {
        builtin_collaboration_mode_presets(self.collaboration_modes_config)
    }

    pub async fn get_default_model(
        &self,
        model: &Option<String>,
        _refresh_strategy: RefreshStrategy,
    ) -> String {
        if let Some(model) = model {
            return model.clone();
        }
        self.remote_models
            .read()
            .await
            .first()
            .map(|model| model.slug.clone())
            .unwrap_or_else(|| "gpt-4.1".to_string())
    }

    pub async fn get_model_info(&self, model: &str, _config: &Config) -> ModelInfo {
        self.remote_models
            .read()
            .await
            .iter()
            .find(|candidate| candidate.slug == model)
            .cloned()
            .unwrap_or_else(|| crate::models_manager::model_info::model_info_from_slug(model))
    }

    pub(crate) async fn refresh_if_new_etag(&self, _etag: String) {}

    pub fn construct_model_info_offline_for_tests(model: &str, config: &Config) -> ModelInfo {
        crate::models_manager::model_info::with_config_overrides(
            crate::models_manager::model_info::model_info_from_slug(model),
            config,
        )
    }

    pub fn get_model_offline_for_tests(model: Option<&str>) -> String {
        model.unwrap_or("gpt-5").to_string()
    }
}
