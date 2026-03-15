//! Mirror-track browser core for Codex.
#![allow(dead_code, private_interfaces)]

mod agent;
mod analytics_client;
pub mod apps;
pub mod auth;
mod client;
mod client_common;
pub mod codex;
mod codex_thread;
mod commit_attribution;
pub mod compact;
pub mod compact_remote;
mod compat;
pub mod config;
pub mod config_loader;
pub mod connectors;
mod context_manager;
mod contextual_user_message;
pub mod custom_prompts;
pub mod default_client;
mod environment_context;
pub mod error;
mod event_mapping;
pub mod exec;
pub mod exec_policy;
pub mod features;
mod file_watcher;
mod function_tool;
pub mod git_info;
mod guardian;
pub mod instructions;
pub mod mcp;
mod mcp_connection_manager;
pub mod memories;
pub mod mention_syntax;
mod mentions;
mod message_history;
mod model_provider_info;
pub mod models_manager;
mod network_policy_decision;
mod parse_turn_item;
pub mod plugins;
pub mod project_doc;
pub mod realtime_conversation;
mod review_format;
pub mod review_prompts;
mod rollout;
pub mod sandboxing;
pub mod shell;
pub mod shell_snapshot;
pub mod skills;
mod state;
pub mod state_db;
mod stream_events_utils;
mod tasks;
pub mod terminal;
pub mod test_support;
mod tools;
pub mod truncate;
pub mod turn_diff_tracker;
mod turn_metadata;
mod turn_timing;
mod unified_exec;
pub mod util;
pub mod windows_sandbox;

pub use auth::AuthManager;
pub use auth::CodexAuth;
pub use client_common::Prompt;
pub use codex::BrowserCodexSpawnArgs;
pub use codex::spawn_browser_codex;
pub use connectors::DiscoverableAppsProvider;
pub use connectors::UnavailableDiscoverableAppsProvider;
pub use mcp_connection_manager::SandboxState;
pub use model_provider_info::ModelProviderInfo;
pub use tools::ToolRouter;
pub use tools::browser_host::ApplyPatchRequest;
pub use tools::browser_host::ApplyPatchResponse;
pub use tools::browser_host::HostError;
pub use tools::browser_host::HostErrorCode;
pub use tools::browser_host::HostFileEntry;
pub use tools::browser_host::HostFs;
pub use tools::browser_host::HostResult;
pub use tools::browser_host::ListDirRequest;
pub use tools::browser_host::ListDirResponse;
pub use tools::browser_host::ReadFileRequest;
pub use tools::browser_host::ReadFileResponse;
pub use tools::browser_host::SearchMatch;
pub use tools::browser_host::SearchRequest;
pub use tools::browser_host::SearchResponse;
pub use tools::browser_host::UnavailableHostFs;
pub use tools::format_exec_output_str;

pub fn ws_version_from_features(config: &config::Config) -> bool {
    config
        .features
        .enabled(features::Feature::EnableRequestCompression)
}

pub(crate) use codex_protocol::protocol;
