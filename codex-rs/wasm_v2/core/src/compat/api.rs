#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_api::Provider;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_api::RealtimeAudioFrame;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_api::RealtimeEvent;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use codex_api::common::ResponseEvent;

#[cfg(target_arch = "wasm32")]
use codex_protocol::protocol::RateLimitSnapshot;
#[cfg(target_arch = "wasm32")]
use codex_protocol::protocol::TokenUsage;

#[cfg(target_arch = "wasm32")]
pub(crate) type RealtimeAudioFrame = codex_protocol::protocol::RealtimeAudioFrame;
#[cfg(target_arch = "wasm32")]
pub(crate) type RealtimeEvent = codex_protocol::protocol::RealtimeEvent;

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, Default)]
pub(crate) struct Provider;

#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub(crate) enum ResponseEvent {
    Created,
    OutputItemDone(codex_protocol::models::ResponseItem),
    OutputItemAdded(codex_protocol::models::ResponseItem),
    ServerModel(String),
    ServerReasoningIncluded(bool),
    Completed {
        response_id: String,
        token_usage: Option<TokenUsage>,
    },
    OutputTextDelta(String),
    ReasoningSummaryDelta {
        delta: String,
        summary_index: i64,
    },
    ReasoningContentDelta {
        delta: String,
        content_index: i64,
    },
    ReasoningSummaryPartAdded {
        summary_index: i64,
    },
    RateLimits(RateLimitSnapshot),
    ModelsEtag(String),
}
