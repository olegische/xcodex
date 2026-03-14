use std::sync::Arc;

use async_trait::async_trait;
use codex_network_proxy::BlockedRequest;
use codex_network_proxy::BlockedRequestObserver;
use codex_network_proxy::NetworkDecision;
use codex_network_proxy::NetworkPolicyDecider;
use codex_network_proxy::NetworkPolicyRequest;

#[derive(Clone, Debug, Default)]
pub struct NetworkApprovalService;

pub type NetworkApprovalContext = codex_protocol::approvals::NetworkApprovalContext;

#[derive(Default)]
struct NoopBlockedRequestObserver;

#[async_trait]
impl BlockedRequestObserver for NoopBlockedRequestObserver {
    async fn on_blocked_request(&self, _request: BlockedRequest) {}
}

#[derive(Default)]
struct NoopNetworkPolicyDecider;

#[async_trait]
impl NetworkPolicyDecider for NoopNetworkPolicyDecider {
    async fn decide(&self, _req: NetworkPolicyRequest) -> NetworkDecision {
        NetworkDecision::Allow
    }
}

pub fn build_blocked_request_observer<T>(
    _service: Arc<NetworkApprovalService>,
    _session: Arc<T>,
) -> Arc<dyn BlockedRequestObserver> {
    Arc::new(NoopBlockedRequestObserver)
}

pub fn build_network_policy_decider<T>(
    _service: Arc<NetworkApprovalService>,
    _session: Arc<T>,
) -> Arc<dyn NetworkPolicyDecider> {
    Arc::new(NoopNetworkPolicyDecider)
}
