use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use codex_protocol::config_types::ReasoningSummary as ReasoningSummaryConfig;
use codex_protocol::config_types::ServiceTier;
use codex_protocol::config_types::Verbosity as VerbosityConfig;
use codex_protocol::models::ResponseItem;
use codex_protocol::openai_models::ModelInfo;
use codex_protocol::openai_models::ReasoningEffort as ReasoningEffortConfig;
use codex_protocol::protocol::SessionSource;
use http::HeaderMap;
use http::HeaderValue;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc;
use tracing::warn;

use crate::AuthManager;
#[cfg(target_arch = "wasm32")]
use crate::BrowserModelDeltaPayload;
#[cfg(target_arch = "wasm32")]
use crate::BrowserModelEvent;
#[cfg(target_arch = "wasm32")]
use crate::BrowserModelRequest;
#[cfg(target_arch = "wasm32")]
use crate::BrowserTransportOptions;
use crate::ModelTransportHost;
use crate::client_common::Prompt;
use crate::client_common::ResponseStream;
use crate::client_common::tools::create_tools_json_for_responses_api;
#[cfg(target_arch = "wasm32")]
use crate::compat::api::ResponseEvent;
use crate::compat::otel::SessionTelemetry;
#[cfg(target_arch = "wasm32")]
use crate::compat::task::spawn_detached;
#[cfg(target_arch = "wasm32")]
use crate::error::CodexErr;
use crate::error::Result;
use crate::model_provider_info::ModelProviderInfo;

struct ModelClientState {
    _auth_manager: Option<Arc<AuthManager>>,
    conversation_id: codex_protocol::ThreadId,
    provider: ModelProviderInfo,
    session_source: SessionSource,
    model_verbosity: Option<VerbosityConfig>,
    responses_websocket_enabled_by_feature: bool,
    enable_request_compression: bool,
    include_timing_metrics: bool,
    beta_features_header: Option<String>,
    disable_websockets: AtomicBool,
    model_transport_host: Arc<dyn ModelTransportHost>,
}

#[derive(Clone)]
pub struct ModelClient {
    state: Arc<ModelClientState>,
}

pub struct ModelClientSession {
    client: ModelClient,
    turn_state: Arc<OnceLock<String>>,
}

pub const OPENAI_BETA_HEADER: &str = "OpenAI-Beta";
pub const X_CODEX_TURN_STATE_HEADER: &str = "x-codex-turn-state";
pub const X_CODEX_TURN_METADATA_HEADER: &str = "x-codex-turn-metadata";
pub const X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER: &str =
    "x-responsesapi-include-timing-metrics";

impl ModelClient {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        auth_manager: Option<Arc<AuthManager>>,
        conversation_id: codex_protocol::ThreadId,
        provider: ModelProviderInfo,
        session_source: SessionSource,
        model_verbosity: Option<VerbosityConfig>,
        responses_websockets_enabled_by_feature: bool,
        enable_request_compression: bool,
        include_timing_metrics: bool,
        beta_features_header: Option<String>,
        model_transport_host: Arc<dyn ModelTransportHost>,
    ) -> Self {
        Self {
            state: Arc::new(ModelClientState {
                _auth_manager: auth_manager,
                conversation_id,
                provider,
                session_source,
                model_verbosity,
                responses_websocket_enabled_by_feature: responses_websockets_enabled_by_feature,
                enable_request_compression,
                include_timing_metrics,
                beta_features_header,
                disable_websockets: AtomicBool::new(false),
                model_transport_host,
            }),
        }
    }

    pub fn new_session(&self) -> ModelClientSession {
        ModelClientSession {
            client: self.clone(),
            turn_state: Arc::new(OnceLock::new()),
        }
    }

    pub async fn compact_conversation_history(
        &self,
        prompt: &Prompt,
        _model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
    ) -> Result<Vec<ResponseItem>> {
        Ok(prompt.input.clone())
    }

    pub fn responses_websocket_enabled(&self, model_info: &ModelInfo) -> bool {
        self.state.responses_websocket_enabled_by_feature
            && self.state.provider.supports_websockets
            && model_info.prefer_websockets
    }
}

