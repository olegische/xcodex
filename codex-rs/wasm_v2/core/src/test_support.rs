use std::path::PathBuf;
use std::sync::Arc;

use crate::auth::AuthManager;
use crate::model_provider_info::ModelProviderInfo;
use crate::models_manager::manager::ModelsManager;

pub fn models_manager_with_provider(
    _codex_home: PathBuf,
    _auth_manager: Arc<AuthManager>,
    _provider: ModelProviderInfo,
) -> ModelsManager {
    ModelsManager::default()
}
