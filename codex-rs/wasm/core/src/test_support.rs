use std::path::PathBuf;
use std::sync::Arc;

use crate::auth::AuthManager;
use crate::config::Config;
use crate::model_provider_info::ModelProviderInfo;
use crate::models_manager::collaboration_mode_presets::CollaborationModesConfig;
use crate::models_manager::manager::ModelsManager;

pub fn models_manager_with_provider(
    codex_home: PathBuf,
    auth_manager: Arc<AuthManager>,
    _provider: ModelProviderInfo,
) -> ModelsManager {
    ModelsManager::new(
        codex_home,
        auth_manager,
        None,
        CollaborationModesConfig::from_features(&Config::default().features),
    )
}