impl ModelClientSession {
    #[allow(clippy::too_many_arguments)]
    pub async fn prewarm_websocket(
        &mut self,
        _prompt: &Prompt,
        _model_info: &ModelInfo,
        _session_telemetry: &SessionTelemetry,
        _effort: Option<ReasoningEffortConfig>,
        _summary: ReasoningSummaryConfig,
        _service_tier: Option<ServiceTier>,
        _turn_metadata_header: Option<&str>,
    ) -> Result<()> {
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn stream(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<ServiceTier>,
        turn_metadata_header: Option<&str>,
    ) -> Result<ResponseStream> {
        #[cfg(target_arch = "wasm32")]
        {
            if self.client.responses_websocket_enabled(model_info) {
                self.try_switch_fallback_transport(session_telemetry, model_info);
            }
            return self
                .stream_browser_host(
                    prompt,
                    model_info,
                    effort,
                    summary,
                    service_tier,
                    turn_metadata_header,
                )
                .await;
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (
                prompt,
                model_info,
                session_telemetry,
                effort,
                summary,
                service_tier,
                turn_metadata_header,
            );
            let (_tx, rx) = mpsc::channel(4);
            Ok(ResponseStream { rx_event: rx })
        }
    }

    pub(crate) fn try_switch_fallback_transport(
        &mut self,
        _session_telemetry: &SessionTelemetry,
        model_info: &ModelInfo,
    ) -> bool {
        let websocket_enabled = self.client.responses_websocket_enabled(model_info);
        websocket_enabled
            && !self
                .client
                .state
                .disable_websockets
                .swap(true, Ordering::Relaxed)
    }

    fn build_responses_request(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<ServiceTier>,
    ) -> Result<Value> {
        let reasoning = self.build_reasoning(model_info, effort, summary);
        let verbosity = self.resolve_verbosity(model_info);
        let text = build_text_controls(verbosity, &prompt.output_schema);
        let tools = serde_json::to_value(create_tools_json_for_responses_api(&prompt.tools)?)?;

        let mut request = serde_json::Map::new();
        request.insert("model".to_string(), Value::String(model_info.slug.clone()));
        request.insert(
            "instructions".to_string(),
            Value::String(prompt.base_instructions.text.clone()),
        );
        request.insert(
            "input".to_string(),
            serde_json::to_value(prompt.get_formatted_input())?,
        );
        request.insert("tools".to_string(), tools);
        request.insert("tool_choice".to_string(), Value::String("auto".to_string()));
        request.insert(
            "parallel_tool_calls".to_string(),
            Value::Bool(prompt.parallel_tool_calls),
        );
        request.insert("stream".to_string(), Value::Bool(true));
        request.insert(
            "prompt_cache_key".to_string(),
            Value::String(self.client.state.conversation_id.to_string()),
        );
        request.insert("store".to_string(), Value::Bool(false));

        if let Some(reasoning) = reasoning {
            request.insert("reasoning".to_string(), reasoning);
            request.insert(
                "include".to_string(),
                Value::Array(vec![Value::String(
                    "reasoning.encrypted_content".to_string(),
                )]),
            );
        } else {
            request.insert("include".to_string(), Value::Array(Vec::new()));
        }

        if let Some(service_tier) = service_tier_to_value(service_tier) {
            request.insert("service_tier".to_string(), service_tier);
        }
        if let Some(text) = text {
            request.insert("text".to_string(), text);
        }

        Ok(Value::Object(request))
    }

    fn build_responses_options(&self, turn_metadata_header: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(value) = self.client.state.beta_features_header.as_deref()
            && !value.is_empty()
            && let Ok(header_value) = HeaderValue::from_str(value)
        {
            headers.insert("x-codex-beta-features", header_value);
        }
        if let Some(turn_state) = self.turn_state.get()
            && let Ok(header_value) = HeaderValue::from_str(turn_state)
        {
            headers.insert(X_CODEX_TURN_STATE_HEADER, header_value);
        }
        if let Some(turn_metadata_header) = parse_turn_metadata_header(turn_metadata_header) {
            headers.insert(X_CODEX_TURN_METADATA_HEADER, turn_metadata_header);
        }
        if self.client.state.include_timing_metrics {
            headers.insert(
                X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER,
                HeaderValue::from_static("true"),
            );
        }
        if self.client.responses_websocket_enabled_by_runtime() {
            headers.insert(
                OPENAI_BETA_HEADER,
                HeaderValue::from_static("responses_websockets=2026-02-06"),
            );
        }
        headers
    }

    fn build_reasoning(
        &self,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
    ) -> Option<Value> {
        if !model_info.supports_reasoning_summaries {
            return None;
        }

        let mut reasoning = serde_json::Map::new();
        if let Some(effort) = effort.or(model_info.default_reasoning_level) {
            reasoning.insert("effort".to_string(), serde_json::to_value(effort).ok()?);
        }
        if summary != ReasoningSummaryConfig::None {
            reasoning.insert("summary".to_string(), serde_json::to_value(summary).ok()?);
        }
        Some(Value::Object(reasoning))
    }

    fn resolve_verbosity(&self, model_info: &ModelInfo) -> Option<VerbosityConfig> {
        if model_info.support_verbosity {
            return self
                .client
                .state
                .model_verbosity
                .or(model_info.default_verbosity);
        }

        if self.client.state.model_verbosity.is_some() {
            warn!(
                "model_verbosity is set but ignored as the model does not support verbosity: {}",
                model_info.slug
            );
        }
        None
    }

    #[cfg(target_arch = "wasm32")]
    async fn stream_browser_host(
        &self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<ServiceTier>,
        turn_metadata_header: Option<&str>,
    ) -> Result<ResponseStream> {
        let request_body =
            self.build_responses_request(prompt, model_info, effort, summary, service_tier)?;
        let extra_headers = header_map_to_json(self.build_responses_options(turn_metadata_header));
        browser_log_model_stream_request(
            &self.client.state.provider,
            &request_body,
            &extra_headers,
        );

        let request = BrowserModelRequest {
            request_id: format!("browser-model-{}", uuid::Uuid::new_v4()),
            request_body,
            transport_options: Some(BrowserTransportOptions {
                conversation_id: Some(self.client.state.conversation_id.to_string()),
                session_source: Some(format!("{:?}", self.client.state.session_source)),
                extra_headers: Some(extra_headers),
                use_websocket: self.client.responses_websocket_enabled(model_info),
            }),
        };
        let host = Arc::clone(&self.client.state.model_transport_host);
        let (tx, rx) = mpsc::channel(32);
        spawn_detached(async move {
            if tx.send(Ok(ResponseEvent::Created)).await.is_err() {
                return;
            }

            match host.run_model_turn(request).await {
                Ok(events) => {
                    for event in events {
                        let Some(mapped) = map_browser_model_event(event) else {
                            continue;
                        };
                        if tx.send(Ok(mapped)).await.is_err() {
                            return;
                        }
                    }
                }
                Err(error) => {
                    let _ = tx
                        .send(Err(CodexErr::UnsupportedOperation(error.message)))
                        .await;
                }
            }
        });

        Ok(ResponseStream { rx_event: rx })
    }
}

impl ModelClient {
    fn responses_websocket_enabled_by_runtime(&self) -> bool {
        self.state.responses_websocket_enabled_by_feature
            && !self.state.disable_websockets.load(Ordering::Relaxed)
    }
}

fn service_tier_to_value(service_tier: Option<ServiceTier>) -> Option<Value> {
    match service_tier {
        Some(ServiceTier::Fast) => Some(Value::String("priority".to_string())),
        Some(service_tier) => Some(Value::String(service_tier.to_string())),
        None => None,
    }
}

fn build_text_controls(
    verbosity: Option<VerbosityConfig>,
    output_schema: &Option<Value>,
) -> Option<Value> {
    if verbosity.is_none() && output_schema.is_none() {
        return None;
    }

    let mut text = serde_json::Map::new();
    if let Some(verbosity) = verbosity {
        text.insert(
            "verbosity".to_string(),
            Value::String(verbosity_to_wire(verbosity).to_string()),
        );
    }
    if let Some(schema) = output_schema {
        text.insert(
            "format".to_string(),
            serde_json::json!({
                "type": "json_schema",
                "strict": true,
                "schema": schema,
                "name": "codex_output_schema",
            }),
        );
    }
    Some(Value::Object(text))
}

fn verbosity_to_wire(verbosity: VerbosityConfig) -> &'static str {
    match verbosity {
        VerbosityConfig::Low => "low",
        VerbosityConfig::Medium => "medium",
        VerbosityConfig::High => "high",
    }
}

