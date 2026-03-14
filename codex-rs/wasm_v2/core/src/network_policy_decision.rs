use codex_protocol::approvals::NetworkPolicyAmendment;
use codex_protocol::approvals::NetworkPolicyRuleAction;

pub fn execpolicy_network_rule_amendment(
    amendment: &NetworkPolicyAmendment,
    _context: &codex_protocol::approvals::NetworkApprovalContext,
    host: &str,
) -> ExecPolicyNetworkRuleAmendment {
    ExecPolicyNetworkRuleAmendment {
        protocol: "https".to_string(),
        decision: match amendment.action {
            NetworkPolicyRuleAction::Allow => "allow".to_string(),
            NetworkPolicyRuleAction::Deny => "deny".to_string(),
        },
        justification: host.to_string(),
    }
}

pub struct ExecPolicyNetworkRuleAmendment {
    pub protocol: String,
    pub decision: String,
    pub justification: String,
}
