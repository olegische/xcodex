//! Mirror-track browser core for Codex.
#![allow(dead_code, private_interfaces)]

pub mod agent;
pub mod analytics_client;
pub mod apps;
pub mod auth;
pub mod client;
pub mod client_common;
pub mod codex;
pub mod codex_thread;
pub mod commit_attribution;
pub mod compact;
pub mod compact_remote;
pub mod config;
pub mod config_loader;
pub mod connectors;
pub mod context_manager;
pub mod contextual_user_message;
pub mod custom_prompts;
pub mod default_client;
pub mod environment_context;
pub mod error;
pub mod event_mapping;
pub mod exec;
pub mod exec_policy;
pub mod features;
pub mod file_watcher;
pub mod function_tool;
pub mod git_info;
pub mod guardian;
pub mod instructions;
pub mod mcp;
pub mod mcp_connection_manager;
pub mod memories;
pub mod mention_syntax;
pub mod mentions;
pub mod message_history;
pub mod model_provider_info;
pub mod models_manager;
pub mod network_policy_decision;
pub mod parse_turn_item;
pub mod plugins;
pub mod project_doc;
pub mod realtime_conversation;
pub mod review_prompts;
pub mod rollout;
pub mod sandboxing;
pub mod shell;
pub mod shell_snapshot;
pub mod skills;
pub mod state;
pub mod state_db;
pub mod stream_events_utils;
pub mod tasks;
pub mod terminal;
pub mod test_support;
pub mod tools;
pub mod truncate;
pub mod turn_diff_tracker;
pub mod turn_metadata;
pub mod turn_timing;
pub mod unified_exec;
pub mod util;
pub mod windows_sandbox;

pub use auth::AuthManager;
pub use auth::CodexAuth;
pub use client_common::Prompt;
pub use mcp_connection_manager::SandboxState;
pub use model_provider_info::ModelProviderInfo;

pub fn ws_version_from_features(config: &config::Config) -> bool {
    config
        .features
        .enabled(features::Feature::EnableRequestCompression)
}

pub(crate) use codex_protocol::protocol;
pub(crate) use codex_shell_command::parse_command;
