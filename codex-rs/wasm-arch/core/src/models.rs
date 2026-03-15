use serde::Deserialize;
use serde::Serialize;

/// WASM-local truncation wire types.
///
/// Domain transcript/model item types should come from `codex_protocol::models`
/// so browser and native runtimes stay aligned.

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TruncationMode {
    Bytes,
    Tokens,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub struct TruncationPolicyConfig {
    pub mode: TruncationMode,
    pub limit: i64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "mode", content = "limit", rename_all = "snake_case")]
pub enum WireTruncationPolicy {
    Bytes(usize),
    Tokens(usize),
}
