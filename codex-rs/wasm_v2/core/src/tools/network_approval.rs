use std::sync::Arc;

use crate::compat::network::BlockedRequest;
use crate::compat::network::BlockedRequestObserver;
use crate::compat::network::NetworkDecision;
use crate::compat::network::NetworkPolicyDecider;
use crate::compat::network::NetworkPolicyRequest;
use async_trait::async_trait;

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