#[cfg(target_arch = "wasm32")]
fn map_browser_model_event(event: BrowserModelEvent) -> Option<ResponseEvent> {
    match event {
        BrowserModelEvent::Started { .. } => None,
        BrowserModelEvent::Delta {
            payload: BrowserModelDeltaPayload { output_text_delta },
            ..
        } => Some(ResponseEvent::OutputTextDelta(output_text_delta)),
        BrowserModelEvent::OutputItemDone { item, .. } => Some(ResponseEvent::OutputItemDone(item)),
        BrowserModelEvent::Completed { request_id } => Some(ResponseEvent::Completed {
            response_id: request_id,
            token_usage: None,
        }),
    }
}

#[cfg(target_arch = "wasm32")]
fn browser_log_model_stream_request(
    provider: &ModelProviderInfo,
    request_body: &Value,
    extra_headers: &Value,
) {
    let summary = request_body
        .as_object()
        .map(|body| {
            let input_len = body
                .get("input")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            let tool_len = body
                .get("tools")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            format!(
                "provider={} input_items={} tools={} model={}",
                provider.name,
                input_len,
                tool_len,
                body.get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown"),
            )
        })
        .unwrap_or_else(|| format!("provider={}", provider.name));
    let header_keys = extra_headers
        .as_object()
        .map(|headers| headers.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    web_sys::console::info_1(&wasm_bindgen::JsValue::from_str(&format!(
        "[wasm/core] model.stream host transport {summary} header_keys={header_keys:?}"
    )));
}

#[allow(dead_code)]
#[derive(Serialize)]
struct BrowserTextControls<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    verbosity: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<BrowserTextFormat<'a>>,
}

#[allow(dead_code)]
#[derive(Serialize)]
struct BrowserTextFormat<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    strict: bool,
    schema: &'a Value,
    name: &'a str,
}

fn parse_turn_metadata_header(turn_metadata_header: Option<&str>) -> Option<HeaderValue> {
    turn_metadata_header.and_then(|value| HeaderValue::from_str(value).ok())
}

fn header_map_to_json(headers: HeaderMap) -> Value {
    let mut object = serde_json::Map::new();
    for (key, value) in &headers {
        if let Ok(value) = value.to_str() {
            object.insert(key.as_str().to_string(), Value::String(value.to_string()));
        }
    }
    Value::Object(object)
}
