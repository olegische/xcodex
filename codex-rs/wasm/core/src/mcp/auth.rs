use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use codex_protocol::protocol::McpAuthStatus;
use futures::future::join_all;
use tracing::warn;

use crate::McpOauthHost;
use crate::ResolveMcpOauthRedirectUriRequest;
use crate::WaitForMcpOauthCallbackRequest;
use crate::compat::rmcp::OAuthCredentialsStoreMode;
use crate::compat::rmcp::determine_streamable_http_auth_status;
use crate::compat::rmcp::supports_oauth_login;
use crate::config::types::McpServerConfig;
use crate::config::types::McpServerTransportConfig;

pub struct BrowserOauthLoginHandle {
    authorization_url: String,
    completion: tokio::sync::oneshot::Receiver<anyhow::Result<()>>,
}

impl BrowserOauthLoginHandle {
    pub fn authorization_url(&self) -> &str {
        &self.authorization_url
    }

    pub async fn wait(self) -> anyhow::Result<()> {
        self.completion
            .await
            .map_err(|error| anyhow::anyhow!("browser MCP OAuth task was cancelled: {error}"))?
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn perform_browser_oauth_login_return_url(
    mcp_oauth_host: Arc<dyn McpOauthHost>,
    server_name: &str,
    server_url: &str,
    scopes: &[String],
    oauth_resource: Option<&str>,
    timeout_secs: Option<i64>,
) -> anyhow::Result<BrowserOauthLoginHandle> {
    use rmcp::transport::auth::OAuthState;

    let redirect_uri = mcp_oauth_host
        .resolve_mcp_oauth_redirect_uri(ResolveMcpOauthRedirectUriRequest {
            server_name: server_name.to_string(),
        })
        .await
        .map_err(host_error)?;
    let mut oauth_state = OAuthState::new(server_url, None).await?;
    let scope_refs: Vec<&str> = scopes.iter().map(String::as_str).collect();
    oauth_state
        .start_authorization(&scope_refs, &redirect_uri.redirect_uri, Some("Codex"))
        .await?;
    let authorization_url = append_query_param(
        &oauth_state.get_authorization_url().await?,
        "resource",
        oauth_resource,
    );

    let (tx, rx) = tokio::sync::oneshot::channel();
    let authorization_url_for_task = authorization_url.clone();
    let server_name_for_task = server_name.to_string();
    tokio::spawn(async move {
        let result = async {
            let callback = mcp_oauth_host
                .wait_for_mcp_oauth_callback(WaitForMcpOauthCallbackRequest {
                    server_name: server_name_for_task,
                    authorization_url: authorization_url_for_task,
                    timeout_secs,
                })
                .await
                .map_err(host_error)?;
            oauth_state
                .handle_callback(&callback.code, &callback.state)
                .await?;
            let (_, credentials) = oauth_state.get_credentials().await?;
            if credentials.is_none() {
                anyhow::bail!("OAuth provider did not return credentials");
            }
            Ok(())
        }
        .await;

        let _ = tx.send(result);
    });

    Ok(BrowserOauthLoginHandle {
        authorization_url,
        completion: rx,
    })
}

#[derive(Debug, Clone)]
pub struct McpOAuthLoginConfig {
    pub url: String,
    pub http_headers: Option<HashMap<String, String>>,
    pub env_http_headers: Option<HashMap<String, String>>,
}

#[derive(Debug)]
pub enum McpOAuthLoginSupport {
    Supported(McpOAuthLoginConfig),
    Unsupported,
    Unknown(anyhow::Error),
}

pub async fn oauth_login_support(transport: &McpServerTransportConfig) -> McpOAuthLoginSupport {
    let McpServerTransportConfig::StreamableHttp {
        url,
        bearer_token_env_var,
        http_headers,
        env_http_headers,
    } = transport
    else {
        return McpOAuthLoginSupport::Unsupported;
    };

    if bearer_token_env_var.is_some() {
        return McpOAuthLoginSupport::Unsupported;
    }

    match supports_oauth_login(url).await {
        Ok(true) => McpOAuthLoginSupport::Supported(McpOAuthLoginConfig {
            url: url.clone(),
            http_headers: http_headers.clone(),
            env_http_headers: env_http_headers.clone(),
        }),
        Ok(false) => McpOAuthLoginSupport::Unsupported,
        Err(err) => McpOAuthLoginSupport::Unknown(err),
    }
}

#[derive(Debug, Clone)]
pub struct McpAuthStatusEntry {
    pub config: McpServerConfig,
    pub auth_status: McpAuthStatus,
}

pub async fn compute_auth_statuses<'a, I>(
    servers: I,
    store_mode: OAuthCredentialsStoreMode,
) -> HashMap<String, McpAuthStatusEntry>
where
    I: IntoIterator<Item = (&'a String, &'a McpServerConfig)>,
{
    let futures = servers.into_iter().map(|(name, config)| {
        let name = name.clone();
        let config = config.clone();
        async move {
            let auth_status = match compute_auth_status(&name, &config, store_mode).await {
                Ok(status) => status,
                Err(error) => {
                    warn!("failed to determine auth status for MCP server `{name}`: {error:?}");
                    McpAuthStatus::Unsupported
                }
            };
            let entry = McpAuthStatusEntry {
                config,
                auth_status,
            };
            (name, entry)
        }
    });

    join_all(futures).await.into_iter().collect()
}

async fn compute_auth_status(
    server_name: &str,
    config: &McpServerConfig,
    store_mode: OAuthCredentialsStoreMode,
) -> Result<McpAuthStatus> {
    match &config.transport {
        McpServerTransportConfig::Stdio { .. } => Ok(McpAuthStatus::Unsupported),
        McpServerTransportConfig::StreamableHttp {
            url,
            bearer_token_env_var,
            http_headers,
            env_http_headers,
        } => {
            determine_streamable_http_auth_status(
                server_name,
                url,
                bearer_token_env_var.as_deref(),
                http_headers.clone(),
                env_http_headers.clone(),
                store_mode,
            )
            .await
        }
    }
}

fn host_error(error: crate::HostError) -> anyhow::Error {
    anyhow::anyhow!("browser MCP OAuth host error: {}", error.message)
}

fn append_query_param(url: &str, key: &str, value: Option<&str>) -> String {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return url.to_string();
    };
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}{key}={value}")
}
