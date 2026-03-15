#[cfg(target_arch = "wasm32")]
use async_trait::async_trait;

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::BlockedRequest;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::BlockedRequestObserver;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::NetworkDecision;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::NetworkPolicyDecider;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::NetworkPolicyRequest;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::NetworkProxy;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::NetworkProxyAuditMetadata;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_network_proxy::normalize_host;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default)]
pub(crate) struct NetworkProxy;

#[cfg(target_arch = "wasm32")]
impl NetworkProxy {
    pub(crate) fn http_addr(&self) -> String {
        String::new()
    }

    pub(crate) fn socks_addr(&self) -> String {
        String::new()
    }

    pub(crate) async fn add_allowed_domain(&self, _host: &str) -> anyhow::Result<()> {
        Ok(())
    }

    pub(crate) async fn add_denied_domain(&self, _host: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default)]
pub(crate) struct NetworkProxyAuditMetadata {
    pub(crate) conversation_id: Option<String>,
    pub(crate) app_version: Option<String>,
    pub(crate) user_account_id: Option<String>,
    pub(crate) auth_mode: Option<String>,
    pub(crate) originator: Option<String>,
    pub(crate) user_email: Option<String>,
    pub(crate) terminal_type: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) slug: Option<String>,
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug)]
pub(crate) struct BlockedRequest {
    pub(crate) host: String,
    pub(crate) reason: String,
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug)]
pub(crate) struct NetworkPolicyRequest {
    pub(crate) host: String,
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NetworkDecision {
    Allow,
    Deny { reason: String },
}

#[cfg(target_arch = "wasm32")]
#[async_trait]
pub(crate) trait BlockedRequestObserver: Send + Sync + 'static {
    async fn on_blocked_request(&self, _request: BlockedRequest);
}

#[cfg(target_arch = "wasm32")]
#[async_trait]
impl<T> BlockedRequestObserver for std::sync::Arc<T>
where
    T: BlockedRequestObserver + ?Sized,
{
    async fn on_blocked_request(&self, request: BlockedRequest) {
        (**self).on_blocked_request(request).await;
    }
}

#[cfg(target_arch = "wasm32")]
#[async_trait]
pub(crate) trait NetworkPolicyDecider: Send + Sync + 'static {
    async fn decide(&self, _req: NetworkPolicyRequest) -> NetworkDecision;
}

#[cfg(target_arch = "wasm32")]
#[async_trait]
impl<T> NetworkPolicyDecider for std::sync::Arc<T>
where
    T: NetworkPolicyDecider + ?Sized,
{
    async fn decide(&self, req: NetworkPolicyRequest) -> NetworkDecision {
        (**self).decide(req).await
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn normalize_host(host: &str) -> String {
    let trimmed = host.trim().trim_end_matches('.');
    if let Some(without_brackets) = trimmed
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        return without_brackets.to_ascii_lowercase();
    }

    match trimmed.rsplit_once(':') {
        Some((hostname, port)) if !hostname.contains(':') && port.parse::<u16>().is_ok() => {
            hostname.to_ascii_lowercase()
        }
        _ => trimmed.to_ascii_lowercase(),
    }
}
