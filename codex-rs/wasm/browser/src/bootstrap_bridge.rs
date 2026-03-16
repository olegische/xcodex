use std::path::PathBuf;
use std::sync::Arc;

use codex_wasm_v2_core::LoadUserConfigRequest;
use codex_wasm_v2_core::config::Config;
use tokio::sync::Mutex;
use wasm_bindgen::JsValue;

use crate::host::BrowserBootstrap;
use crate::host::JsHost;
use crate::state::RuntimeBootstrap;
use crate::state::RuntimeState;

pub(crate) async fn ensure_bootstrap_loaded(
    host: &JsHost,
    state: &Arc<Mutex<RuntimeState>>,
) -> Result<(), JsValue> {
    let already_loaded = {
        let state = state.lock().await;
        state.bootstrap.is_some()
    };
    if already_loaded {
        return Ok(());
    }

    let bootstrap = host.load_bootstrap().await?;
    let browser_fs = host.browser_fs();
    let discoverable_apps_provider = host.discoverable_apps_provider();
    let model_transport_host = host.model_transport_host();
    let config_storage_host = host.config_storage_host();
    let thread_storage_host = host.thread_storage_host();
    let config = build_bootstrap_config(&bootstrap, config_storage_host.as_ref()).await;
    let bootstrap = RuntimeBootstrap {
        auth: bootstrap.auth(),
        model_catalog: bootstrap.model_catalog.clone(),
        config,
        browser_fs,
        discoverable_apps_provider,
        model_transport_host,
        config_storage_host,
        thread_storage_host,
    };

    let app_server = {
        let mut state = state.lock().await;
        if state.bootstrap.is_none() {
            state.bootstrap = Some(bootstrap.clone());
        }
        Arc::clone(&state.app_server)
    };
    {
        let mut app_server = app_server.lock().await;
        app_server.set_runtime_bootstrap(bootstrap.clone());
        if let Some(model_catalog) = bootstrap.model_catalog.clone() {
            app_server.set_models(model_catalog.models);
        }
    }
    Ok(())
}

async fn build_bootstrap_config(
    bootstrap: &BrowserBootstrap,
    config_storage_host: &dyn codex_wasm_v2_core::ConfigStorageHost,
) -> Config {
    let mut config = Config {
        codex_home: PathBuf::from(bootstrap.codex_home.clone()),
        cwd: bootstrap
            .cwd
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(bootstrap.codex_home.clone())),
        model: bootstrap.model.clone(),
        model_provider_id: bootstrap
            .model_provider_id
            .clone()
            .unwrap_or_else(|| "openai".to_string()),
        model_provider: bootstrap
            .model_provider
            .clone()
            .unwrap_or_else(codex_wasm_v2_core::ModelProviderInfo::create_openai_provider),
        service_tier: bootstrap.service_tier.unwrap_or(None),
        model_reasoning_effort: bootstrap.reasoning_effort,
        model_reasoning_summary: bootstrap.reasoning_summary,
        personality: bootstrap.personality,
        base_instructions: bootstrap.base_instructions.clone(),
        developer_instructions: bootstrap.developer_instructions.clone(),
        user_instructions: bootstrap.user_instructions.clone(),
        ephemeral: bootstrap.ephemeral.unwrap_or(false),
        ..Config::default()
    };
    if let Ok(user_config) = config_storage_host
        .load_user_config(LoadUserConfigRequest {})
        .await
        && let Ok(toml_value) = toml::from_str::<toml::Value>(&user_config.content)
    {
        config.config_layer_stack = config
            .config_layer_stack
            .with_user_config(PathBuf::from(user_config.file_path), toml_value);
    }
    if let Some(approval_policy) = bootstrap.approval_policy {
        let _ = config
            .permissions
            .approval_policy
            .set(approval_policy.to_core());
    }
    if let Some(sandbox_policy) = bootstrap.sandbox_policy.clone() {
        let _ = config.permissions.sandbox_policy.set(sandbox_policy);
    }
    config
}
