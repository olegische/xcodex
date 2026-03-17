use codex_app_server_protocol::ClientRequest;

pub enum RequestTarget {
    Root,
    ThreadStart,
    LoadedThread {
        thread_id: String,
        updates_thread_state: bool,
    },
}

pub fn request_target(request: &ClientRequest) -> Option<RequestTarget> {
    match request {
        ClientRequest::ThreadStart { .. } => Some(RequestTarget::ThreadStart),
        ClientRequest::ModelList { .. }
        | ClientRequest::AppsList { .. }
        | ClientRequest::ConfigRead { .. }
        | ClientRequest::ConfigValueWrite { .. }
        | ClientRequest::ConfigBatchWrite { .. }
        | ClientRequest::McpServerStatusList { .. }
        | ClientRequest::McpServerRefresh { .. }
        | ClientRequest::McpServerOauthLogin { .. }
        | ClientRequest::ConfigRequirementsRead { .. }
        | ClientRequest::ThreadResume { .. }
        | ClientRequest::ThreadRollback { .. }
        | ClientRequest::ThreadArchive { .. }
        | ClientRequest::ThreadUnarchive { .. }
        | ClientRequest::ThreadSetName { .. }
        | ClientRequest::SkillsList { .. }
        | ClientRequest::SkillsConfigWrite { .. } => Some(RequestTarget::Root),
        ClientRequest::ThreadRead { params, .. } => Some(RequestTarget::LoadedThread {
            thread_id: params.thread_id.clone(),
            updates_thread_state: false,
        }),
        ClientRequest::TurnStart { params, .. } => Some(RequestTarget::LoadedThread {
            thread_id: params.thread_id.clone(),
            updates_thread_state: true,
        }),
        ClientRequest::TurnSteer { params, .. } => Some(RequestTarget::LoadedThread {
            thread_id: params.thread_id.clone(),
            updates_thread_state: false,
        }),
        ClientRequest::TurnInterrupt { params, .. } => Some(RequestTarget::LoadedThread {
            thread_id: params.thread_id.clone(),
            updates_thread_state: true,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use codex_app_server_protocol::ClientRequest;
    use codex_app_server_protocol::ListMcpServerStatusParams;
    use codex_app_server_protocol::McpServerOauthLoginParams;
    use codex_app_server_protocol::RequestId;
    use codex_app_server_protocol::SkillsListParams;
    use codex_app_server_protocol::ThreadArchiveParams;
    use codex_app_server_protocol::ThreadReadParams;
    use codex_app_server_protocol::ThreadResumeParams;
    use codex_app_server_protocol::ThreadRollbackParams;
    use codex_app_server_protocol::ThreadSetNameParams;
    use codex_app_server_protocol::TurnInterruptParams;

    use super::RequestTarget;
    use super::request_target;

    #[test]
    fn request_target_classifies_loaded_thread_requests() {
        let read = ClientRequest::ThreadRead {
            request_id: RequestId::Integer(1),
            params: ThreadReadParams {
                thread_id: "thread-1".to_string(),
                include_turns: false,
            },
        };
        let interrupt = ClientRequest::TurnInterrupt {
            request_id: RequestId::Integer(2),
            params: TurnInterruptParams {
                thread_id: "thread-2".to_string(),
                turn_id: "turn-2".to_string(),
            },
        };
        let skills_list = ClientRequest::SkillsList {
            request_id: RequestId::Integer(3),
            params: SkillsListParams {
                cwds: Vec::new(),
                force_reload: false,
                per_cwd_extra_user_roots: None,
            },
        };
        let archive = ClientRequest::ThreadArchive {
            request_id: RequestId::Integer(4),
            params: ThreadArchiveParams {
                thread_id: "thread-3".to_string(),
            },
        };
        let set_name = ClientRequest::ThreadSetName {
            request_id: RequestId::Integer(5),
            params: ThreadSetNameParams {
                thread_id: "thread-4".to_string(),
                name: "Renamed".to_string(),
            },
        };
        let resume = ClientRequest::ThreadResume {
            request_id: RequestId::Integer(6),
            params: ThreadResumeParams {
                thread_id: "thread-5".to_string(),
                history: None,
                path: None,
                model: None,
                model_provider: None,
                service_tier: None,
                cwd: None,
                approval_policy: None,
                sandbox: None,
                config: None,
                base_instructions: None,
                developer_instructions: None,
                personality: None,
                persist_extended_history: false,
            },
        };
        let rollback = ClientRequest::ThreadRollback {
            request_id: RequestId::Integer(7),
            params: ThreadRollbackParams {
                thread_id: "thread-6".to_string(),
                num_turns: 1,
            },
        };
        let mcp_status = ClientRequest::McpServerStatusList {
            request_id: RequestId::Integer(8),
            params: ListMcpServerStatusParams {
                cursor: None,
                limit: None,
            },
        };
        let mcp_refresh = ClientRequest::McpServerRefresh {
            request_id: RequestId::Integer(9),
            params: None,
        };
        let mcp_login = ClientRequest::McpServerOauthLogin {
            request_id: RequestId::Integer(10),
            params: McpServerOauthLoginParams {
                name: "remote".to_string(),
                scopes: None,
                timeout_secs: None,
            },
        };

        assert!(matches!(
            request_target(&read),
            Some(RequestTarget::LoadedThread {
                thread_id,
                updates_thread_state: false,
            }) if thread_id == "thread-1"
        ));
        assert!(matches!(
            request_target(&interrupt),
            Some(RequestTarget::LoadedThread {
                thread_id,
                updates_thread_state: true,
            }) if thread_id == "thread-2"
        ));
        assert!(matches!(
            request_target(&skills_list),
            Some(RequestTarget::Root)
        ));
        assert!(matches!(
            request_target(&archive),
            Some(RequestTarget::Root)
        ));
        assert!(matches!(
            request_target(&set_name),
            Some(RequestTarget::Root)
        ));
        assert!(matches!(request_target(&resume), Some(RequestTarget::Root)));
        assert!(matches!(
            request_target(&rollback),
            Some(RequestTarget::Root)
        ));
        assert!(matches!(
            request_target(&mcp_status),
            Some(RequestTarget::Root)
        ));
        assert!(matches!(
            request_target(&mcp_refresh),
            Some(RequestTarget::Root)
        ));
        assert!(matches!(
            request_target(&mcp_login),
            Some(RequestTarget::Root)
        ));
    }
}
