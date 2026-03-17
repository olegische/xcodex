use codex_app_server_protocol::ClientRequest;
use codex_app_server_protocol::JSONRPCErrorError;

use crate::LoadedThreadStartResult;
use crate::MessageProcessor;
use crate::RequestTarget;
use crate::RuntimeBootstrap;
use crate::request_target;
use crate::start_loaded_thread_runtime;

pub enum RootRequestResult {
    Response(serde_json::Value),
    ThreadStarted(Box<LoadedThreadStartResult>),
}

pub async fn process_root_or_thread_start_request(
    processor: &mut MessageProcessor,
    request: ClientRequest,
    runtime_bootstrap: Option<&RuntimeBootstrap>,
) -> Result<RootRequestResult, JSONRPCErrorError> {
    match request_target(&request) {
        Some(RequestTarget::Root) => {
            if matches!(request, ClientRequest::AppsList { .. }) {
                let bootstrap = runtime_bootstrap
                    .ok_or_else(|| internal_error("app/list requires runtime bootstrap"))?;
                let apps = bootstrap
                    .discoverable_apps_provider
                    .list_discoverable_apps()
                    .await
                    .map_err(internal_error)?;
                processor.set_apps(apps);
            }

            processor
                .process_initialized_request(request)
                .await
                .map(RootRequestResult::Response)
        }
        Some(RequestTarget::ThreadStart) => {
            let bootstrap = runtime_bootstrap
                .cloned()
                .ok_or_else(|| internal_error("thread/start requires runtime bootstrap"))?;
            let ClientRequest::ThreadStart { request_id, params } = request else {
                unreachable!("request target classified as thread start");
            };
            start_loaded_thread_runtime(processor, request_id, params, bootstrap)
                .await
                .map(Box::new)
                .map(RootRequestResult::ThreadStarted)
        }
        _ => Err(internal_error("root or thread/start request expected")),
    }
}

fn internal_error(message: impl std::fmt::Display) -> JSONRPCErrorError {
    JSONRPCErrorError {
        code: -32603,
        data: None,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use codex_app_server_protocol::AppsListParams;
    use codex_app_server_protocol::ClientRequest;
    use codex_app_server_protocol::ModelListParams;
    use codex_app_server_protocol::RequestId;
    use codex_wasm_core::UnavailableConfigStorageHost;
    use codex_wasm_core::UnavailableDiscoverableAppsProvider;
    use codex_wasm_core::UnavailableHostFs;
    use codex_wasm_core::UnavailableMcpOauthHost;
    use codex_wasm_core::UnavailableModelTransportHost;
    use codex_wasm_core::UnavailableThreadStorageHost;
    use codex_wasm_core::config::Config;

    use super::RootRequestResult;
    use super::process_root_or_thread_start_request;
    use crate::ApiVersion;
    use crate::MessageProcessor;
    use crate::MessageProcessorArgs;
    use crate::RuntimeBootstrap;

    #[tokio::test(flavor = "current_thread")]
    async fn apps_list_uses_runtime_bootstrap_provider() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        processor.set_apps(vec![codex_app_server_protocol::AppInfo {
            id: "stale-app".to_string(),
            name: "Stale App".to_string(),
            description: None,
            logo_url: None,
            logo_url_dark: None,
            distribution_channel: None,
            branding: None,
            app_metadata: None,
            labels: None,
            install_url: None,
            is_accessible: true,
            is_enabled: true,
            plugin_display_names: Vec::new(),
        }]);
        let bootstrap = RuntimeBootstrap {
            config: Config::default(),
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        };

        let response = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::AppsList {
                request_id: RequestId::Integer(1),
                params: AppsListParams {
                    cursor: None,
                    limit: None,
                    thread_id: None,
                    force_refetch: false,
                },
            },
            Some(&bootstrap),
        )
        .await
        .expect("app/list succeeds");
        let RootRequestResult::Response(response) = response else {
            panic!("expected root response");
        };

        assert_eq!(
            response.get("data").and_then(serde_json::Value::as_array),
            Some(&Vec::new())
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn apps_list_requires_runtime_bootstrap() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });

        let error = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::AppsList {
                request_id: RequestId::Integer(1),
                params: AppsListParams {
                    cursor: None,
                    limit: None,
                    thread_id: None,
                    force_refetch: false,
                },
            },
            None,
        )
        .await;
        let Err(error) = error else {
            panic!("app/list without bootstrap fails");
        };

        assert_eq!(
            error.message,
            "app/list requires runtime bootstrap".to_string()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn model_list_does_not_require_runtime_bootstrap() {
        let mut processor = MessageProcessor::new(MessageProcessorArgs {
            api_version: ApiVersion::V2,
            config_warnings: Vec::new(),
        });
        let bootstrap = RuntimeBootstrap {
            config: Config::default(),
            auth: None,
            model_catalog: None,
            browser_fs: Arc::new(UnavailableHostFs),
            discoverable_apps_provider: Arc::new(UnavailableDiscoverableAppsProvider),
            model_transport_host: Arc::new(UnavailableModelTransportHost),
            config_storage_host: Arc::new(UnavailableConfigStorageHost),
            thread_storage_host: Arc::new(UnavailableThreadStorageHost),
            mcp_oauth_host: Arc::new(UnavailableMcpOauthHost),
        };
        processor.set_runtime_bootstrap(bootstrap);

        let response = process_root_or_thread_start_request(
            &mut processor,
            ClientRequest::ModelList {
                request_id: RequestId::Integer(1),
                params: ModelListParams {
                    cursor: None,
                    limit: None,
                    include_hidden: None,
                },
            },
            None,
        )
        .await
        .expect("model/list succeeds");
        let RootRequestResult::Response(response) = response else {
            panic!("expected root response");
        };

        assert_eq!(
            response.get("data").and_then(serde_json::Value::as_array),
            Some(&Vec::new())
        );
    }
}
